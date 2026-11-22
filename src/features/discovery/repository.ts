import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/supabase-rows";
import { findDuplicates, type Company, type CompanyFormData, type ContactFormData } from "@/features/companies/model";
import fixtures from "./examples.json";
import { discoveryDraft, isPendingCandidate, toCompanyDraft, toContactDrafts, type Candidate, type Decision, type Review } from "./model";

export type DiscoveryInbox = { candidates: Candidate[]; reviews: Review[] };
export interface Discovery {
  listDiscovery: () => Promise<DiscoveryInbox>;
  reviewCandidate: (id: string, decision: Decision, notes: string, allowPossibleDuplicate?: boolean) => Promise<string | null>;
}

export function createSupabaseDiscovery(client: SupabaseClient, owner: string): Discovery {
  return {
    async listDiscovery() {
      const [candidates, reviews] = await Promise.all([
        allRows<Candidate>((start, end) => client.from("discovery_candidates").select("*").eq("user_id", owner).order("id").range(start, end)),
        allRows<Review>((start, end) => client.from("discovery_reviews").select("*").eq("user_id", owner).order("id").range(start, end)),
      ]);
      return { candidates, reviews };
    },
    async reviewCandidate(id, decision, notes, allowPossibleDuplicate = false) {
      const { data, error } = await client.rpc("review_discovery_candidate", {
        candidate_id: id, decision, review_notes: notes, allow_possible_duplicate: allowPossibleDuplicate,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

export function createExampleDiscovery(getCompanies: () => Company[], addCompany: (draft: CompanyFormData, contacts: ContactFormData[]) => string) {
  const candidates = new Map<string, Candidate>();
  let reviews: Review[] = [];

  function stage(draft: unknown) {
    const parsed = discoveryDraft.parse(draft);
    const id = parsed.content_fingerprint;
    if (candidates.has(id)) return id;
    candidates.set(id, { ...parsed, id, status: "NEW", company_id: null, discovered_at: parsed.last_checked_at, reviewed_at: null });
    return id;
  }

  fixtures.forEach(stage);

  const api: Discovery = {
    async listDiscovery() {
      return { candidates: Array.from(candidates.values()), reviews };
    },
    async reviewCandidate(id, decision, notes, allowPossibleDuplicate = false) {
      const candidate = candidates.get(id);
      if (!candidate) throw new Error("Candidate is unavailable");
      if (candidate.status === decision) return candidate.company_id;
      if (!isPendingCandidate(candidate)) throw new Error("This candidate has already been reviewed");
      if (notes.trim().length > 1000) throw new Error("Keep review notes to 1,000 characters.");
      let companyId: string | null = null;
      if (decision === "ACCEPTED") {
        if (candidate.is_logistics_provider) throw new Error("This logistics provider is outside the prospect criteria");
        const draft = toCompanyDraft(candidate);
        if (!allowPossibleDuplicate && findDuplicates(draft, getCompanies()).length) {
          throw new Error("Possible duplicate. Review matching companies and confirm a separate record.");
        }
        companyId = addCompany(draft, toContactDrafts(candidate));
      }
      const now = new Date().toISOString();
      candidates.set(id, { ...candidate, status: decision, company_id: companyId, reviewed_at: now });
      reviews = [...reviews, { id: crypto.randomUUID(), candidate_id: id, old_status: candidate.status, new_status: decision, notes: notes.trim(), reviewed_at: now }];
      return companyId;
    },
  };
  return { api, stage };
}
