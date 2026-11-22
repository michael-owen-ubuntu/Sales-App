import { describe, expect, it } from "vitest";
import { companySchema, contactSchema, emptyCompany, emptyContact, findDuplicates, normalizeDomain, normalizeName, preferredContact } from "./model";
import { createExampleCrm } from "./repository";

describe("CRM validation", () => {
  it("normalizes Indonesian company names and website hosts for manual review", () => {
    expect(normalizeName("PT. Arúnika Komponen Nusantara, Tbk.")).toBe("arunika komponen nusantara");
    expect(normalizeDomain("https://www.ARUNIKA.example/path/")).toBe("arunika.example");
    expect(findDuplicates({ name: "Arunika Komponen Nusantara", website: "" }, [
      { ...emptyCompany, id: "a", name: "PT Arunika Komponen Nusantara", archived_at: null },
      { ...emptyCompany, id: "b", name: "PT Arunika Komponen Nusantara Abadi", archived_at: null },
    ]).map(({ id }) => id)).toEqual(["a"]);
  });

  it("rejects unsafe websites and invalid contact fields", () => {
    expect(companySchema.safeParse({ ...emptyCompany, name: "PT Test", website: "javascript:alert(1)" }).success).toBe(false);
    expect(companySchema.safeParse({ ...emptyCompany, name: "PT Test", website: "https://person@example.test" }).success).toBe(false);
    expect(companySchema.safeParse({ ...emptyCompany, name: " PT Test ", status: "NEW" }).success).toBe(true);
    expect(contactSchema.safeParse({ ...emptyContact, name: "Test Person", phone: "1234" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...emptyContact, name: "Test Person", email: "bad@" }).success).toBe(false);
    expect(contactSchema.safeParse({ ...emptyContact, name: "Test Person", phone: "+62 812 3456 7890" }).success).toBe(true);
  });

  it("keeps one preferred contact per role and protects archived companies", async () => {
    const crm = createExampleCrm();
    const id = await crm.saveCompany({ ...emptyCompany, name: "PT Test" });
    await crm.saveContact(id, { ...emptyContact, name: "First", is_primary: true });
    await crm.saveContact(id, { ...emptyContact, name: "Preferred", is_primary: true });
    const people = (await crm.list()).contacts.filter((contact) => contact.company_id === id);
    expect(people.filter((contact) => contact.is_primary)).toHaveLength(1);
    expect(preferredContact(people, "LOGISTICS_PIC")?.name).toBe("Preferred");
    await crm.archive(id, true);
    await expect(crm.saveContact(id, { ...emptyContact, name: "Blocked" })).rejects.toThrow("archived");
    await crm.archive(id, false);
    await crm.saveCompany({ ...emptyCompany, name: "PT Test Updated" }, id);
    expect((await crm.list()).companies.find((company) => company.id === id)?.name).toBe("PT Test Updated");
  });
});
