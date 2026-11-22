import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { leadStatuses } from "./model";

export function StatusBadge({ status }: { status: keyof typeof leadStatuses }) {
  const className = status === "QUALIFIED" ? "bg-emerald-50 text-emerald-800"
    : status === "FOLLOW_UP_REQUIRED" ? "bg-amber-50 text-amber-900"
    : status === "CONTACTED" ? "bg-blue-50 text-blue-800"
    : "bg-muted text-muted-foreground";
  return <Badge variant="secondary" className={className}>{leadStatuses[status]}</Badge>;
}

export function DataError({ retry }: { retry: () => void }) {
  return <Alert variant="destructive"><AlertTitle>Could not load companies</AlertTitle><AlertDescription>
    <p>Check your connection and Supabase setup, then try again.</p>
    <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
  </AlertDescription></Alert>;
}
