import { isTauri } from "@tauri-apps/api/core";
import Papa from "papaparse";
import { leadStatuses, preferredContact, type Company, type Contact } from "@/features/companies/model";
import { dueBucket, dueLabels, taskStatuses, type Task } from "@/features/followups/model";

export type Format = "csv" | "xlsx";

export function spreadsheetText(value: string) {
  // Protect text that a spreadsheet application could interpret as a formula.
  return /^[\t\r\n]|^[\p{White_Space}\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(value) ? "'" + value : value;
}

export function makeCsv(rows: string[][]) {
  return "\uFEFF" + Papa.unparse(rows.map((row) => row.map(spreadsheetText)), { quotes: true, newline: "\r\n" });
}

export async function makeXlsx(rows: string[][]) {
  const { default: writeWorkbook } = await import("write-excel-file/browser");
  return writeWorkbook(rows.map((row, index) => row.map((value) =>
    ({ value, type: String, ...(index === 0 ? { fontWeight: "bold" as const } : {}) }),
  ))).toBlob();
}

export async function saveSpreadsheet(name: string, rows: string[][], format: Format) {
  const blob = format === "csv" ? new Blob([makeCsv(rows)], { type: "text/csv;charset=utf-8" }) : await makeXlsx(rows);
  const filename = `${name}.${format}`;
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const target = await save({ defaultPath: filename, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (target === null) return false;
    await writeFile(target, new Uint8Array(await blob.arrayBuffer()));
  } else {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.download = filename;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return true;
}

export function companyExport(companies: Company[], contacts: Contact[]) {
  const grouped = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const roster = grouped.get(contact.company_id) ?? [];
    roster.push(contact);
    grouped.set(contact.company_id, roster);
  }
  return [[
    "Company name", "Website", "Address", "City", "Province", "Industry", "Company type", "Follow-up status",
    "Receptionist name", "Receptionist phone", "Receptionist email", "Logistics contact person", "Logistics PIC phone",
    "Logistics PIC email", "Suggested services", "Lead source", "Evidence URL", "Last verified", "Notes", "Archived at",
  ], ...companies.map((company) => {
    const roster = grouped.get(company.id) ?? [];
    const receptionist = preferredContact(roster, "RECEPTIONIST");
    const logistics = preferredContact(roster, "LOGISTICS_PIC");
    return [
      company.name, company.website, company.address, company.city, company.province, company.industry, company.company_type,
      leadStatuses[company.status], receptionist?.name ?? "", receptionist?.phone ?? "", receptionist?.email ?? "",
      logistics?.name ?? "", logistics?.phone ?? "", logistics?.email ?? "", company.suggested_services.join(" | "),
      company.source_type, company.source_url, company.verified_on, company.notes, company.archived_at ?? "",
    ];
  })];
}

export function followUpExport(tasks: Task[], companies: Company[], now: Date) {
  const names = new Map(companies.map(({ id, name }) => [id, name]));
  return [["Company name", "Task", "Status", "Due bucket", "Due at (UTC)", "Completed at (UTC)", "Notes"],
    ...tasks.map((task) => {
      const bucket = dueBucket(task, now);
      return [names.get(task.company_id) ?? "", task.title, taskStatuses[task.status], bucket ? dueLabels[bucket] : "",
        new Date(task.due_at).toISOString(), task.completed_at ? new Date(task.completed_at).toISOString() : "", task.notes];
    })];
}
