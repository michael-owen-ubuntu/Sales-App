import { z } from "zod";

export const leadStatuses = {
  NEW: "New",
  CONTACTED: "Contacted",
  FOLLOW_UP_REQUIRED: "Follow-up required",
  QUALIFIED: "Qualified",
  NOT_INTERESTED: "Not interested",
  UNQUALIFIED: "Unqualified",
  CLOSED: "Closed",
} as const;

export const contactRoles = {
  RECEPTIONIST: "Receptionist",
  LOGISTICS_PIC: "Logistics PIC",
  PURCHASING_PIC: "Purchasing PIC",
  OTHER: "Other",
} as const;

export const services = [
  "Air freight", "Sea freight", "Customs clearance", "Domestic trucking", "Warehousing", "Integrated logistics",
] as const;

const webAddress = z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) || /\s/.test(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Enter a complete http:// or https:// URL.");

export const companySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(200),
  website: webAddress,
  address: z.string().trim().max(500),
  city: z.string().trim().max(100),
  province: z.string().trim().max(100),
  industry: z.string().trim().max(100),
  company_type: z.string().trim().max(100),
  source_type: z.string().trim().max(100),
  source_url: webAddress,
  suggested_services: z.array(z.enum(services)),
  verified_on: z.union([z.literal(""), z.iso.date()]),
  notes: z.string().trim().max(5000),
  status: z.enum(Object.keys(leadStatuses) as (keyof typeof leadStatuses)[]),
});

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter the contact name.").max(200),
  role: z.enum(Object.keys(contactRoles) as (keyof typeof contactRoles)[]),
  phone: z.string().trim().max(35).refine((value) => {
    if (!value) return true;
    const digits = value.replace(/\D/g, "");
    return /^\+?[0-9 ().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }, "Enter a phone number with 7 to 15 digits."),
  email: z.string().trim().max(254).refine((value) => !value || z.email().safeParse(value).success && !/[?&#]/.test(value), "Enter a valid email address."),
  source_url: webAddress,
  is_primary: z.boolean(),
});

export type CompanyFormData = z.infer<typeof companySchema>;
export type ContactFormData = z.infer<typeof contactSchema>;
export type Company = CompanyFormData & { id: string; archived_at: string | null; google_place_id?: string | null };
export type Contact = ContactFormData & { id: string; company_id: string };

export const emptyCompany: CompanyFormData = {
  name: "", website: "", address: "", city: "", province: "", industry: "", company_type: "",
  source_type: "MANUAL", source_url: "", suggested_services: [], verified_on: "", notes: "", status: "NEW",
};
export const emptyContact: ContactFormData = {
  name: "", role: "LOGISTICS_PIC", phone: "", email: "", source_url: "", is_primary: false,
};

export function normalizeText(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeName(value: string) {
  return normalizeText(value).replace(/^(pt|cv|ud|perseroan terbatas)\s+/, "").replace(/\s+tbk$/, "");
}

export function normalizeDomain(value: string) {
  return URL.canParse(value) ? new URL(value).hostname.toLowerCase().replace(/^www\.|\.$/g, "") : "";
}

type DuplicateCandidate = Pick<CompanyFormData, "name" | "website"> & Partial<Pick<CompanyFormData, "address" | "city">>;

export function duplicateKeys(candidate: DuplicateCandidate) {
  const keys: string[] = [];
  const name = normalizeName(candidate.name);
  const domain = normalizeDomain(candidate.website);
  const address = normalizeText(candidate.address ?? "");
  const city = normalizeText(candidate.city ?? "");
  if (name) keys.push(`name:${name}`);
  if (domain) keys.push(`domain:${domain}`);
  if (address && city) keys.push(`address:${JSON.stringify([address, city])}`);
  return keys;
}

export function findDuplicates(draft: DuplicateCandidate, companies: Company[], id?: string) {
  const keys = new Set(duplicateKeys(draft));
  return companies.filter((company) => company.id !== id && duplicateKeys(company).some((key) => keys.has(key)));
}

export function preferredContact(contacts: Contact[], role: Contact["role"]) {
  return contacts.find((contact) => contact.role === role && contact.is_primary)
    ?? contacts.find((contact) => contact.role === role);
}

export function safeWebsite(value: string) {
  return value && webAddress.safeParse(value).success ? value : undefined;
}
