import { useEffect, useState } from "react";
import { CalendarClock, Check, ClipboardList, History, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LinkedText } from "@/components/web-link";
import { followUpExport } from "@/features/spreadsheets/export";
import { ExportButton } from "@/features/spreadsheets/export-button";
import { useCrm, usePortfolio } from "@/features/companies/crm-context";
import { leadStatuses } from "@/features/companies/model";
import { cn } from "@/lib/utils";
import { useFollowUps, useRefreshFollowUps } from "./context";
import { FollowUpEditor } from "./dialogs";
import { activityTypes, dueBucket, dueLabels, formatTime, taskStatuses, type Activity, type StatusChange, type Task } from "./model";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const ticker = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(ticker);
  }, []);
  return now;
}

function QueryNotice({ error, retry }: { error: boolean; retry: () => void }) {
  return error ? <Alert variant="destructive"><AlertTitle>Could not load sales records</AlertTitle><AlertDescription>
    <p>Check the connection and make sure both CRM migrations have been applied.</p>
    <Button size="sm" variant="outline" onClick={retry}>Try again</Button>
  </AlertDescription></Alert> : <p role="status" className="text-sm text-muted-foreground">Loading sales records…</p>;
}

const groups = { OPEN: "Open", ...dueLabels, DONE: "Done", CANCELLED: "Cancelled", all: "All" } as const;
type Group = keyof typeof groups;

function TaskBadge({ task, now }: { task: Task; now: Date }) {
  const bucket = dueBucket(task, now);
  return <Badge variant="secondary" className={cn(
    bucket === "overdue" && "bg-red-50 text-red-800",
    bucket === "today" && "bg-amber-50 text-amber-900",
    task.status === "DONE" && "bg-emerald-50 text-emerald-800",
  )}>{bucket ? dueLabels[bucket] : taskStatuses[task.status]}</Badge>;
}

