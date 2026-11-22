import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useCrm } from "@/features/companies/crm-context";
import type { Portfolio } from "@/features/companies/repository";
import { useRefreshFollowUps } from "./context";
import { activitySchema, activityTypes, localInputValue, localTimestamp, taskSchema, type Task } from "./model";

type EditorProps = {
  portfolio: Portfolio;
  companyId?: string;
  task?: Task;
  onClose: () => void;
  kind: "task" | "activity";
};

export function FollowUpEditor({ portfolio, companyId, task, onClose, kind }: EditorProps) {
  const crm = useCrm();
  const refresh = useRefreshFollowUps();
  const fixedCompany = companyId ?? task?.company_id;
  const [selected, setSelected] = useState(fixedCompany ?? "");
  const [initialTime] = useState(() => localInputValue(
    task ? new Date(task.due_at) : new Date(Date.now() + (kind === "task" ? 3_600_000 : 0)),
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isTask = kind === "task";
  const title = isTask ? task ? "Edit follow-up" : "New follow-up" : "Log activity";
  const activeCompanies = portfolio.companies.filter((company) => !company.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
  const contacts = portfolio.contacts.filter((contact) => contact.company_id === selected);
  const timeLabel = isTask ? "Due date and time" : "Activity date and time";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const enteredTime = String(data.get("time") ?? "");
    const time = task && enteredTime === localInputValue(new Date(task.due_at))
      ? task.due_at : localTimestamp(enteredTime);
    if (!time) {
      setError("Enter a valid date and time in your device’s time zone.");
      return;
    }
    const common = { company_id: selected, notes: String(data.get("notes") ?? "") };
    const result = isTask
      ? taskSchema.safeParse({ ...common, title: data.get("title"), due_at: time })
      : activitySchema.safeParse({ ...common, contact_id: data.get("contact") || null, type: data.get("type"), outcome: data.get("outcome"), occurred_at: time });

    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setSaving(true);
    setError("");
    try {
      if ("due_at" in result.data) await crm.saveTask(result.data, task);
      else await crm.logActivity(result.data);
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>Dates and times use your device’s time zone.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
        {!fixedCompany && <div className="grid gap-1.5">
          <Label htmlFor="follow-up-company">Company</Label>
          <NativeSelect className="w-full" id="follow-up-company" required value={selected} onChange={(event) => setSelected(event.target.value)}>
            <NativeSelectOption value="" disabled>Choose a company</NativeSelectOption>
            {activeCompanies.map((company) => <NativeSelectOption key={company.id} value={company.id}>{company.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>}
        {isTask ? <div className="grid gap-1.5">
          <Label htmlFor="follow-up-title">Title</Label><Input id="follow-up-title" name="title" required maxLength={200} defaultValue={task?.title} />
        </div> : <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="activity-type">Type</Label>
            <NativeSelect className="w-full" id="activity-type" name="type">{Object.entries(activityTypes).map(([value, label]) =>
              <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>
            )}</NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="activity-contact">Contact (optional)</Label>
            <NativeSelect className="w-full" key={selected} id="activity-contact" name="contact" disabled={!contacts.length}>
              <NativeSelectOption value="">No contact selected</NativeSelectOption>
              {contacts.map((contact) => <NativeSelectOption key={contact.id} value={contact.id}>{contact.name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>}
        <div className="grid gap-1.5">
          <Label htmlFor="follow-up-time">{timeLabel}</Label>
          <Input id="follow-up-time" name="time" type="datetime-local" required defaultValue={initialTime} />
        </div>
        {!isTask && <div className="grid gap-1.5"><Label htmlFor="activity-outcome">Outcome</Label><Input id="activity-outcome" name="outcome" maxLength={500} /></div>}
        <div className="grid gap-1.5"><Label htmlFor="follow-up-notes">Notes</Label><Textarea id="follow-up-notes" name="notes" maxLength={5000} defaultValue={task?.notes} /></div>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving}>{saving ? "Saving…" : isTask ? "Save follow-up" : "Save activity"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
