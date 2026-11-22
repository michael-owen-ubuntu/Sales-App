import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Crm } from "./repository";

export const CrmContext = createContext<Crm | null>(null);
export const portfolioKey = ["portfolio"] as const;

export function useCrm() {
  const crm = useContext(CrmContext);
  if (!crm) throw new Error("CRM provider is missing.");
  return crm;
}

export function usePortfolio() {
  const crm = useCrm();
  return useQuery({ queryKey: portfolioKey, queryFn: crm.list });
}
