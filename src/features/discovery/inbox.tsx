import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, CircleAlert, Compass, History, MapPin } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { portfolioKey, useCrm, usePortfolio } from "@/features/companies/crm-context";
import { findDuplicates, leadStatuses, normalizeText, type Company } from "@/features/companies/model";
import { formatTime } from "@/features/followups/model";
import { googleMapsSearch } from "@/lib/google-maps";
import { LinkedText, WebLink } from "@/components/web-link";
import { cn } from "@/lib/utils";
import { discoveryKey, useDiscovery } from "./context";
import { isPendingCandidate, priorityScore, reviewStatuses, toCompanyDraft, type Candidate, type Decision, type Review } from "./model";

const decisionLabels: Record<Decision, string> = {
  ACCEPTED: "Accept as company", REJECTED: "Reject", DUPLICATE: "Mark duplicate", NEEDS_REVIEW: "Needs review",
};

function CandidateBadge({ candidate }: { candidate: Candidate }) {
  return <Badge variant="secondary" className={cn(
    candidate.status === "ACCEPTED" && "bg-emerald-50 text-emerald-800",
    candidate.status === "NEEDS_REVIEW" && "bg-amber-50 text-amber-900",
  )}>{reviewStatuses[candidate.status]}</Badge>;
}

function ReviewDialog({ candidate, decision, matches, onClose }: {
  candidate: Candidate;
  decision: Decision;
  matches: Company[];
  onClose: () => void;
}) {
  const crm = useCrm();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [serverDuplicate, setServerDuplicate] = useState(false);
  const requiresConfirmation = decision === "ACCEPTED" && (matches.length > 0 || serverDuplicate);
  const description = decision === "ACCEPTED" ? "Create a prospect with the published contact details shown here. The follow-up status starts as New."
    : decision === "NEEDS_REVIEW" ? "Keep this candidate in the inbox for another review."
    : "Record your decision and move this candidate to the reviewed records.";

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await crm.reviewCandidate(candidate.id, decision, notes, requiresConfirmation && confirmed);
      await Promise.all([
        cache.invalidateQueries({ queryKey: discoveryKey }),
        ...(decision === "ACCEPTED" ? [cache.invalidateQueries({ queryKey: portfolioKey })] : []),
      ]);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save the decision.";
      if (decision === "ACCEPTED" && message.startsWith("Possible duplicate")) {
        setServerDuplicate(true);
        await cache.invalidateQueries({ queryKey: portfolioKey });
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{decisionLabels[decision]}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
        {requiresConfirmation && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-primary" />
          I reviewed the possible duplicate and want to create a separate company.
        </label>}
        <div className="grid gap-1.5">
          <Label htmlFor="review-notes">Review notes (optional)</Label>
          <Textarea id="review-notes" value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant={decision === "REJECTED" ? "destructive" : "default"} disabled={busy || requiresConfirmation && !confirmed}>{busy ? "Saving…" : "Save decision"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function CandidateDetail({ candidate, reviews, companies, canAccept, pinSelection }: {
  candidate: Candidate;
  reviews: Review[];
  companies: Company[];
  canAccept: boolean;
  pinSelection: () => void;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState(false);
  const matches = findDuplicates(toCompanyDraft(candidate), companies);
  const location = [candidate.city, candidate.province].filter(Boolean).join(", ");
  const linkError = () => setError(true);
  const logistics = candidate.published_contacts?.LOGISTICS_PIC;
  const receptionist = candidate.published_contacts?.RECEPTIONIST;
  const company = companies.find(({ id }) => id === candidate.company_id);
  const fields = [
    ["Company Name", candidate.company_name],
    ["Website", <WebLink value={candidate.website} onError={linkError} />],
    ["Address", candidate.address || location],
    ["Receptionist's Name", receptionist?.name],
    ["Logistics Contact Person", logistics?.name],
    ["Contact Person's Phone Number", logistics?.phone],
    ["Email Address", logistics?.email],
    ["Current Follow-up Status", company ? leadStatuses[company.status] : candidate.status === "ACCEPTED" ? "Unavailable" : "Not yet in CRM"],
  ] as const;
  function review(next: Decision) {
    pinSelection();
    setDecision(next);
  }

  return <div className="min-w-0 space-y-4">
    <Card>
      <CardHeader>
        <div className="mb-1 flex flex-wrap gap-2">
          <CandidateBadge candidate={candidate} />
          <Badge variant="outline" title="Based on published evidence and contact availability">Priority {priorityScore(candidate)}/100</Badge>
          <Badge variant="outline">{candidate.confidence[0] + candidate.confidence.slice(1).toLowerCase()} source confidence</Badge>
          {candidate.is_logistics_provider && <Badge className="bg-amber-50 text-amber-900">Logistics provider</Badge>}
        </div>
        <CardTitle className="wrap-anywhere text-xl">{candidate.company_name}</CardTitle>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {location && <><MapPin size={14} aria-hidden="true" />{location}</>}
          {candidate.industry && <span>{candidate.industry}</span>}
          {candidate.company_type && <span>{candidate.company_type}</span>}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          {fields.map(([label, value]) => <div className="min-w-0" key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 wrap-anywhere text-sm font-medium">{value || "—"}</dd>
          </div>)}
        </dl>
        <p className="wrap-anywhere text-sm"><LinkedText text={candidate.reason} /></p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <WebLink value={candidate.source_url} label={candidate.source_name} onError={linkError} />
          <WebLink value={googleMapsSearch({ ...candidate, name: candidate.company_name }, company?.google_place_id)} label={company?.google_place_id ? "Open Google Maps" : "Search Google Maps"} onError={linkError} />
        </div>
        <p className="text-xs text-muted-foreground">Last checked <time dateTime={candidate.last_checked_at}>{formatTime(candidate.last_checked_at)}</time></p>
        {error && <Alert variant="destructive"><AlertDescription>Could not open the source link.</AlertDescription></Alert>}
        {isPendingCandidate(candidate) && <>
          {candidate.is_logistics_provider && <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <CircleAlert aria-hidden="true" /><AlertTitle>Outside prospect criteria</AlertTitle>
            <AlertDescription>Acceptance is disabled because this business offers logistics services.</AlertDescription>
          </Alert>}
          {matches.length > 0 && <Alert><AlertTitle>Possible CRM matches</AlertTitle><AlertDescription>
            <ul className="grid gap-1">{matches.map((company) => <li key={company.id}>
              <Link className="font-medium text-primary hover:underline" to={`/companies/${company.id}`}>{company.name}</Link>
              {company.city && ` · ${company.city}`}{company.archived_at && " (archived)"}
            </li>)}</ul>
          </AlertDescription></Alert>}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button disabled={candidate.is_logistics_provider || !canAccept} onClick={() => review("ACCEPTED")}><Check />Accept as company</Button>
            {candidate.status !== "NEEDS_REVIEW" && <Button variant="outline" onClick={() => review("NEEDS_REVIEW")}>Needs review</Button>}
            <Button variant="outline" onClick={() => review("DUPLICATE")}>Mark duplicate</Button>
            <Button variant="ghost" onClick={() => review("REJECTED")}>Reject</Button>
          </div>
        </>}
        {candidate.company_id && <Link to={`/companies/${candidate.company_id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open company <ArrowUpRight /></Link>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Source evidence</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {candidate.evidence.map((item, index) => <div key={`${item.url}-${index}`} className="space-y-2 rounded-lg border p-3">
          <blockquote className="wrap-anywhere border-l-2 border-primary/35 pl-3 text-sm"><LinkedText text={item.excerpt} /></blockquote>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WebLink value={item.url} label={`Evidence source ${index + 1}`} onError={linkError} />
            <time dateTime={item.captured_at} className="text-xs text-muted-foreground">{formatTime(item.captured_at)}</time>
          </div>
        </div>)}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Suggested services</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {candidate.suggested_services.length ? candidate.suggested_services.map((item, index) => <div key={`${item.service}-${index}`} className="space-y-1 rounded-lg border p-3">
          <p className="text-sm font-semibold">{item.service}</p>
          <p className="wrap-anywhere text-sm text-muted-foreground"><LinkedText text={item.reason} /></p>
          <WebLink value={item.evidence_url} label="Supporting source" onError={linkError} />
        </div>) : <p className="text-sm text-muted-foreground">No services suggested.</p>}
      </CardContent>
    </Card>
    {reviews.length > 0 && <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><History size={16} aria-hidden="true" />Review history</CardTitle></CardHeader>
      <CardContent><ol className="divide-y">
        {reviews.map((review) => <li key={review.id} className="py-2 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span>{reviewStatuses[review.old_status]} → {reviewStatuses[review.new_status]}</span>
            <time className="text-xs text-muted-foreground" dateTime={review.reviewed_at}>{formatTime(review.reviewed_at)}</time></div>
          {review.notes && <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-muted-foreground"><LinkedText text={review.notes} /></p>}
        </li>)}
      </ol></CardContent>
    </Card>}
    {decision && <ReviewDialog candidate={candidate} decision={decision} matches={matches} onClose={() => setDecision(null)} />}
  </div>;
}

export default function DiscoveryPage() {
  const inbox = useDiscovery();
  const portfolio = usePortfolio();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const candidates = inbox.data?.candidates ?? [];
  const terms = normalizeText(search).split(" ").filter(Boolean);
  const visible = candidates.filter((candidate) => {
    const searchable = normalizeText([candidate.company_name, candidate.city, candidate.province, candidate.industry].join(" "));
    return terms.every((term) => searchable.includes(term))
      && (filter === "all" || (filter === "pending" ? isPendingCandidate(candidate) : candidate.status === filter));
  }).sort((a, b) => priorityScore(b) - priorityScore(a) || Date.parse(b.discovered_at) - Date.parse(a.discovered_at) || a.company_name.localeCompare(b.company_name, "id"));
  const selectedId = params.get("candidate");
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? visible[0];
  const reviews = (inbox.data?.reviews ?? []).filter((review) => review.candidate_id === selected?.id)
    .sort((a, b) => Date.parse(b.reviewed_at) - Date.parse(a.reviewed_at));

  return <>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="page-title">Discover</h1><p className="page-description">Review prospects ranked by published evidence and contact availability.</p></div>
      <Button variant="outline" disabled={inbox.isFetching} onClick={() => void inbox.refetch()}>
        {inbox.isFetching ? "Loading inbox…" : "Refresh inbox"}
      </Button>
    </header>
    {inbox.isPending ? <p className="mt-6 text-sm text-muted-foreground" role="status">Loading discovery inbox…</p>
      : inbox.isError ? <Alert className="mt-6" variant="destructive"><AlertTitle>Could not load the discovery inbox</AlertTitle><AlertDescription>
        <p>Check the connection and confirm the discovery migration is applied.</p><Button variant="outline" size="sm" onClick={() => void inbox.refetch()}>Try again</Button>
      </AlertDescription></Alert>
      : <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(15rem,0.85fr)_minmax(0,1.45fr)]">
        <Card className="min-w-0 self-start">
          <CardHeader><CardTitle className="flex items-center justify-between gap-2">Review inbox <Badge variant="outline">{visible.length}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input aria-label="Search discovery candidates" placeholder="Search companies or locations" value={search} onChange={(event) => {
              setSearch(event.target.value); setParams({}, { replace: true });
            }} />
            <NativeSelect aria-label="Filter discovery status" className="w-full" value={filter} onChange={(event) => {
              setFilter(event.target.value); setParams({}, { replace: true });
            }}>
              <NativeSelectOption value="pending">Pending review</NativeSelectOption>
              <NativeSelectOption value="all">All candidates</NativeSelectOption>
              {Object.entries(reviewStatuses).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
            </NativeSelect>
            {visible.length > 0 ? <ul className="grid gap-1">{visible.map((candidate) => <li key={candidate.id}>
              <Link to={`?candidate=${encodeURIComponent(candidate.id)}`} aria-current={selected?.id === candidate.id ? "true" : undefined}
                className={cn("grid gap-1 rounded-lg border px-3 py-2.5 hover:bg-muted", selected?.id === candidate.id && "border-primary/30 bg-accent")}>
                <span className="wrap-anywhere text-sm font-semibold">{candidate.company_name}</span>
                <span className="text-xs text-muted-foreground">{[candidate.city, candidate.industry].filter(Boolean).join(" · ")}</span>
                <span className="flex flex-wrap gap-1"><CandidateBadge candidate={candidate} /><Badge variant="outline">{priorityScore(candidate)}/100</Badge>{candidate.is_logistics_provider && <Badge variant="outline">Provider</Badge>}</span>
              </Link>
            </li>)}</ul> : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{candidates.length ? "No candidates match this filter." : "Candidates added to staging will appear here."}</p>}
          </CardContent>
        </Card>
        {portfolio.isError && <Alert className="lg:col-span-2" variant="destructive">
          <AlertDescription><p>Reload your company records to enable acceptance and duplicate checks.</p><Button variant="outline" size="sm" onClick={() => void portfolio.refetch()}>Reload companies</Button></AlertDescription>
        </Alert>}
        {selected ? <CandidateDetail key={selected.id} candidate={selected} reviews={reviews} companies={portfolio.data?.companies ?? []} canAccept={portfolio.isSuccess}
          pinSelection={() => { if (selectedId !== selected.id) setParams({ candidate: selected.id }, { replace: true }); }} />
          : <Card className="self-start"><CardContent className="flex items-center gap-2 text-sm text-muted-foreground"><Compass size={17} aria-hidden="true" />Select a candidate to review its evidence.</CardContent></Card>}
      </div>}
  </>;
}
