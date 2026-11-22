import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/features/followups/model";
import { supabase } from "@/lib/supabase";

type DiscoveryRun = {
  id: string;
  started_at: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  source: string;
  found_count: number;
  uploaded_count: number;
  request_count: number;
  failed_sources: number;
  error_summary: string;
};

const labels = { SUCCEEDED: "Succeeded", PARTIAL: "Partial", FAILED: "Failed" };

export default function WorkerStatus({ demo }: { demo: boolean }) {
  const query = useQuery({
    queryKey: ["discovery-runs"],
    enabled: !demo && Boolean(supabase),
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase.from("discovery_runs").select(
        "id,started_at,status,source,found_count,uploaded_count,request_count,failed_sources,error_summary",
      ).order("started_at", { ascending: false }).limit(5);
      if (error) throw new Error(error.message);
      return data as DiscoveryRun[];
    },
  });

  return <Card className="mt-5 max-w-2xl">
    <CardHeader><CardTitle className="flex items-center gap-2"><Activity size={17} aria-hidden="true" />Discovery worker</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">The worker runs on the owner’s computer. Source settings and schedules are managed there.</p>
      {demo ? <p className="text-sm text-muted-foreground">The example workspace has no worker activity.</p>
        : query.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading recent worker runs…</p>
        : query.isError ? <Alert variant="destructive"><AlertDescription>
          <p>Could not load worker runs. Check the connection and the worker migration.</p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button>
        </AlertDescription></Alert>
        : query.data.length === 0 ? <p className="text-sm text-muted-foreground">No worker runs have been synced to this account.</p>
        : <>
          <ul className="divide-y rounded-lg border" aria-label="Recent discovery runs">
            {query.data.map((run) => <li className="space-y-1 px-3 py-2.5 text-sm" key={run.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <time dateTime={run.started_at}>{formatTime(run.started_at)}</time>
                <Badge variant={run.status === "FAILED" ? "destructive" : "secondary"}>{labels[run.status]}</Badge>
              </div>
              <p className="wrap-anywhere text-muted-foreground">{run.source === "all" ? "All configured sources" : run.source} · {run.found_count} found · {run.uploaded_count} submitted</p>
              <p className="text-xs text-muted-foreground">{run.request_count} source requests · {run.failed_sources} source failures</p>
              {run.error_summary && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Run details</summary><p className="mt-1 wrap-anywhere">{run.error_summary}</p></details>}
            </li>)}
          </ul>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh run history</Button>
        </>}
    </CardContent>
  </Card>;
}
