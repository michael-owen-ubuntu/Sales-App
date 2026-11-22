import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/supabase-rows";
import type { Activity, ActivityDraft, FollowUpData, StatusChange, Task, TaskDraft } from "./model";

export interface FollowUps {
  listFollowUps: () => Promise<FollowUpData>;
  saveTask: (draft: TaskDraft, previous?: Task) => Promise<void>;
  setTaskStatus: (task: Task, status: Task["status"]) => Promise<void>;
  deleteTask: (task: Task) => Promise<void>;
  logActivity: (draft: ActivityDraft) => Promise<void>;
}

export function createSupabaseFollowUps(client: SupabaseClient, userId: string): FollowUps {
  async function updateTask(task: Task, fields: Partial<Omit<TaskDraft, "company_id">> & { status?: Task["status"] }) {
    const { error, data } = await client.from("follow_up_tasks").update(fields)
      .eq("user_id", userId).eq("id", task.id).eq("updated_at", task.updated_at).select("id").maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "This task changed. Refresh and try again.");
  }

  return {
    async listFollowUps() {
      const [tasks, activities, changes] = await Promise.all([
        allRows<Task>((start, end) => client.from("follow_up_tasks").select("*").eq("user_id", userId).order("id").range(start, end)),
        allRows<Activity>((start, end) => client.from("sales_activities").select("*").eq("user_id", userId).order("id").range(start, end)),
        allRows<StatusChange>((start, end) => client.from("sales_status_history").select("*").eq("user_id", userId).order("id").range(start, end)),
      ]);
      return { tasks, activities, changes };
    },
    async saveTask({ company_id, ...fields }, previous) {
      if (previous) return updateTask(previous, fields);
      const { error } = await client.from("follow_up_tasks").insert({ company_id, ...fields });
      if (error) throw new Error(error.message);
    },
    setTaskStatus: (task, status) => updateTask(task, { status }),
    async deleteTask(task) {
      const { error, data } = await client.from("follow_up_tasks").delete()
        .eq("user_id", userId).eq("id", task.id).eq("updated_at", task.updated_at).select("id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "This task changed. Refresh and try again.");
    },
    async logActivity(draft) {
      const { error } = await client.from("sales_activities").insert(draft);
      if (error) throw new Error(error.message);
    },
  };
}

function exampleDue(daysFromNow: number, hours: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hours, 0, 0, 0);
  return date.toISOString();
}

export function createExampleFollowUps(requireActiveCompany: (id: string) => void, contactName: (companyId: string, contactId: string) => string | undefined) {
  let tasks: Task[] = [
    { id: "example-task-1", company_id: "example-2", title: "Follow up on warehouse requirements", notes: "Ask about delivery areas and storage needs.", due_at: exampleDue(-1, 11), status: "OPEN", completed_at: null, updated_at: new Date().toISOString() },
    { id: "example-task-2", company_id: "example-1", title: "Confirm customs clearance scope", notes: "", due_at: exampleDue(0, 23), status: "OPEN", completed_at: null, updated_at: new Date().toISOString() },
    { id: "example-task-3", company_id: "example-4", title: "Send an air freight introduction", notes: "", due_at: exampleDue(2, 10), status: "OPEN", completed_at: null, updated_at: new Date().toISOString() },
  ];
  let activities: Activity[] = [
    { id: "example-activity-1", company_id: "example-1", contact_id: "example-contact-1", contact_name: "Dewi (example)", type: "EMAIL", outcome: "Asked for service information", notes: "Send the customs clearance checklist.", occurred_at: exampleDue(-1, 10) },
  ];
  let changes: StatusChange[] = [];

  function recordStatus(companyId: string, kind: StatusChange["kind"], subject: string, oldStatus: string, newStatus: string) {
    changes = [...changes, { id: crypto.randomUUID(), company_id: companyId, kind, subject, old_status: oldStatus, new_status: newStatus, occurred_at: new Date().toISOString() }];
  }

  function currentTask(task: Task) {
    requireActiveCompany(task.company_id);
    const current = tasks.find(({ id }) => id === task.id);
    if (!current || current.updated_at !== task.updated_at) throw new Error("This task changed. Refresh and try again.");
    return current;
  }

  function replaceTask(current: Task, fields: Partial<Task>) {
    const stamp = new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString();
    tasks = tasks.map((task) => task.id === current.id ? { ...task, ...fields, updated_at: stamp } : task);
  }

  const api: FollowUps = {
    async listFollowUps() { return { tasks, activities, changes }; },
    async saveTask(draft, previous) {
      requireActiveCompany(draft.company_id);
      if (previous) {
        const current = currentTask(previous);
        replaceTask(current, { ...draft, company_id: current.company_id });
      } else {
        tasks = [...tasks, { ...draft, id: crypto.randomUUID(), status: "OPEN", completed_at: null, updated_at: new Date().toISOString() }];
      }
    },
    async setTaskStatus(task, status) {
      const current = currentTask(task);
      if (current.status === status) return;
      replaceTask(current, { status, completed_at: status === "DONE" ? new Date().toISOString() : null });
      recordStatus(task.company_id, "TASK", task.title, task.status, status);
    },
    async deleteTask(task) {
      const current = currentTask(task);
      tasks = tasks.filter(({ id }) => id !== current.id);
    },
    async logActivity(draft) {
      requireActiveCompany(draft.company_id);
      const name = draft.contact_id ? contactName(draft.company_id, draft.contact_id) : "";
      if (name === undefined) throw new Error("Contact does not belong to this company.");
      activities = [...activities, { ...draft, id: crypto.randomUUID(), contact_name: name }];
    },
  };

  return {
    api,
    recordStatus,
    detachContact(companyId: string, contactId: string) {
      activities = activities.map((activity) => activity.company_id === companyId && activity.contact_id === contactId
        ? { ...activity, contact_id: null } : activity);
    },
  };
}
