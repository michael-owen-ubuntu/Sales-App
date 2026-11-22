import { z } from "zod";

export const taskStatuses = { OPEN: "Open", DONE: "Done", CANCELLED: "Cancelled" } as const;
export const activityTypes = {
  CALL: "Call", EMAIL: "Email", WHATSAPP: "WhatsApp", MEETING: "Meeting",
  VISIT: "Visit", NOTE: "Note", OTHER: "Other",
} as const;
export const dueLabels = { overdue: "Overdue", today: "Today", upcoming: "Upcoming" } as const;

const companyId = z.string().min(1, "Choose a company.");
const timestamp = z.iso.datetime({ offset: true });
const notes = z.string().trim().max(5000);

export const taskSchema = z.object({
  company_id: companyId,
  title: z.string().trim().min(1, "Enter a title.").max(200),
  notes,
  due_at: timestamp,
});
export const activitySchema = z.object({
  company_id: companyId,
  contact_id: z.string().nullable(),
  type: z.enum(Object.keys(activityTypes) as (keyof typeof activityTypes)[]),
  outcome: z.string().trim().max(500),
  notes,
  occurred_at: timestamp,
});

export type TaskDraft = z.infer<typeof taskSchema>;
export type Task = TaskDraft & {
  id: string;
  status: keyof typeof taskStatuses;
  completed_at: string | null;
  updated_at: string;
};
export type ActivityDraft = z.infer<typeof activitySchema>;
export type Activity = ActivityDraft & { id: string; contact_name: string };
export type StatusChange = {
  id: string;
  company_id: string;
  kind: "LEAD" | "TASK";
  subject: string;
  old_status: string;
  new_status: string;
  occurred_at: string;
};
export type FollowUpData = { tasks: Task[]; activities: Activity[]; changes: StatusChange[] };

export function dueBucket(task: Pick<Task, "due_at" | "status">, now = new Date()): keyof typeof dueLabels | null {
  if (task.status !== "OPEN") return null;
  const due = new Date(task.due_at);
  if (due < now) return "overdue";
  return due.toDateString() === now.toDateString() ? "today" : "upcoming";
}

export function localInputValue(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function localTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && localInputValue(date) === value ? date.toISOString() : "";
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export function formatTime(value: string) {
  return dateTime.format(new Date(value));
}
