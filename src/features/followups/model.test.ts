import { describe, expect, it } from "vitest";
import { createExampleCrm } from "@/features/companies/repository";
import { dueBucket, localInputValue, localTimestamp, taskSchema } from "./model";

describe("follow-up schedule", () => {
  const now = new Date(2026, 10, 21, 14, 0);

  it("derives overdue and today using the device clock and excludes closed tasks", () => {
    const due = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    expect(dueBucket({ due_at: due(21, 9), status: "OPEN" }, now)).toBe("overdue");
    expect(dueBucket({ due_at: due(21, 15), status: "OPEN" }, now)).toBe("today");
    expect(dueBucket({ due_at: due(22, 9), status: "OPEN" }, now)).toBe("upcoming");
    expect(dueBucket({ due_at: due(20, 9), status: "DONE" }, now)).toBeNull();
    expect(dueBucket({ due_at: due(21, 9), status: "CANCELLED" }, now)).toBeNull();
  });

  it("converts valid local dates to UTC and rejects normalized invalid dates", () => {
    expect(localTimestamp(localInputValue(now))).toBe(now.toISOString());
    expect(localTimestamp("2026-02-30T12:30")).toBe("");
    expect(localTimestamp("")).toBe("");
    expect(taskSchema.safeParse({ company_id: "example-1", title: "  ", notes: "", due_at: now.toISOString() }).success).toBe(false);
  });
});

describe("follow-up repository in example mode", () => {
  it("reschedules tasks, rejects stale updates, and retains status changes after deletion", async () => {
    const crm = createExampleCrm();
    const draft = { company_id: "example-1", title: "Confirm quote", due_at: "2026-11-22T07:00:00Z", notes: "" };
    await crm.saveTask(draft);
    const created = (await crm.listFollowUps()).tasks.find(({ title }) => title === draft.title)!;

    await crm.saveTask({ ...draft, due_at: "2026-11-23T07:00:00Z" }, created);
    await expect(crm.setTaskStatus(created, "DONE")).rejects.toThrow("changed");

    const rescheduled = (await crm.listFollowUps()).tasks.find(({ id }) => id === created.id)!;
    expect(rescheduled.due_at).toBe("2026-11-23T07:00:00Z");
    await crm.setTaskStatus(rescheduled, "DONE");
    const completed = (await crm.listFollowUps()).tasks.find(({ id }) => id === created.id)!;
    expect(completed.completed_at).toBeTruthy();
    await crm.setTaskStatus(completed, "OPEN");
    const reopened = (await crm.listFollowUps()).tasks.find(({ id }) => id === created.id)!;
    expect(reopened.completed_at).toBeNull();
    await crm.setTaskStatus(reopened, "CANCELLED");
    const cancelled = (await crm.listFollowUps()).tasks.find(({ id }) => id === created.id)!;
    await crm.deleteTask(cancelled);
    const data = await crm.listFollowUps();
    expect(data.tasks.some(({ id }) => id === created.id)).toBe(false);
    expect(data.changes.map(({ old_status, new_status }) => [old_status, new_status])).toEqual([
      ["OPEN", "DONE"], ["DONE", "OPEN"], ["OPEN", "CANCELLED"],
    ]);
  });

  it("keeps recorded contact names and prevents writes to archived companies", async () => {
    const crm = createExampleCrm();
    const activity = {
      company_id: "example-1", contact_id: "example-contact-2", type: "CALL" as const,
      occurred_at: "2026-11-21T07:00:00Z", outcome: "Reached reception", notes: "",
    };
    await expect(crm.logActivity({ ...activity, company_id: "example-2" })).rejects.toThrow("does not belong");
    await crm.logActivity(activity);
    await crm.removeContact("example-1", "example-contact-2");
    expect((await crm.listFollowUps()).activities.find(({ outcome }) => outcome === activity.outcome)).toMatchObject({
      contact_id: null, contact_name: "Rani (example)",
    });
    await crm.archive("example-1", true);
    await expect(crm.logActivity({ ...activity, contact_id: null })).rejects.toThrow("archived");
  });
});
