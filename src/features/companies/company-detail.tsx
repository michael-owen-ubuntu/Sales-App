import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, Copy, Mail, Pencil, Plus, RotateCcw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDiscovery } from "@/features/discovery/context";
import { useRefreshFollowUps } from "@/features/followups/context";
import { ActivitiesPanel, FollowUpsPanel } from "@/features/followups/panels";
import { LinkedText, WebLink } from "@/components/web-link";
import { googleMapsSearch } from "@/lib/google-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copyText, openExternal } from "@/lib/desktop";
import { DataError, StatusBadge } from "./feedback";
import { CompanyDialog } from "./company-dialog";
import { ContactDialog } from "./contact-dialog";
import { portfolioKey, useCrm, usePortfolio } from "./crm-context";
import { contactRoles, preferredContact, safeWebsite, type Contact } from "./model";

export default function CompanyDetail() {
  const { companyId } = useParams();
  const query = usePortfolio();
  const crm = useCrm();
  const cache = useQueryClient();
  const refreshFollowUps = useRefreshFollowUps();
  const [editing, setEditing] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    await cache.invalidateQueries({ queryKey: portfolioKey });
  }

  async function act(action: () => Promise<void>, success = "") {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const company = query.data?.companies.find(({ id }) => id === companyId);
  const discovery = useDiscovery(company?.source_type === "DISCOVERY");
  const discoveryCandidate = discovery.data?.candidates.find((candidate) => candidate.company_id === company?.id);
  const contacts = query.data?.contacts.filter((contact) => contact.company_id === companyId) ?? [];

  return (
    <>
      <Link to="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 mb-4" })}><ArrowLeft />Companies</Link>
      {query.isPending ? <p role="status">Loading company…</p> : query.isError ? <DataError retry={() => void query.refetch()} /> : !company ? <h1 className="page-title">Company unavailable</h1> : <>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 flex gap-2"><StatusBadge status={company.status} />{company.archived_at && <Badge variant="outline">Archived</Badge>}</div>
            <h1 className="page-title">{company.name}</h1>
            <p className="page-description">{[company.industry, company.city, company.province].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!company.archived_at && <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}><Pencil />Edit company</Button>}
            <Button variant="outline" disabled={busy} onClick={() => void act(async () => {
              await crm.archive(company.id, !company.archived_at);
              await refresh();
            }, company.archived_at ? "Company restored." : "Company archived.")}>
              {company.archived_at ? <><RotateCcw />Restore</> : <><Archive />Archive</>}
            </Button>
          </div>
        </header>
        {error && <Alert className="mt-4" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <p className="mt-3 text-sm text-muted-foreground" role="status">{message}</p>}
        <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <Card>
            <CardHeader><CardTitle>Company details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                {([
                  ["Website", <WebLink value={company.website} />],
                  ["Google Maps", <div className="grid justify-items-start gap-1">
                    <WebLink value={googleMapsSearch(company, company.google_place_id)} label={company.google_place_id ? "Open Google Maps" : "Search Google Maps"} />
                    {!company.archived_at && company.google_place_id !== undefined && <form className="mt-1 grid w-full gap-2" key={company.google_place_id ?? "none"} onSubmit={(event) => {
                      event.preventDefault();
                      const value = new FormData(event.currentTarget).get("placeId")?.toString().trim() || null;
                      void act(async () => { await crm.saveGooglePlaceId(company.id, value); await refresh(); }, "Google Maps location updated.");
                    }}>
                      <Label htmlFor="company-place-id" className="text-xs">Confirmed Google Place ID</Label>
                      <Input id="company-place-id" name="placeId" maxLength={512} defaultValue={company.google_place_id ?? ""} />
                      <Button type="submit" variant="outline" size="sm" disabled={busy}>Save Place ID</Button>
                    </form>}
                  </div>],
                  ["Address", company.address], ["City", company.city], ["Province", company.province],
                  ["Company type", company.company_type], ["Industry", company.industry], ["Lead source", company.source_type],
                  ["Evidence", <div className="grid justify-items-start gap-1">
                    <WebLink value={company.source_url} label="Open evidence" />
                    {discoveryCandidate && <Link to={`/discover?candidate=${encodeURIComponent(discoveryCandidate.id)}`} className="font-medium text-primary hover:underline">View discovery review</Link>}
                  </div>], ["Last verified", company.verified_on],
                ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 wrap-break-word">{value || "—"}</dd></div>)}
                <div className="col-span-2"><dt className="text-muted-foreground">Suggested services</dt><dd className="mt-1 flex flex-wrap gap-1.5">{company.suggested_services.length ? company.suggested_services.map((service) => <Badge key={service} variant="outline">{service}</Badge>) : "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="mt-1 wrap-break-word whitespace-pre-wrap">{company.notes ? <LinkedText text={company.notes} /> : "—"}</dd></div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Preferred contacts</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              {(["RECEPTIONIST", "LOGISTICS_PIC"] as const).map((role) => {
                const contact = preferredContact(contacts, role);
                return <div key={role} className="rounded-lg border p-3 text-sm">
                  <p className="text-xs text-muted-foreground">{contactRoles[role]}</p>
                  <p className="mt-1 font-medium">{contact?.name ?? "Unknown"}</p>
                  {contact?.phone && <p className="mt-1 text-muted-foreground">{contact.phone}</p>}
                  {contact?.email && <p className="mt-1 wrap-break-word text-muted-foreground">{contact.email}</p>}
                </div>;
              })}
            </CardContent>
          </Card>
        </div>
        <Card className="mt-5">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3"><CardTitle>Contacts</CardTitle>
            {!company.archived_at && <Button variant="outline" disabled={busy} onClick={() => setEditingContact("new")}><Plus />Add contact</Button>}
          </CardHeader>
          <CardContent className="grid gap-3">
            {!contacts.length && <p className="text-sm text-muted-foreground">No contacts yet.</p>}
            {contacts.map((contact) => <article key={contact.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{contact.name}</p><p className="text-muted-foreground">{contactRoles[contact.role]}{contact.is_primary && " · Preferred"}</p>
                {contact.phone && <p className="mt-1">{contact.phone} <Button variant="ghost" size="icon-sm" aria-label={`Copy phone for ${contact.name}`} onClick={() => void act(() => copyText(contact.phone), "Phone copied.")}><Copy /></Button></p>}
                {contact.email && <div className="flex flex-wrap items-center gap-1"><Button variant="link" className="h-auto min-w-0 p-0" onClick={() => void act(() => openExternal(`mailto:${encodeURIComponent(contact.email).replace(/%40/g, "@")}`))}><Mail /><span className="wrap-anywhere whitespace-normal text-left">{contact.email}</span></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Copy email for ${contact.name}`} onClick={() => void act(() => copyText(contact.email), "Email copied.")}><Copy /></Button></div>}
                {safeWebsite(contact.source_url) && <WebLink value={contact.source_url} label="Contact source" />}
              </div>
              {!company.archived_at && <div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} aria-label={`Edit ${contact.name}`} onClick={() => setEditingContact(contact)}>Edit</Button><Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${contact.name}`} onClick={() => setRemoving(contact)}>Remove</Button></div>}
            </article>)}
          </CardContent>
        </Card>
        <FollowUpsPanel companyId={company.id} />
        <ActivitiesPanel companyId={company.id} />
        {editing && <CompanyDialog company={company} companies={query.data?.companies ?? []} onClose={() => setEditing(false)} onSave={async (data, id) => {
          await crm.saveCompany(data, id);
          await Promise.all([refresh(), refreshFollowUps()]);
        }} />}
        {editingContact && <ContactDialog contact={editingContact === "new" ? undefined : editingContact} onClose={() => setEditingContact(null)} onSave={async (data, id) => {
          await crm.saveContact(company.id, data, id);
          await refresh();
        }} />}
        {removing && <Dialog open onOpenChange={(open) => { if (!open && !busy) setRemoving(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Remove {removing.name}?</DialogTitle><DialogDescription>This permanently removes the contact from the company.</DialogDescription></DialogHeader>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button>
              <Button variant="destructive" disabled={busy} onClick={() => void act(async () => {
                await crm.removeContact(company.id, removing.id);
                await Promise.all([refresh(), refreshFollowUps()]);
                setRemoving(null);
              }, "Contact removed.")}>Remove contact</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </>}
    </>
  );
}
