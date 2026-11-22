// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { emptyCompany, emptyContact } from "@/features/companies/model";
import { createExampleCrm } from "@/features/companies/repository";
import { companyExport, followUpExport, makeCsv, makeXlsx, spreadsheetText } from "./export";
import { readSheets } from "./files";
import { guessMapping, initialChoice, prepareRows } from "./model";

describe("spreadsheet parsing and planning", () => {
  it("maps Indonesian CSV headers, preserves text phone numbers, and reports duplicates and invalid rows", async () => {
    const [sheet] = await readSheets(new File([
      "\uFEFFNama perusahaan;Kota;Nama PIC;Nomor HP;Email;Status\r\n",
      'PT. Uji Nusantara;Bekasi;Dita;08123456789;dita@example.test;Contacted\r\n',
      'PT Uji Nusantara;Bekasi;Rani;+628555555555;rani@example.test;New\r\n',
      'CV Rusak;Bandung;Siti;123;salah;Bad status\r\n',
    ], "fixture.csv"));
    const rows = prepareRows(sheet, 0, guessMapping(sheet.rows[0]), []);
    expect(rows[0].company).toMatchObject({ name: "PT. Uji Nusantara", city: "Bekasi", status: "CONTACTED" });
    expect(rows[0].contacts[0]).toMatchObject({ name: "Dita", phone: "08123456789", role: "OTHER" });
    expect(rows[1].earlierRows).toEqual([2]);
    expect(initialChoice(rows[1])).toBe("skip");
    expect(rows[2].problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/unrecognized/), expect.stringMatching(/phone/), expect.stringMatching(/email/),
    ]));
  });

  it("round-trips XLSX literal strings and rejects sparse worksheets past the row and column bounds", async () => {
    const workbook = await makeXlsx([["Company name", "Notes"], ["PT Test", "=1+1"]]);
    const [sheet] = await readSheets(new File([workbook], "fixture.xlsx"));
    expect(sheet.rows[1]).toEqual(["PT Test", "=1+1"]);
    const files = unzipSync(new Uint8Array(await workbook.arrayBuffer()));
    const name = Object.keys(files).find((path) => /worksheets\/sheet1.xml$/.test(path))!;
    const sheetXml = new TextDecoder().decode(files[name]);
    expect(sheetXml).not.toMatch(/<f[\s>]/);
    files[name] = strToU8(sheetXml.replace(/r="A2"/, 'r="XFD9999"'));
    const bad = zipSync(files);
    await expect(readSheets(new File([Uint8Array.from(bad)], "sparse.xlsx"))).rejects.toThrow("beyond the import limits");
  });

  it("rejects oversized input and unsupported extensions", async () => {
    await expect(readSheets(new File(["test"], "data.xls"))).rejects.toThrow("XLSX");
    await expect(readSheets(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "data.csv"))).rejects.toThrow("5 MiB");
  });

  it("does not silently coerce numeric spreadsheet phone values", () => {
    const sheet = { name: "Phone", rows: [["Company name", "Contact name", "Contact phone"], ["PT Example", "Person", 8123456789]] };
    const [row] = prepareRows(sheet, 0, guessMapping(sheet.rows[0]), []);
    expect(row.company).toBeUndefined();
    expect(row.problems.some((problem) => problem.includes("leading zeros"))).toBe(true);
  });
});

describe("import receipts and export safety", () => {
  it("preserves existing contacts and does not replay a successful row", async () => {
    const crm = createExampleCrm();
    const company = { ...emptyCompany, name: "PT Import Example", notes: "Keep this note" };
    const contact = { ...emptyContact, name: "Preferred Person", is_primary: true, email: "preferred@example.test" };
    const result = await crm.importRow({ requestId: "first", company, contacts: [contact] });
    expect(await crm.importRow({ requestId: "first", company, contacts: [contact] })).toEqual(result);
    const added = await crm.importRow({
      requestId: "secondary", company: { ...company, notes: "Overwrite attempt" }, existingCompany: result.companyId,
      contacts: [contact, { ...contact, name: "Other Person", email: "other@example.test" }],
    });
    expect(added).toMatchObject({ newContacts: 1, skippedContacts: 1 });
    const { companies, contacts } = await crm.list();
    expect(companies.filter(({ name }) => name === company.name)).toMatchObject([{ notes: "Keep this note" }]);
    expect(contacts.filter(({ company_id, is_primary }) => company_id === result.companyId && is_primary)).toMatchObject([{ name: "Preferred Person" }]);
  });

  it("neutralizes formula-shaped CSV cells and preserves safe rows", () => {
    for (const unsafe of ["=1+1", " +SUM(1,2)", "-1", "@x", "\u200B=1", "\r=x", "＝cmd", "\ttext"]) {
      expect(spreadsheetText(unsafe)).toBe("'" + unsafe);
    }
    expect(makeCsv([["Text"], ['safe, with "quotes"'], ['="linked"']])).toBe(
      `\uFEFF"Text"\r\n"safe, with ""quotes"""\r\n"'=""linked"""`,
    );
  });

  it("exports exactly the supplied view of companies and tasks", async () => {
    const crm = createExampleCrm();
    const { companies, contacts } = await crm.list();
    const { tasks } = await crm.listFollowUps();
    expect(companyExport(companies.slice(0, 1), contacts)).toHaveLength(2);
    expect(companyExport(companies.slice(0, 1), contacts)[1]).toContain("Dewi (example)");
    expect(followUpExport(tasks.slice(0, 1), companies, new Date())[1][0]).toBe("PT Bumi Pangan Lestari");
    expect(followUpExport(tasks.slice(0, 1), companies, new Date())).toHaveLength(2);
  });
});
