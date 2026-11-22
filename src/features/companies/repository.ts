import type { SupabaseClient } from "@supabase/supabase-js";
import { createExampleDiscovery, createSupabaseDiscovery, type Discovery } from "@/features/discovery/repository";
import { contactMatches, type ImportRequest, type ImportResult } from "@/features/spreadsheets/model";
import { validGooglePlaceId } from "@/lib/google-maps";
import { allRows } from "@/lib/supabase-rows";
import { createExampleFollowUps, createSupabaseFollowUps, type FollowUps } from "@/features/followups/repository";
import { exampleCompanies, exampleContacts } from "./fixtures";
import { companySchema, contactSchema, findDuplicates, normalizeDomain, normalizeName, type Company, type CompanyFormData, type Contact, type ContactFormData } from "./model";

export type Portfolio = { companies: Company[]; contacts: Contact[] };

export interface Crm extends FollowUps, Discovery {
  list: () => Promise<Portfolio>;
  importRow: (request: ImportRequest) => Promise<ImportResult>;
  saveCompany: (data: CompanyFormData, id?: string) => Promise<string>;
  saveGooglePlaceId: (id: string, placeId: string | null) => Promise<void>;
  archive: (id: string, archived: boolean) => Promise<void>;
  saveContact: (companyId: string, data: ContactFormData, id?: string) => Promise<void>;
  removeContact: (companyId: string, id: string) => Promise<void>;
}

function companyPayload(company: Omit<CompanyFormData, "status">) {
  return { ...company, normalized_name: normalizeName(company.name), normalized_domain: normalizeDomain(company.website),
    verified_on: company.verified_on || null };
}

type CompanyRow = Omit<Company, "status" | "verified_on"> & {
  verified_on: string | null;
  sales_leads: { status: Company["status"] } | { status: Company["status"] }[] | null;
};

export function createSupabaseCrm(client: SupabaseClient, userId: string): Crm {
  return {
    ...createSupabaseFollowUps(client, userId),
    ...createSupabaseDiscovery(client, userId),
    async list() {
      const [rows, contacts] = await Promise.all([
        allRows<CompanyRow>((start, end) => client.from("companies").select("*, sales_leads(status)")
          .eq("user_id", userId).order("id").range(start, end)),
        allRows<Contact>((start, end) => client.from("company_contacts").select("*")
          .eq("user_id", userId).order("created_at").order("id").range(start, end)),
      ]);
      return {
        companies: rows.map(({ sales_leads, verified_on, ...row }) => ({
          ...row, verified_on: verified_on ?? "", status: (Array.isArray(sales_leads) ? sales_leads[0]?.status : sales_leads?.status) ?? "NEW",
        })),
        contacts,
      };
    },
    async saveCompany({ status, ...data }, id) {
      const { error, data: savedId } = await client.rpc("save_crm_company", {
        company_id: id ?? null,
        details: companyPayload(data),
        lead_status: status,
      });
      if (error) throw new Error(error.message);
      return savedId;
    },
    async importRow({ requestId, company: { status, ...data }, contacts, existingCompany, allowPossibleDuplicate }) {
      const { error, data: result } = await client.rpc("import_company_row", {
        request_id: requestId,
        details: companyPayload(data),
        lead_status: status,
        contacts,
        existing_company: existingCompany ?? null,
        allow_possible_duplicate: allowPossibleDuplicate ?? false,
      });
      if (error) throw new Error(error.message);
      return result;
    },
    async saveGooglePlaceId(id, placeId) {
      if (placeId !== null && !validGooglePlaceId(placeId)) throw new Error("Enter a valid Google Place ID.");
      const { data, error } = await client.from("companies").update({ google_place_id: placeId })
        .eq("user_id", userId).eq("id", id).is("archived_at", null).select("id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Company is unavailable or archived.");
    },
    async archive(id, archived) {
      const { data, error } = await client.from("companies").update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("user_id", userId).eq("id", id).select("id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Company is unavailable.");
    },
    async saveContact(companyId, data, id) {
      const { error } = await client.rpc("save_crm_contact", { company_id: companyId, contact_id: id ?? null, details: data });
      if (error) throw new Error(error.message);
    },
    async removeContact(companyId, id) {
      const { data, error } = await client.from("company_contacts").delete()
        .eq("user_id", userId).eq("company_id", companyId).eq("id", id).select("id").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Contact is unavailable.");
    },
  };
}

