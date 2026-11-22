import {
  companySchema, contactRoles, contactSchema, duplicateKeys, emptyCompany, emptyContact, leadStatuses,
  normalizeText, services, type Company, type CompanyFormData, type ContactFormData,
} from "@/features/companies/model";
import type { Cell, Sheet } from "./files";

const fields = {
  name: ["Company name", "company", "nama perusahaan", "perusahaan", "nama customer", "customer"],
  website: ["Website", "web", "situs web"],
  address: ["Address", "alamat"],
  city: ["City", "kota", "kota kabupaten"],
  province: ["Province", "provinsi"],
  industry: ["Industry", "industri"],
  company_type: ["Company type", "jenis perusahaan"],
  source_url: ["Evidence URL", "source url"],
  suggested_services: ["Suggested services", "service fit", "layanan"],
  verified_on: ["Last verified", "verification date"],
  notes: ["Notes", "catatan"],
  status: ["Follow-up status", "current follow up status", "status", "status follow up"],
  receptionist: ["Receptionist name", "receptionist's name", "receptionist", "nama resepsionis", "resepsionis"],
  receptionist_phone: ["Receptionist phone", "telepon resepsionis"],
  receptionist_email: ["Receptionist email", "email resepsionis"],
  logistics: ["Logistics contact person", "logistics pic", "logistics contact", "pic logistik"],
  logistics_phone: ["Logistics PIC phone", "contact person phone number", "contact person's phone number", "nomor telepon pic", "telepon pic logistik"],
  logistics_email: ["Logistics PIC email", "email pic logistik"],
  contact: ["Contact name", "contact person", "nama kontak", "nama pic", "pic"],
  contact_role: ["Contact role", "jabatan", "role"],
  contact_phone: ["Contact phone", "phone", "phone number", "telepon", "no hp", "nomor hp"],
  contact_email: ["Contact email", "email address", "email", "alamat email"],
} as const;

export type MappingField = keyof typeof fields;
export type ColumnMapping = Partial<Record<MappingField, number>>;
export const mappingFields = Object.entries(fields) as [MappingField, readonly string[]][];

export function textCell(cell: Cell | undefined) {
  return cell instanceof Date ? cell.toISOString().slice(0, 10) : String(cell ?? "").trim();
}

export function guessMapping(headers: Cell[]): ColumnMapping {
  const normalized = headers.map((value) => normalizeText(textCell(value)));
  const mapping: ColumnMapping = {};
  for (const [field, aliases] of mappingFields) {
    const options = aliases.map(normalizeText);
    const index = normalized.findIndex((label, position) => options.includes(label) && !Object.values(mapping).includes(position));
    if (index >= 0) mapping[field] = index;
  }
  if (mapping.logistics !== undefined && mapping.contact === undefined) {
    mapping.logistics_phone ??= mapping.contact_phone;
    mapping.logistics_email ??= mapping.contact_email;
    if (mapping.logistics_phone === mapping.contact_phone) delete mapping.contact_phone;
    if (mapping.logistics_email === mapping.contact_email) delete mapping.contact_email;
  }
  return mapping;
}

function enumValue<Values extends Record<string, string>>(value: string, options: Values) {
  return Object.entries(options).find(([key, label]) => [key, label].some((item) => normalizeText(item) === normalizeText(value)))?.[0] as keyof Values | undefined;
}

export type ImportRow = {
  number: number;
  name: string;
  company?: CompanyFormData;
  contacts: ContactFormData[];
  problems: string[];
  matches: Company[];
  earlierRows: number[];
};

export type ImportChoice = "skip" | "create" | `company:${string}` | `row:${number}`;
export type ImportResult = { companyId: string; createdCompany: boolean; newContacts: number; skippedContacts: number };
export type ImportRequest = {
  requestId: string;
  company: CompanyFormData;
  contacts: ContactFormData[];
  existingCompany?: string;
  allowPossibleDuplicate?: boolean;
};

function addToIndex<Entry>(index: Map<string, Entry[]>, key: string, value: Entry) {
  const bucket = index.get(key) ?? [];
  bucket.push(value);
  index.set(key, bucket);
}

