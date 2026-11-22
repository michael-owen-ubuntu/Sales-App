import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Building2, Plus, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDiscovery } from "@/features/discovery/context";
import { priorityScore } from "@/features/discovery/model";
import { ExportButton } from "@/features/spreadsheets/export-button";
import { companyExport } from "@/features/spreadsheets/export";
import { DataError, StatusBadge } from "./feedback";
import { CompanyDialog } from "./company-dialog";
import { portfolioKey, useCrm, usePortfolio } from "./crm-context";
import { leadStatuses, normalizeText, preferredContact, services } from "./model";

const ImportDialog = lazy(() => import("@/features/spreadsheets/import-dialog"));
function Filter({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className="w-full sm:w-auto"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([key, name]) => <SelectItem key={key} value={key}>{name}</SelectItem>)}</SelectContent>
  </Select>;
}

function dimensionOptions(values: string[], label: string): [string, string][] {
  return [["all", label], ...Array.from(new Set(values.filter(Boolean))).sort().map((value): [string, string] => [`value:${value}`, value])];
}

export default function CompaniesPage() {
  const query = usePortfolio();
  const discovery = useDiscovery();
  const crm = useCrm();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState("active");
  const [status, setStatus] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [province, setProvince] = useState("all");
  const [city, setCity] = useState("all");
  const [service, setService] = useState("all");
  const [missing, setMissing] = useState("all");
  const [sort, setSort] = useState("name");

  const companies = query.data?.companies ?? [];
  const contacts = query.data?.contacts ?? [];
  const scores = new Map((discovery.data?.candidates ?? []).flatMap((candidate) =>
    candidate.company_id ? [[candidate.company_id, priorityScore(candidate)] as const] : []));
  const visible = companies.filter((company) => {
    const people = contacts.filter((contact) => contact.company_id === company.id);
    const terms = normalizeText(search).split(" ").filter(Boolean);
    const searchable = normalizeText([company.name, company.city, company.province, company.industry, company.website, ...people.map((contact) => contact.name)].join(" "));
    return Boolean(company.archived_at) === (archived === "archived")
      && terms.every((term) => searchable.includes(term))
      && (status === "all" || company.status === status)
      && (industry === "all" || `value:${company.industry}` === industry)
      && (province === "all" || `value:${company.province}` === province)
      && (city === "all" || `value:${company.city}` === city)
      && (service === "all" || company.suggested_services.some((item) => item === service))
      && (missing === "all" ||
        missing === "receptionist" && !preferredContact(people, "RECEPTIONIST") ||
        missing === "logistics" && !preferredContact(people, "LOGISTICS_PIC") ||
        missing === "phone" && !preferredContact(people, "LOGISTICS_PIC")?.phone ||
        missing === "email" && !preferredContact(people, "LOGISTICS_PIC")?.email);
  }).sort((a, b) => (
    sort === "priority" ? (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1) : 0
  ) || a.name.localeCompare(b.name, "id"));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="page-title">Companies</h1><p className="page-description">Track prospects, contacts, and sales status.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImporting(true)} disabled={!query.isSuccess}><Upload />Import</Button>
          <ExportButton filename="gpi-companies" count={visible.length} buildRows={() => companyExport(visible, contacts)} />
          <Button onClick={() => setAdding(true)} disabled={!query.isSuccess}><Plus />Add company</Button>
        </div>
      </header>
      {query.isPending ? <p role="status" className="mt-6 text-muted-foreground">Loading companies…</p>
        : query.isError ? <div className="mt-6"><DataError retry={() => void query.refetch()} /></div>
        : <Card className="mt-6 gap-0 overflow-hidden py-0">
          <div className="space-y-3 border-b px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 grow sm:max-w-sm">
                <Search aria-hidden="true" size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search companies" placeholder="Search companies or contacts" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              {scores.size > 0 && <Filter label="Company sort order" value={sort} onChange={setSort} options={[["name", "Company name"], ["priority", "Discovery priority"]]} />}
              <Filter label="Company archive" value={archived} onChange={setArchived} options={[["active", "Active companies"], ["archived", "Archived companies"]]} />
            </div>
            <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
              <SlidersHorizontal size={16} aria-hidden="true" className="hidden text-muted-foreground sm:block" />
              <Filter label="Status" value={status} onChange={setStatus} options={[["all", "Any status"], ...Object.entries(leadStatuses)]} />
              <Filter label="Industry" value={industry} onChange={setIndustry} options={dimensionOptions(companies.map((company) => company.industry), "Any industry")} />
              <Filter label="Province" value={province} onChange={setProvince} options={dimensionOptions(companies.map((company) => company.province), "Any province")} />
              <Filter label="City" value={city} onChange={setCity} options={dimensionOptions(companies.map((company) => company.city), "Any city")} />
              <Filter label="Service fit" value={service} onChange={setService} options={[["all", "Any service"], ...services.map((item): [string, string] => [item, item])]} />
              <Filter label="Missing contact fields" value={missing} onChange={setMissing} options={[["all", "Any contact"], ["receptionist", "Missing receptionist"], ["logistics", "Missing logistics PIC"], ["phone", "Missing PIC phone"], ["email", "Missing PIC email"]]} />
            </div>
          </div>
          {visible.length ? (
            <Table>
              <TableHeader className="bg-muted/55"><TableRow>
                <TableHead>Company</TableHead><TableHead>Location</TableHead><TableHead>Logistics PIC</TableHead><TableHead>Status</TableHead>{scores.size > 0 && <TableHead>Priority</TableHead>}<TableHead className="sr-only">Open company</TableHead>
              </TableRow></TableHeader>
              <TableBody>{visible.map((company) => {
                const person = preferredContact(contacts.filter((contact) => contact.company_id === company.id), "LOGISTICS_PIC");
                return <TableRow key={company.id}>
                  <TableCell className="px-4 py-3"><Link className="font-semibold hover:underline" to={company.id}>{company.name}</Link><p className="mt-0.5 text-xs text-muted-foreground">{company.industry || "Industry unknown"}</p></TableCell>
                  <TableCell>{[company.city, company.province].filter(Boolean).join(", ") || "—"}</TableCell>
                  <TableCell>{person?.name ?? "—"}</TableCell><TableCell><StatusBadge status={company.status} /></TableCell>
                  {scores.size > 0 && <TableCell className="tabular-nums">{scores.has(company.id) ? `${scores.get(company.id)}/100` : "—"}</TableCell>}
                  <TableCell className="pr-4 text-right"><Link to={company.id} aria-label={`Open ${company.name}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}><ArrowUpRight /></Link></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          ) : <div className="grid justify-items-center gap-2 p-10 text-center"><Building2 size={24} className="text-muted-foreground" aria-hidden="true" /><p className="font-medium">No companies found</p><p className="text-sm text-muted-foreground">{companies.length ? "Try changing the search or filters." : "Add a company or review prospects uploaded by the discovery worker."}</p>
            {!companies.length && <Link to="/discover" className={buttonVariants({ variant: "outline", size: "sm" })}>Open discovery inbox</Link>}
          </div>}
          <p role="status" className="border-t px-4 py-3 text-xs text-muted-foreground">{visible.length} {visible.length === 1 ? "company" : "companies"}</p>
        </Card>}
      {importing && <Suspense fallback={<p role="status" className="mt-4 text-sm text-muted-foreground">Loading import tools…</p>}>
        <ImportDialog companies={companies} onClose={() => setImporting(false)} />
      </Suspense>}
      {adding && <CompanyDialog companies={companies} onClose={() => setAdding(false)} onSave={async (data) => {
        const id = await crm.saveCompany(data);
        await cache.invalidateQueries({ queryKey: portfolioKey });
        navigate(`/companies/${id}`);
      }} />}
    </>
  );
}