export function createExampleCrm(): Crm {
  let companies: Company[] = exampleCompanies.map((company) => ({ ...company, google_place_id: null }));
  let contacts = [...exampleContacts];
  const receipts = new Map<string, ImportResult>();

  function requireActiveCompany(id: string) {
    if (!companies.some((company) => company.id === id && !company.archived_at)) {
      throw new Error("Company is unavailable or archived.");
    }
  }

  const followUps = createExampleFollowUps(requireActiveCompany, (companyId, contactId) =>
    contacts.find((contact) => contact.company_id === companyId && contact.id === contactId)?.name,
  );

  function saveCompany(data: CompanyFormData, id?: string) {
    if (id) requireActiveCompany(id);
    const previous = companies.find((company) => company.id === id);
    const saved = { ...data, id: id ?? crypto.randomUUID(), archived_at: null, google_place_id: previous?.google_place_id ?? null };
    if (previous && previous.status !== saved.status) {
      followUps.recordStatus(saved.id, "LEAD", "", previous.status, saved.status);
    }
    companies = [...companies.filter((company) => company.id !== saved.id), saved];
    return saved.id;
  }

  const discovery = createExampleDiscovery(() => companies, (company, roster) => {
    const id = saveCompany(company);
    contacts = [...contacts, ...roster.map((contact) => ({ ...contact, company_id: id, id: crypto.randomUUID() }))];
    return id;
  });

  return {
    ...followUps.api,
    ...discovery.api,
    async saveCompany(data, id) { return saveCompany(data, id); },
    async list() {
      return { companies, contacts };
    },
    async importRow({ requestId, company, contacts: roster, existingCompany, allowPossibleDuplicate }) {
      const previous = receipts.get(requestId);
      if (previous) return previous;
      const draft = companySchema.parse({ ...company, source_type: "IMPORT" });
      const entries = roster.map((contact) => contactSchema.parse(contact));
      if (entries.length > 3) throw new Error("Up to three contacts are supported per row.");
      if (existingCompany) {
        requireActiveCompany(existingCompany);
        if (!entries.length) throw new Error("There are no contacts to add for this row.");
      } else if (!allowPossibleDuplicate && findDuplicates(draft, companies).length) {
        throw new Error("Possible duplicate. Refresh the preview and review the matching company.");
      }

      const companyId = existingCompany ?? saveCompany(draft);
      const added: Contact[] = [];
      const current = contacts.filter((contact) => contact.company_id === companyId);
      for (const entry of entries) {
        const known = [...current, ...added];
        if (known.some((contact) => contactMatches(entry, contact))) continue;
        const isPrimary = entry.is_primary && !known.some((contact) => contact.role === entry.role && contact.is_primary);
        added.push({ ...entry, id: crypto.randomUUID(), company_id: companyId, is_primary: isPrimary });
      }
      contacts = [...contacts, ...added];
      const result = { companyId, createdCompany: !existingCompany, newContacts: added.length, skippedContacts: entries.length - added.length };
      receipts.set(requestId, result);
      return result;
    },
    async saveGooglePlaceId(id, placeId) {
      requireActiveCompany(id);
      if (placeId !== null && !validGooglePlaceId(placeId)) throw new Error("Enter a valid Google Place ID.");
      companies = companies.map((company) => company.id === id ? { ...company, google_place_id: placeId } : company);
    },
    async archive(id, archived) {
      companies = companies.map((company) => company.id === id
        ? { ...company, archived_at: archived ? new Date().toISOString() : null }
        : company);
    },
    async saveContact(companyId, data, id) {
      requireActiveCompany(companyId);
      contacts = contacts.filter((contact) => contact.id !== id).map((contact) =>
        data.is_primary && contact.company_id === companyId && contact.role === data.role
          ? { ...contact, is_primary: false }
          : contact,
      );
      contacts = [...contacts, { ...data, company_id: companyId, id: id ?? crypto.randomUUID() }];
    },
    async removeContact(companyId, id) {
      contacts = contacts.filter((contact) => contact.company_id !== companyId || contact.id !== id);
      followUps.detachContact(companyId, id);
    },
  };
}
