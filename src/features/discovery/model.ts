import { z } from "zod";
import { contactSchema, emptyCompany, safeWebsite, services, type CompanyFormData, type ContactFormData } from "@/features/companies/model";

export const reviewStatuses = {
  NEW: "New", NEEDS_REVIEW: "Needs review", ACCEPTED: "Accepted", REJECTED: "Rejected", DUPLICATE: "Duplicate",
} as const;

const url = z.string().refine((value) => Boolean(safeWebsite(value)), "Enter a valid HTTP or HTTPS source.");
const timestamp = z.iso.datetime({ offset: true });

const publishedPerson = contactSchema.pick({ name: true, phone: true, email: true });
const publishedContacts = z.object({
  RECEPTIONIST: publishedPerson.optional(),
  LOGISTICS_PIC: publishedPerson.optional(),
});

export const discoveryDraft = z.object({
  country_code: z.literal("ID"),
  published_contacts: publishedContacts.default({}),
  content_fingerprint: z.string().regex(/^[a-z0-9][a-z0-9:_-]{7,127}$/),
  company_name: z.string().trim().min(1).max(200),
  source_name: z.string().trim().min(1).max(200),
  source_url: url,
  website: z.union([z.literal(""), url]),
  address: z.string().max(500),
  industry: z.string().max(100),
  city: z.string().max(100),
  province: z.string().max(100),
  company_type: z.string().max(100),
  reason: z.string().trim().min(1).max(1000),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  is_logistics_provider: z.boolean(),
  last_checked_at: timestamp,
  evidence: z.array(z.object({ url, excerpt: z.string().trim().min(1).max(500), captured_at: timestamp })).min(1).max(10),
  suggested_services: z.array(z.object({
    service: z.enum(services), reason: z.string().trim().min(1).max(500), evidence_url: url,
  })).max(6),
}).refine((candidate) => candidate.suggested_services.every((service) =>
  candidate.evidence.some((item) => item.url === service.evidence_url)
), "Service suggestions must link to recorded evidence.");

export type CandidateStatus = keyof typeof reviewStatuses;
export type Decision = Exclude<CandidateStatus, "NEW">;
export type DiscoveryDraft = z.infer<typeof discoveryDraft>;
export type Candidate = Omit<DiscoveryDraft, "country_code"> & {
  country_code: "ID" | null;
  priority_score?: number;
  id: string;
  status: CandidateStatus;
  discovered_at: string;
  reviewed_at: string | null;
  company_id: string | null;
};

export type Review = {
  id: string;
  candidate_id: string;
  old_status: CandidateStatus;
  new_status: Decision;
  notes: string;
  reviewed_at: string;
};

export function isPendingCandidate(candidate: Candidate) {
  return candidate.status === "NEW" || candidate.status === "NEEDS_REVIEW";
}

export function toContactDrafts(candidate: Pick<Candidate, "published_contacts" | "source_url">): ContactFormData[] {
  return (["RECEPTIONIST", "LOGISTICS_PIC"] as const).flatMap((role) => {
    const person = candidate.published_contacts?.[role];
    return person ? [{ ...person, role, is_primary: true, source_url: candidate.source_url }] : [];
  });
}

export function toCompanyDraft(candidate: Candidate): CompanyFormData {
  return {
    ...emptyCompany,
    name: candidate.company_name,
    website: candidate.website,
    address: candidate.address,
    industry: candidate.industry,
    city: candidate.city,
    province: candidate.province,
    company_type: candidate.company_type,
    source_type: "DISCOVERY",
    source_url: candidate.source_url,
    suggested_services: [...new Set(candidate.suggested_services.map(({ service }) => service))],
    verified_on: new Date(candidate.last_checked_at).toISOString().slice(0, 10),
  };
}

export function priorityScore(candidate: Candidate) {
  if (candidate.priority_score !== undefined) return candidate.priority_score;
  if (candidate.is_logistics_provider) return 0;
  const logistics = candidate.published_contacts?.LOGISTICS_PIC;
  return Math.min(45, 15 * new Set(candidate.suggested_services.map(({ service }) => service)).size)
    + { HIGH: 15, MEDIUM: 10, LOW: 5 }[candidate.confidence]
    + 10 * (Number(Boolean(candidate.website)) + Number(Boolean(candidate.city))
      + Number(Boolean(logistics?.name)) + Number(Boolean(logistics?.phone || logistics?.email)));
}
