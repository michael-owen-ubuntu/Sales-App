import { lazy, Suspense, useState } from "react";
import {
  Activity, ArrowRight, Building2, CalendarClock, ChartNoAxesColumnIncreasing, CircleCheck,
  Compass, LayoutDashboard, LogOut, Package, Settings, UserRound, UsersRound,
} from "lucide-react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataError, StatusBadge } from "@/features/companies/feedback";
import { usePortfolio } from "@/features/companies/crm-context";
import { preferredContact } from "@/features/companies/model";
import { cn } from "@/lib/utils";

const WorkerStatus = lazy(() => import("@/features/discovery/worker-status"));
const DiscoveryPage = lazy(() => import("@/features/discovery/inbox"));
const DiscoveryOverview = lazy(() => import("@/features/discovery/overview"));
const CompaniesPage = lazy(() => import("@/features/companies/companies"));
const CompanyDetail = lazy(() => import("@/features/companies/company-detail"));
const FollowUpsPanel = lazy(() => import("@/features/followups/panels").then((module) => ({ default: module.FollowUpsPanel })));
const ActivitiesPanel = lazy(() => import("@/features/followups/panels").then((module) => ({ default: module.ActivitiesPanel })));
const FollowUpOverview = lazy(() => import("@/features/followups/panels").then((module) => ({ default: module.FollowUpOverview })));

const sections = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Companies", path: "/companies", icon: Building2 },
  { title: "Discover", path: "/discover", icon: Compass },
  { title: "Follow-ups", path: "/follow-ups", icon: CalendarClock },
  { title: "Activities", path: "/activities", icon: Activity },
  { title: "Settings", path: "/settings", icon: Settings },
];

