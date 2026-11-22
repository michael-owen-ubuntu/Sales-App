import { ArrowRight, Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDiscovery } from "./context";
import { isPendingCandidate, priorityScore } from "./model";

export default function DiscoveryOverview() {
  const query = useDiscovery();
  const pending = (query.data?.candidates ?? []).filter(isPendingCandidate)
    .sort((a, b) => priorityScore(b) - priorityScore(a) || Date.parse(b.discovered_at) - Date.parse(a.discovered_at));

  return <Card className="mt-5">
    <CardHeader className="flex flex-wrap items-center justify-between gap-2">
      <CardTitle className="flex items-center gap-2"><Compass size={17} aria-hidden="true" />Recent discoveries</CardTitle>
      <Link to="/discover" className={buttonVariants({ size: "sm", variant: "outline" })}>Open inbox <ArrowRight /></Link>
    </CardHeader>
    <CardContent>{query.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading discoveries…</p>
      : query.isError ? <p className="text-sm text-muted-foreground">The discovery inbox is currently unavailable.</p>
      : pending.length ? <ul className="divide-y">{pending.slice(0, 3).map((candidate) => <li key={candidate.id}>
        <Link to={`/discover?candidate=${encodeURIComponent(candidate.id)}`} className="block rounded-sm px-1 py-2.5 hover:bg-muted/50">
          <p className="text-sm font-semibold">{candidate.company_name}</p>
          <p className="text-xs text-muted-foreground">{[candidate.city, candidate.industry, candidate.is_logistics_provider && "Logistics provider"].filter(Boolean).join(" · ")}</p>
        </Link>
      </li>)}</ul> : <p className="text-sm text-muted-foreground">No discoveries waiting for review.</p>}</CardContent>
  </Card>;
}