function CompanyFilter({ options, value, onChange }: {
  options: { id: string; name: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return <NativeSelect aria-label="Filter by company" value={value} onChange={(event) => onChange(event.target.value)}>
    <NativeSelectOption value="all">All companies</NativeSelectOption>
    {[...options].sort((a, b) => a.name.localeCompare(b.name, "id")).map((company) =>
      <NativeSelectOption key={company.id} value={company.id}>{company.name}</NativeSelectOption>
    )}
  </NativeSelect>;
}

export function FollowUpsPanel({ companyId }: { companyId?: string }) {
  const crm = useCrm();
  const refresh = useRefreshFollowUps();
  const portfolio = usePortfolio();
  const followUps = useFollowUps();
  const now = useClock();
  const [params, setParams] = useSearchParams();
  const selectedGroup = params.get("due") ?? "OPEN";
  const globalGroup = Object.prototype.hasOwnProperty.call(groups, selectedGroup) ? selectedGroup as Group : "OPEN";
  const [localGroup, setLocalGroup] = useState<Group>("all");
  const group = companyId ? localGroup : globalGroup;
  const [companyFilter, setCompanyFilter] = useState("all");
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function changeGroup(value: Group) {
    if (companyId) setLocalGroup(value);
    else setParams(value === "OPEN" ? {} : { due: value }, { replace: true });
  }

  async function mutate(action: () => Promise<void>, done: string) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
      await refresh();
      setDeleting(null);
      setMessage(done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the task.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const companies = portfolio.data?.companies ?? [];
  const byId = new Map(companies.map((company) => [company.id, company]));
  const canAdd = portfolio.isSuccess && followUps.isSuccess && (companyId ? byId.get(companyId)?.archived_at === null : companies.some((company) => !company.archived_at));
  const tasks = (followUps.data?.tasks ?? []).filter((task) => {
    if (companyId ? task.company_id !== companyId : companyFilter !== "all" && task.company_id !== companyFilter) return false;
    if (!companyId && (group === "overdue" || group === "today" || group === "upcoming") && byId.get(task.company_id)?.archived_at) return false;
    return group === "all" || group === task.status || group === dueBucket(task, now);
  }).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));

  const addButton = <Button disabled={!canAdd || busy} onClick={() => setEditor("new")}><Plus />New follow-up</Button>;
  return <>
    {!companyId && <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="page-title">Follow-ups</h1><p className="page-description">Schedule, complete, and reschedule tasks for your prospects.</p></div>
      <div className="flex flex-wrap gap-2">
        <ExportButton filename="gpi-follow-ups" count={tasks.length} buildRows={() => followUpExport(tasks, companies, now)} />
        {addButton}
      </div>
    </header>}
    <Card className={companyId ? "mt-5" : "mt-6"}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2"><CalendarClock size={17} aria-hidden="true" />{companyId ? "Follow-up tasks" : "Task queue"}</CardTitle>
        {companyId && canAdd && addButton}
      </CardHeader>
      <CardContent className="space-y-4">
        {portfolio.isPending || followUps.isPending || portfolio.isError || followUps.isError ? <QueryNotice error={portfolio.isError || followUps.isError} retry={() => {
          void portfolio.refetch();
          void followUps.refetch();
        }} /> : <>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Filter follow-ups" value={group} onChange={(event) => changeGroup(event.target.value as Group)}>
              {Object.entries(groups).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
            {!companyId && <CompanyFilter options={companies} value={companyFilter} onChange={setCompanyFilter} />}
          </div>
          {error && !deleting && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          {tasks.length ? <ul className="divide-y rounded-lg border">
            {tasks.map((task) => {
              const company = byId.get(task.company_id);
              const editable = company && !company.archived_at;
              return <li key={task.id} className="grid gap-2 p-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="wrap-anywhere text-sm font-semibold"><LinkedText text={task.title} /></p><TaskBadge task={task} now={now} />{company?.archived_at && <Badge variant="outline">Archived company</Badge>}</div>
                  {!companyId && company && <Link to={`/companies/${company.id}`} className="text-xs font-medium text-primary hover:underline">{company.name}</Link>}
                  <p className="text-xs text-muted-foreground">Due <time dateTime={task.due_at}>{formatTime(task.due_at)}</time>{task.completed_at && <> · Completed <time dateTime={task.completed_at}>{formatTime(task.completed_at)}</time></>}</p>
                  {task.notes && <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground"><LinkedText text={task.notes} /></p>}
                </div>
                {editable && <div className="flex flex-wrap items-center gap-1">
                  {task.status === "OPEN" ? <>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate(() => crm.setTaskStatus(task, "DONE"), "Follow-up completed.")}><Check />Complete</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void mutate(() => crm.setTaskStatus(task, "CANCELLED"), "Follow-up cancelled.")}><X />Cancel task</Button>
                  </> : <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate(() => crm.setTaskStatus(task, "OPEN"), "Follow-up reopened.")}><RotateCcw />Reopen</Button>}
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${task.title}`} title="Edit or reschedule" disabled={busy} onClick={() => setEditor(task)}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${task.title}`} title="Delete follow-up" disabled={busy} onClick={() => { setError(""); setDeleting(task); }}><Trash2 /></Button>
                </div>}
              </li>;
            })}
          </ul> : <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">No follow-ups match this view.</p>}
        </>}
      </CardContent>
    </Card>
    {editor && portfolio.data && <FollowUpEditor kind="task" companyId={companyId} portfolio={portfolio.data} task={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} />}
    {deleting && <Dialog open onOpenChange={(open) => { if (!open && !busy) { setDeleting(null); setError(""); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete follow-up?</DialogTitle><DialogDescription>{deleting.title} will be removed from the task list. Prior status changes stay in activity history.</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { setDeleting(null); setError(""); }}>Keep follow-up</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void mutate(() => crm.deleteTask(deleting), "Follow-up deleted.")}>Delete follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </>;
}

type TimelineEntry = ({ kind: "ACTIVITY" } & Activity) | StatusChange;
function timeline(activities: Activity[], changes: StatusChange[]): TimelineEntry[] {
  const logged = activities.map((activity) => ({ ...activity, kind: "ACTIVITY" as const }));
  return [...logged, ...changes].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

function TimelineItem({ item, companyName }: { item: TimelineEntry; companyName?: string }) {
  const statusLabels: Readonly<Record<string, string>> = item.kind === "LEAD" ? leadStatuses : taskStatuses;
  const logged = item.kind === "ACTIVITY";
  return <li className="grid gap-1 px-3 py-3">
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <Badge variant="secondary">{logged ? activityTypes[item.type] : item.kind === "LEAD" ? "Lead status" : "Task status"}</Badge>
      <time className="text-xs text-muted-foreground" dateTime={item.occurred_at}>{formatTime(item.occurred_at)}</time>
    </div>
    {companyName && <Link to={`/companies/${item.company_id}`} className="w-fit text-sm font-semibold text-primary hover:underline">{companyName}</Link>}
    {logged ? <>
      {item.contact_name && <p className="text-xs text-muted-foreground">{item.contact_name}</p>}
      {item.outcome && <p className="wrap-anywhere text-sm font-medium"><LinkedText text={item.outcome} /></p>}
      {item.notes && <p className="wrap-anywhere whitespace-pre-wrap text-sm text-muted-foreground"><LinkedText text={item.notes} /></p>}
    </> : <p className="wrap-anywhere text-sm">
      {item.subject && <span className="font-medium">{item.subject} · </span>}
      {statusLabels[item.old_status] ?? item.old_status} → {statusLabels[item.new_status] ?? item.new_status}
    </p>}
  </li>;
}

export function ActivitiesPanel({ companyId }: { companyId?: string }) {
  const portfolio = usePortfolio();
  const followUps = useFollowUps();
  const [companyFilter, setCompanyFilter] = useState("all");
  const [type, setType] = useState("all");
  const [logging, setLogging] = useState(false);
  const companies = portfolio.data?.companies ?? [];
  const byId = new Map(companies.map((company) => [company.id, company]));
  const canLog = portfolio.isSuccess && followUps.isSuccess && (companyId ? byId.get(companyId)?.archived_at === null : companies.some((company) => !company.archived_at));
  const items = timeline(followUps.data?.activities ?? [], followUps.data?.changes ?? []).filter((item) => {
    const matchesCompany = companyId ? item.company_id === companyId : companyFilter === "all" || item.company_id === companyFilter;
    return matchesCompany && (type === "all" || type === (item.kind === "ACTIVITY" ? item.type : item.kind));
  });
  const logButton = <Button disabled={!canLog} onClick={() => setLogging(true)}><Plus />Log activity</Button>;
  return <>
    {!companyId && <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="page-title">Activities</h1><p className="page-description">Review outreach, notes, and status changes.</p></div>{logButton}
    </header>}
    <Card className={companyId ? "mt-5" : "mt-6"}>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><History size={17} aria-hidden="true" />Activity history</CardTitle>{companyId && canLog && logButton}</CardHeader>
      <CardContent className="space-y-4">
        {portfolio.isPending || followUps.isPending || portfolio.isError || followUps.isError ? <QueryNotice error={portfolio.isError || followUps.isError} retry={() => {
          void portfolio.refetch();
          void followUps.refetch();
        }} /> : <>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Filter activity type" value={type} onChange={(event) => setType(event.target.value)}>
              <NativeSelectOption value="all">All activity types</NativeSelectOption>
              {Object.entries(activityTypes).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
              <NativeSelectOption value="LEAD">Lead status changes</NativeSelectOption>
              <NativeSelectOption value="TASK">Task status changes</NativeSelectOption>
            </NativeSelect>
            {!companyId && <CompanyFilter options={companies} value={companyFilter} onChange={setCompanyFilter} />}
          </div>
          {items.length ? <ol className="divide-y rounded-lg border">{items.map((item) => <TimelineItem key={item.id} item={item} companyName={!companyId ? byId.get(item.company_id)?.name : undefined} />)}</ol>
            : <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">No activity matches this view.</p>}
        </>}
      </CardContent>
    </Card>
    {logging && portfolio.data && <FollowUpEditor kind="activity" companyId={companyId} portfolio={portfolio.data} onClose={() => setLogging(false)} />}
  </>;
}

export function FollowUpOverview() {
  const now = useClock();
  const portfolio = usePortfolio();
  const followUps = useFollowUps();
  const active = new Map(portfolio.data?.companies.filter((company) => !company.archived_at).map((company) => [company.id, company.name]));
  const tasks = (followUps.data?.tasks ?? []).filter((task) => active.has(task.company_id) && task.status === "OPEN")
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const buckets = Object.keys(dueLabels) as (keyof typeof dueLabels)[];
  const items = timeline(followUps.data?.activities ?? [], followUps.data?.changes ?? []).slice(0, 3);
  const names = new Map(portfolio.data?.companies.map(({ id, name }) => [id, name]));

  return <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><ClipboardList size={17} aria-hidden="true" />Follow-up schedule</CardTitle><Link to="/follow-ups" className={buttonVariants({ variant: "outline", size: "sm" })}>View follow-ups</Link></CardHeader>
      <CardContent>{followUps.isPending || followUps.isError ? <QueryNotice error={followUps.isError} retry={() => void followUps.refetch()} /> :
        <div className="grid divide-y rounded-lg border">
          {buckets.map((bucket) => {
            const due = tasks.filter((task) => dueBucket(task, now) === bucket);
            return <section className="space-y-2 p-3" key={bucket}>
              <Link className="flex items-center justify-between gap-2 text-sm font-semibold hover:underline" to={`/follow-ups?due=${bucket}`}>{dueLabels[bucket]} <Badge variant="outline">{due.length}</Badge></Link>
              {due.length > 0 && <ul className="space-y-2">{due.slice(0, 2).map((task) => <li key={task.id} className="text-xs text-muted-foreground"><Link to={`/companies/${task.company_id}`} className="font-medium text-foreground hover:underline">{task.title}</Link><p>{active.get(task.company_id)} · {formatTime(task.due_at)}</p></li>)}</ul>}
            </section>;
          })}
        </div>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><History size={17} aria-hidden="true" />Recent activity</CardTitle><Link to="/activities" className={buttonVariants({ variant: "outline", size: "sm" })}>View history</Link></CardHeader>
      <CardContent>{followUps.isPending || followUps.isError ? <QueryNotice error={followUps.isError} retry={() => void followUps.refetch()} /> :
        items.length ? <ol className="divide-y rounded-lg border">{items.map((item) => <TimelineItem key={item.id} item={item} companyName={names.get(item.company_id)} />)}</ol>
        : <p className="text-sm text-muted-foreground">No activity yet.</p>}
      </CardContent>
    </Card>
  </div>;
}
