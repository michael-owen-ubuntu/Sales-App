import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCrm } from "@/features/companies/crm-context";

const key = ["follow-ups"] as const;

export function useFollowUps() {
  const crm = useCrm();
  return useQuery({ queryKey: key, queryFn: crm.listFollowUps });
}

export function useRefreshFollowUps() {
  const cache = useQueryClient();
  return () => cache.invalidateQueries({ queryKey: key });
}