function Dashboard() {
  const query = usePortfolio();
  if (query.isPending) return <><h1 className="page-title">Dashboard</h1><p role="status" className="mt-4 text-sm text-muted-foreground">Loading your portfolio…</p></>;
  if (query.isError) return <><h1 className="page-title mb-4">Dashboard</h1><DataError retry={() => void query.refetch()} /></>;

  const companies = query.data.companies.filter((company) => !company.archived_at);
  const needsContact = companies.filter((company) => {
    const contact = preferredContact(query.data.contacts.filter((person) => person.company_id === company.id), "LOGISTICS_PIC");
    return !contact?.phone && !contact?.email;
  });
  const metrics = [
    { title: "Active prospects", value: companies.length, icon: Building2 },
    { title: "New prospects", value: companies.filter(({ status }) => status === "NEW").length, icon: UsersRound },
    { title: "Missing PIC phone and email", value: needsContact.length, icon: UserRound },
    { title: "Qualified", value: companies.filter(({ status }) => status === "QUALIFIED").length, icon: CircleCheck },
  ];
  const priorities = companies.filter(({ status }) => status === "FOLLOW_UP_REQUIRED" || status === "NEW")
    .sort((first, second) => Number(second.status === "FOLLOW_UP_REQUIRED") - Number(first.status === "FOLLOW_UP_REQUIRED") || first.name.localeCompare(second.name, "id"))
    .slice(0, 5);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="page-title">Dashboard</h1><p className="page-description">A snapshot of your logistics prospects.</p></div>
        <Link to="/companies" className={buttonVariants()}>View companies <ArrowRight /></Link>
      </header>
      <div className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map(({ title, value, icon: Icon }) => <Card key={title} className="gap-2">
          <CardHeader className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"><Icon aria-hidden="true" size={16} /></span>
          </CardHeader>
          <CardContent className="text-3xl font-semibold tracking-tight tabular-nums">{value}</CardContent>
        </Card>)}
      </div>
      <Suspense fallback={<p role="status" className="mt-5 text-sm text-muted-foreground">Loading follow-up schedule…</p>}>
        <FollowUpOverview />
      </Suspense>
      <Suspense fallback={null}><DiscoveryOverview /></Suspense>
      <Card className="mt-5">
        <CardHeader><CardTitle>Prospects to review</CardTitle></CardHeader>
        <CardContent>
          {priorities.length ? <ul className="divide-y">
            {priorities.map((company) => <li key={company.id}>
              <Link to={`/companies/${company.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-sm px-1 py-3 hover:bg-muted/50">
                <div><p className="text-sm font-semibold">{company.name}</p><p className="text-xs text-muted-foreground">{[company.city, company.industry].filter(Boolean).join(" · ")}</p></div>
                <StatusBadge status={company.status} />
              </Link>
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">No new prospects or companies marked for follow-up.</p>}
        </CardContent>
      </Card>
    </>
  );
}

export function Workspace({ email, demo, signOut }: { email?: string; demo: boolean; signOut?: () => Promise<void> }) {
  const { pathname } = useLocation();
  const [leaving, setLeaving] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  async function leave() {
    setLeaving(true);
    setSignOutError(false);
    try {
      await signOut?.();
    } catch {
      setSignOutError(true);
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-muted/45 text-foreground md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <a href="#workspace-content" onClick={(event) => {
        event.preventDefault();
        document.getElementById("workspace-content")?.focus();
      }} className="sr-only z-20 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:bg-background focus:p-3">
        Skip to content
      </a>
      <aside className="flex flex-col border-b border-slate-800 bg-slate-950 p-4 text-slate-200 md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0">
        <Link to="/" className="mb-5 flex items-center gap-3 rounded-md px-1 py-2 md:mb-8">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-300 text-slate-950"><Package aria-hidden="true" size={21} /></span>
          <span className="text-sm leading-snug font-semibold text-white">GPI Sales<br />Intelligence</span>
        </Link>
        <nav aria-label="Workspace" className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-1">
          {sections.map(({ path, title, icon: Icon }) => (
            <NavLink key={path} to={path} className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors",
              pathname === path || path !== "/" && pathname.startsWith(`${path}/`)
                ? "bg-teal-300/15 text-teal-100" : "text-slate-300 hover:bg-slate-800 hover:text-white",
            )} end={path === "/"}>
              <Icon size={16} aria-hidden="true" />{title}
            </NavLink>
          ))}
          <span aria-disabled="true" className="flex min-h-9 items-center gap-2.5 px-3 text-sm text-slate-400">
            <ChartNoAxesColumnIncreasing aria-hidden="true" size={16} />GP Performance <span className="sr-only">(coming later)</span>
          </span>
        </nav>
        <div className="mt-4 border-t border-slate-800 pt-4 md:mt-auto">
          {demo ? <Badge className="border-teal-300/20 bg-teal-300/10 text-teal-100">Example workspace</Badge> : <>
            <p className="truncate text-xs text-slate-300" title={email}>{email}</p>
            <Button variant="ghost" className="mt-1 text-slate-200 hover:bg-slate-800 hover:text-white" disabled={leaving} onClick={() => void leave()}><LogOut />Sign out</Button>
            {signOutError && <p role="alert" className="mt-1 text-xs text-red-200">Could not sign out. Try again.</p>}
          </>}
        </div>
      </aside>
      <main id="workspace-content" tabIndex={-1} className="mx-auto w-full max-w-340 p-5 md:p-8 xl:p-10">
        {demo && <Alert className="mb-5 border-teal-200 bg-teal-50 text-teal-950"><AlertDescription className="text-teal-900">These are fictional examples. Changes reset when you reload the app.</AlertDescription></Alert>}
        <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading workspace…</p>}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:companyId" element={<CompanyDetail key={pathname} />} />
            <Route path="/discover" element={<DiscoveryPage />} />
            <Route path="/follow-ups" element={<FollowUpsPanel />} />
            <Route path="/activities" element={<ActivitiesPanel />} />
            <Route path="/settings" element={<>
              <h1 className="page-title">Settings</h1>
              <Card className="mt-6 max-w-xl">
                <CardHeader><CardTitle>Supabase connection</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">{demo ? "Set the project URL and publishable key in .env.local, then restart the development app or rebuild the desktop app." : `Signed in as ${email}.`}</CardContent>
              </Card>
              <WorkerStatus demo={demo} />
            </>} />
            <Route path="*" element={<>
              <h1 className="page-title">Page unavailable</h1>
              <Link to="/" className={buttonVariants({ variant: "outline", className: "mt-4" })}>Return to dashboard</Link>
            </>} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