export function prepareRows(sheet: Sheet, header: number, mapping: ColumnMapping, companies: Company[]): ImportRow[] {
  const existing = new Map<string, Company[]>();
  const prior = new Map<string, number[]>();
  for (const company of companies) {
    for (const key of duplicateKeys(company)) addToIndex(existing, key, company);
  }
  return sheet.rows.slice(header + 1).flatMap((row, offset) => {
    if (!row.some((cell) => textCell(cell))) return [];
    const raw = (key: MappingField) => mapping[key] === undefined ? undefined : row[mapping[key]];
    const get = (key: MappingField) => textCell(raw(key));
    const number = header + offset + 2;
    const problems: string[] = [];
    const name = get("name");
    const servicesInput = get("suggested_services").split(/[|;,]/).map((value) => value.trim()).filter(Boolean);
    const suggested = servicesInput.map((value) => services.find((item) => normalizeText(item) === normalizeText(value)));
    if (suggested.some((service) => !service)) problems.push("Suggested services contain an unknown service.");
    const status = get("status") ? enumValue(get("status"), leadStatuses) : "NEW";
    if (!status) problems.push("Follow-up status is unrecognized.");
    const companyCheck = companySchema.safeParse({
      ...emptyCompany, name, website: get("website"), address: get("address"), city: get("city"),
      province: get("province"), industry: get("industry"), company_type: get("company_type"), source_url: get("source_url"),
      suggested_services: [...new Set(suggested.filter((item) => item !== undefined))], verified_on: get("verified_on"),
      notes: get("notes"), source_type: "IMPORT", status: status ?? "NEW",
    });
    if (!companyCheck.success) problems.push(...companyCheck.error.issues.map(({ path, message }) => {
      const label = fields[path[0] as MappingField]?.[0] ?? "Company";
      return `${label}: ${message}`;
    }));

    const contacts: ContactFormData[] = [];
    for (const [label, key, phoneKey, emailKey, defaultRole] of [
      ["Receptionist", "receptionist", "receptionist_phone", "receptionist_email", "RECEPTIONIST"],
      ["Logistics PIC", "logistics", "logistics_phone", "logistics_email", "LOGISTICS_PIC"],
      ["Contact", "contact", "contact_phone", "contact_email", "OTHER"],
    ] as const) {
      const contactName = get(key);
      const phone = get(phoneKey).replace(/^'(?=\+\d)/, "");
      const email = get(emailKey);
      const roleValue = key === "contact" ? get("contact_role") : "";
      if (!contactName && !phone && !email && !roleValue) continue;
      if (typeof raw(phoneKey) === "number") problems.push(`${label} phone: store phone numbers as text to preserve leading zeros.`);
      const role = roleValue ? enumValue(roleValue, contactRoles) : defaultRole;
      if (!role) problems.push(`${label} role is unrecognized.`);
      const contact = contactSchema.safeParse({ ...emptyContact, name: contactName, phone, email,
        role: role ?? defaultRole, is_primary: key !== "contact" });
      if (contact.success) contacts.push(contact.data);
      else problems.push(...contact.error.issues.map(({ path, message }) => `${label} ${String(path[0])}: ${message}`));
    }

    const company = companyCheck.success && !problems.length ? companyCheck.data : undefined;
    const keys = company ? duplicateKeys(company) : [];
    const matches = [...new Set(keys.flatMap((key) => existing.get(key) ?? []))];
    const earlierRows = [...new Set(keys.flatMap((key) => prior.get(key) ?? []))].sort((a, b) => a - b);
    for (const key of keys) addToIndex(prior, key, number);
    return [{ number, name, company, contacts, problems, matches, earlierRows }];
  });
}

export function initialChoice(row: ImportRow): ImportChoice {
  return row.company && !row.matches.length && !row.earlierRows.length ? "create" : "skip";
}

export function contactMatches(draft: ContactFormData, existing: ContactFormData) {
  if (draft.role !== existing.role) return false;
  const name = (text: string) => normalizeText(text).replace(/ /g, "");
  const phone = (text: string) => text.replace(/\D/g, "");
  return name(draft.name) === name(existing.name)
    || Boolean(draft.email && draft.email.toLowerCase() === existing.email.toLowerCase())
    || Boolean(draft.phone && phone(draft.phone) === phone(existing.phone));
}
