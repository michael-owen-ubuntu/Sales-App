import { Unzip, UnzipInflate, zipSync } from "fflate";
import Papa from "papaparse";

export const maxFileBytes = 5 * 1024 * 1024;
export const maxSheetRows = 1025;
export const maxColumns = 64;
export type Cell = string | number | boolean | Date | null;
export type Sheet = { name: string; rows: Cell[][] };

const maxExpandedBytes = 16 * 1024 * 1024;
const maxSheets = 10;

function cellColumn(value: string) {
  return [...value].reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0);
}

function inspectXml(name: string, data: Uint8Array) {
  if (!/\.(xml|rels)$/i.test(name)) return false;
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Workbook XML declarations are unsupported.");
  if (!/<(?:[\w.-]+:)?worksheet[\s>]/i.test(xml)) return false;

  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.documentElement.localName !== "worksheet" || document.getElementsByTagName("parsererror").length) {
    throw new Error("A worksheet contains invalid XML.");
  }
  const rows = document.getElementsByTagNameNS("*", "row");
  const cells = document.getElementsByTagNameNS("*", "c");
  if (rows.length > maxSheetRows || cells.length > maxSheetRows * maxColumns) throw new Error("A worksheet exceeds the import size limits.");
  for (const row of Array.from(rows)) {
    const index = row.getAttribute("r");
    if (index && (!/^\d{1,4}$/.test(index) || Number(index) > maxSheetRows)) {
      throw new Error("A worksheet has rows beyond the import limit.");
    }
  }
  for (const cell of Array.from(cells)) {
    const address = cell.getAttribute("r");
    if (!address) continue;
    const match = /^([A-Z]{1,2})(\d{1,4})$/.exec(address);
    if (!match || cellColumn(match[1]) > maxColumns || Number(match[2]) > maxSheetRows) {
      throw new Error("A worksheet has cells beyond the import limits.");
    }
  }
  return true;
}

// Check actual decompressed bytes and pass only those verified entries to the workbook reader.
function boundedWorkbook(input: Uint8Array) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const seen = new Set<string>();
  let total = 0;
  let sheets = 0;
  let completed = 0;
  let rejection: unknown;
  const unzip = new Unzip((entry) => {
    const name = entry.name;
    if (seen.size >= 256 || seen.has(name) || !/^[-\w. /[\]]+$/.test(name)
      || name.startsWith("/") || name.split("/").some((segment) => segment === ".." || segment === ".")) {
      throw new Error("Workbook archive entries are unsupported.");
    }
    seen.add(name);
    let offset = 0;
    const parts: Uint8Array[] = [];
    entry.ondata = (error, chunk, final) => {
      if (error) throw rejection ?? new Error("The workbook archive could not be read.");
      total += chunk.byteLength;
      if (total > maxExpandedBytes) {
        rejection = new Error("The expanded workbook exceeds 16 MiB.");
        throw rejection;
      }
      if (chunk.length) parts.push(chunk);
      offset += chunk.length;
      if (!final) return;
      const data = new Uint8Array(offset);
      let cursor = 0;
      for (const part of parts) {
        data.set(part, cursor);
        cursor += part.length;
      }
      try {
        if (inspectXml(name, data) && ++sheets > maxSheets) throw new Error("Workbooks can contain up to 10 worksheets.");
      } catch (cause) {
        rejection = cause;
        throw cause;
      }
      entries[name] = data;
      completed++;
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < input.length; offset += 4096) {
    unzip.push(input.subarray(offset, offset + 4096), offset + 4096 >= input.length);
  }
  if (!sheets || seen.size !== completed) throw new Error("The file does not contain a complete XLSX worksheet.");
  return zipSync(entries, { level: 0 });
}

export async function readSheets(file: File): Promise<Sheet[]> {
  if (!file.size || file.size > maxFileBytes) throw new Error("Choose a nonempty file up to 5 MiB.");
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  let sheets: Sheet[];
  if (extension === "csv") {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    const parsed = Papa.parse<string[]>(content, { preview: maxSheetRows + 2, dynamicTyping: false, delimitersToGuess: [",", ";", "\t"] });
    if (parsed.errors.some(({ code }) => code !== "UndetectableDelimiter")) throw new Error("The CSV contains invalid quoting or separators.");
    const rows = parsed.data;
    while (rows.length && rows[rows.length - 1].every((value) => !value.trim())) rows.pop();
    if (parsed.meta.truncated) throw new Error("The CSV exceeds the row limit.");
    sheets = [{ name: "CSV", rows }];
  } else if (extension === "xlsx") {
    const { default: readWorkbook } = await import("read-excel-file/browser");
    const workbook = boundedWorkbook(new Uint8Array(await file.arrayBuffer()));
    sheets = (await readWorkbook(workbook, { trim: false })).map(({ sheet, data }) => ({ name: sheet, rows: data }));
  } else {
    throw new Error("Choose an XLSX workbook or a UTF-8 CSV file.");
  }

  if (sheets.some(({ rows }) => rows.length > maxSheetRows || rows.some((row) => row.length > maxColumns))) {
    throw new Error(`A sheet exceeds ${maxSheetRows} rows or ${maxColumns} columns.`);
  }
  if (sheets.some(({ rows }) => rows.some((row) => row.some((cell) => cell instanceof Date && !Number.isFinite(cell.getTime()))))) {
    throw new Error("A worksheet contains an unrecognized date.");
  }
  return sheets.filter(({ rows }) => rows.some((row) => row.some((cell) => cell !== null && String(cell).trim())));
}
