import { describe, expect, it } from "vitest";
import { createExampleCrm } from "@/features/companies/repository";
import examples from "./examples.json";
import { discoveryDraft } from "./model";
import { createExampleDiscovery } from "./repository";

describe("discovery staging and review", () => {
  it("keeps one candidate per fingerprint and preserves a prior decision on retry", async () => {
    const { stage, api } = createExampleDiscovery(() => [], () => "unneeded");
    const draft = examples[0];
    const id = stage(draft);
    await api.reviewCandidate(id, "NEEDS_REVIEW", "Check the directory.");
    expect(stage({ ...draft, company_name: "Conflicting retry" })).toBe(id);
    expect((await api.listDiscovery()).candidates.filter((item) => item.id === id)).toMatchObject([
      { company_name: draft.company_name, status: "NEEDS_REVIEW" },
    ]);
    expect((await api.listDiscovery()).reviews).toHaveLength(1);
  });

  it("requires safe links and direct evidence for service suggestions", () => {
    const draft = examples[0];
    expect(discoveryDraft.safeParse({ ...draft, source_url: "https://user@site.example" }).success).toBe(false);
    expect(discoveryDraft.safeParse({ ...draft, suggested_services: [
      { service: "Sea freight", reason: "Reason", evidence_url: "https://wrong.example" },
    ] }).success).toBe(false);
    expect(discoveryDraft.safeParse(draft).success).toBe(true);
  });

  it("accepts one CRM record, keeps evidence, and leaves contacts blank", async () => {
    const crm = createExampleCrm();
    const id = "example:cakrawala-exhibitor";
    await crm.reviewCandidate(id, "NEEDS_REVIEW", "Check the source.");
    const companyId = await crm.reviewCandidate(id, "ACCEPTED", "Confirmed");
    expect(await crm.reviewCandidate(id, "ACCEPTED", "Network retry")).toBe(companyId);
    const data = await crm.list();
    expect(data.companies.filter(({ id }) => id === companyId)).toMatchObject([
      { name: "PT Cakrawala Kemasan Indonesia", source_type: "DISCOVERY", status: "NEW",
        suggested_services: ["Sea freight", "Domestic trucking"] },
    ]);
    expect(data.contacts.some(({ company_id }) => company_id === companyId)).toBe(false);
    const inbox = await crm.listDiscovery();
    expect(inbox.candidates.find((candidate) => candidate.id === id)?.evidence).toHaveLength(1);
    expect(inbox.reviews.map(({ new_status }) => new_status)).toEqual(["NEEDS_REVIEW", "ACCEPTED"]);
  });

  it("rejects excluded providers and warns before creating a potential duplicate", async () => {
    const crm = createExampleCrm();
    const initial = await crm.list();
    await expect(crm.reviewCandidate("example:lintas-provider", "ACCEPTED", "", true)).rejects.toThrow("outside");
    await crm.reviewCandidate("example:lintas-provider", "REJECTED", "Logistics provider");
    await expect(crm.reviewCandidate("example:arunika-directory", "ACCEPTED", "")).rejects.toThrow("Possible duplicate");
    await crm.reviewCandidate("example:arunika-directory", "DUPLICATE", "Company already exists");
    expect((await crm.list()).companies).toEqual(initial.companies);
    await expect(crm.reviewCandidate("example:arunika-directory", "NEEDS_REVIEW", "")).rejects.toThrow("already been reviewed");
  });
});
