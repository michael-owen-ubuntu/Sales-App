import { useQuery } from "@tanstack/react-query";
import { useCrm } from "@/features/companies/crm-context";

export const discoveryKey = ["discovery"] as const;

export function useDiscovery(enabled = true) {
  const crm = useCrm();
  return useQuery({ queryKey: discoveryKey, queryFn: crm.listDiscovery, enabled });
}
