import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileSpreadsheet } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { portfolioKey, useCrm } from "@/features/companies/crm-context";
import { leadStatuses, type Company } from "@/features/companies/model";
import { WebLink } from "@/components/web-link";
import { saveSpreadsheet } from "./export";
import { readSheets, type Sheet } from "./files";
import { guessMapping, initialChoice, mappingFields, prepareRows, textCell, type ColumnMapping, type ImportChoice, type ImportResult } from "./model";

type RowResult = { receipt?: ImportResult; error?: string };
const pageSize = 20;

export default function ImportDialog({ companies, onClose }: { companies: Company[]; onClose: () => void }) {
  const crm = useCrm();
  const cache = useQueryClient();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [filename, setFilename] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [choices, setChoices] = useState<Record<number, ImportChoice>>({});
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const receipts = useRef(new Map<string, string>());
  const sheet = sheets[sheetIndex];
  const columns = sheet?.rows[header] ?? [];
  const rows = useMemo(() => sheet && mapping.name !== undefined
    ? prepareRows(sheet, header, mapping, companies) : [], [sheet, header, mapping, companies]);

  const defaults = useMemo(() => new Map(rows.map((row) => [row.number, initialChoice(row)])), [rows]);
  const actionFor = (number: number) => choices[number] ?? defaults.get(number) ?? "skip";
  const pending = rows.filter((row) => row.company && actionFor(row.number) !== "skip" && !results[row.number]?.receipt);
  const invalid = rows.filter((row) => row.problems.length).length;
  const duplicates = rows.filter((row) => row.matches.length || row.earlierRows.length).length;
  const saved = Object.values(results).filter((result) => result.receipt);
  const errors = Object.values(results).filter((result) => result.error).length;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const busy = loading || importing || reporting;

  function switchSheet(collection: Sheet[], index: number) {
    setSheetIndex(index);
    const rows = collection[index]?.rows ?? [];
    const first = Math.max(0, rows.findIndex((row) => row.some((cell) => textCell(cell))));
    setHeader(first);
    setMapping(guessMapping(rows[first] ?? []));
    setChoices({});
    setPage(0);
  }

  async function load(file?: File) {
    if (!file) return;
    setError("");
    setProgress("");
    setSheets([]);
    setFilename("");
    setLoading(true);
    try {
      const next = await readSheets(file);
      if (!next.length) throw new Error("No populated worksheets were found.");
      setSheets(next);
      setFilename(file.name);
      switchSheet(next, 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the spreadsheet.");
    } finally {
      setLoading(false);
    }
  }

  function changeHeader(value: number) {
    setHeader(value);
    setMapping(guessMapping(sheet?.rows[value] ?? []));
    setChoices({});
    setPage(0);
  }

  function changeMapping(field: keyof ColumnMapping, value: string) {
    setMapping((current) => {
      const next = { ...current };
      if (value === "") delete next[field];
      else next[field] = Number(value);
      return next;
    });
    setChoices({});
    setPage(0);
  }

  async function importSelection() {
    setStarted(true);
    setImporting(true);
    setError("");
    const completed = new Map<number, string>();
    for (const [number, result] of Object.entries(results)) {
      if (result.receipt) completed.set(Number(number), result.receipt.companyId);
    }
    let success = 0;
    try {
      for (const [index, row] of pending.entries()) {
        const choice = actionFor(row.number);
        setProgress(`Processing ${index + 1} of ${pending.length} selected rows…`);
        try {
          const targetRow = choice.startsWith("row:") ? Number(choice.slice(4)) : undefined;
          const existingCompany = targetRow === undefined
            ? (choice.startsWith("company:") ? choice.slice(8) : undefined)
            : completed.get(targetRow);
          if (targetRow !== undefined && !existingCompany) throw new Error(`Row ${targetRow} must be imported successfully first.`);
          const requestKey = `${row.number}:${choice}:${existingCompany ?? ""}`;
          let requestId = receipts.current.get(requestKey);
          if (!requestId) {
            requestId = crypto.randomUUID();
            receipts.current.set(requestKey, requestId);
          }
          const receipt = await crm.importRow({
            requestId, company: row.company!, contacts: row.contacts, existingCompany,
            allowPossibleDuplicate: choice === "create" && Boolean(row.matches.length || row.earlierRows.length),
          });
          completed.set(row.number, receipt.companyId);
          setResults((current) => ({ ...current, [row.number]: { receipt } }));
          success++;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The row could not be saved.";
          setResults((current) => ({ ...current, [row.number]: { error: message } }));
        }
      }
      await cache.invalidateQueries({ queryKey: portfolioKey });
      setProgress(`Saved ${success} of ${pending.length} selected rows.`);
    } finally {
      setImporting(false);
    }
  }

  const issues = rows.flatMap((row) => {
    const result = results[row.number];
    if (result?.receipt) return [];
    const message = result?.error || row.problems.join(" | ") ||
      (actionFor(row.number) === "skip" ? row.matches.length || row.earlierRows.length ? "Possible duplicate skipped." : "Row skipped." : "");
    return message ? [[String(row.number), row.name, message]] : [];
  });

  async function downloadReport() {
    setReporting(true);
    setError("");
    try {
      await saveSpreadsheet("gpi-import-errors", [["Row", "Company", "Issue"], ...issues], "csv");
    } catch {
      setError("Could not save the import report.");
    } finally {
      setReporting(false);
    }
  }

  function reset() {
    setSheets([]);
    setFilename("");
    setStarted(false);
    setResults({});
    setChoices({});
    setError("");
    setProgress("");
    receipts.current.clear();
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FileSpreadsheet size={19} aria-hidden="true" />Import companies and contacts</DialogTitle>
        <DialogDescription>Choose an XLSX or UTF-8 CSV file, map the columns, then review the rows before saving.</DialogDescription>
      </DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
      {!started && <div className="grid gap-2">
        <Label htmlFor="import-file">Spreadsheet file</Label>
        <Input id="import-file" type="file" accept=".xlsx,.csv" className="max-w-md" disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void load(file); }} />
        {filename
          ? <p className="wrap-anywhere text-xs text-muted-foreground">Loaded {filename}</p>
          : <p className="text-xs text-muted-foreground">Up to 5 MiB and 1,025 rows per sheet. Keep phone numbers as text.</p>}
      </div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Reading the spreadsheet locally…</p>}

      {sheet && <>
        <div className="flex flex-wrap gap-4">
          {sheets.length > 1 && <div className="grid gap-1.5"><Label htmlFor="import-sheet">Worksheet</Label>
            <NativeSelect id="import-sheet" value={sheetIndex} disabled={started || busy} onChange={(event) => switchSheet(sheets, Number(event.target.value))}>
              {sheets.map(({ name }, index) => <NativeSelectOption key={index} value={index}>{name}</NativeSelectOption>)}
            </NativeSelect>
          </div>}
          <div className="grid gap-1.5"><Label htmlFor="import-header">Header row</Label>
            <NativeSelect id="import-header" value={header} disabled={started || busy} onChange={(event) => changeHeader(Number(event.target.value))}>
              {sheet.rows.map((row, index) => row.some((cell) => textCell(cell)) && <NativeSelectOption key={index} value={index}>Row {index + 1}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>

        <details open={!started && mapping.name === undefined} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Column mapping <span className="ml-1 font-normal text-muted-foreground">· {Object.keys(mapping).length} mapped</span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {mappingFields.map(([field, [label]]) => <div key={field} className="grid min-w-0 gap-1">
              <Label className="text-xs" htmlFor={`map-${field}`}>{label}{field === "name" ? " (required)" : ""}</Label>
              <NativeSelect className="w-full" id={`map-${field}`} value={mapping[field] ?? ""} disabled={started || busy} onChange={(event) => changeMapping(field, event.target.value)}>
                <NativeSelectOption value="">Unmapped</NativeSelectOption>
                {columns.map((cell, index) => <NativeSelectOption key={index} value={index}>
                  {index + 1}. {textCell(cell).slice(0, 90) || "Blank header"}
                </NativeSelectOption>)}
              </NativeSelect>
            </div>)}
          </div>
        </details>

        {mapping.name === undefined ? <p className="text-sm text-muted-foreground">Map a company name column to preview the rows.</p> : <>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="mr-1 text-sm">Import preview</strong>
            <Badge variant="outline">{rows.length} {rows.length === 1 ? "row" : "rows"}</Badge>
            <Badge variant="outline">{pending.length} selected</Badge>
            {invalid > 0 && <Badge variant="destructive">{invalid} invalid</Badge>}
            {duplicates > 0 && <Badge className="bg-amber-50 text-amber-900">{duplicates} possible duplicates</Badge>}
            {saved.length > 0 && <Badge className="bg-emerald-50 text-emerald-800">{saved.length} rows saved</Badge>}
            {errors > 0 && <Badge variant="destructive">{errors} save errors</Badge>}
          </div>
          {!rows.length ? <p className="text-sm text-muted-foreground">No data rows below this header.</p> : <div className="rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50"><TableRow><TableHead>Row</TableHead><TableHead>Company and contacts</TableHead><TableHead>Review</TableHead><TableHead>Import action</TableHead></TableRow></TableHeader>
              <TableBody>{rows.slice(page * pageSize, (page + 1) * pageSize).map((row) => {
                const receipt = results[row.number]?.receipt;
                const rowError = results[row.number]?.error;
                return <TableRow key={row.number}>
                  <TableCell className="align-top tabular-nums">{row.number}</TableCell>
                  <TableCell className="max-w-60 align-top whitespace-normal">
                    <p className="wrap-anywhere font-semibold">{row.name.slice(0, 200) || "—"}</p>
                    {row.company && <p className="text-xs text-muted-foreground">{[row.company.city, leadStatuses[row.company.status]].filter(Boolean).join(" · ")}</p>}
                    {row.company?.website && <p className="wrap-anywhere text-xs text-muted-foreground"><WebLink value={row.company.website} /></p>}
                    {row.contacts.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">{row.contacts.map((contact, index) => <li key={index} className="wrap-anywhere">
                      {[contact.name, contact.phone, contact.email].filter(Boolean).join(" · ")}
                    </li>)}</ul>}
                  </TableCell>
                  <TableCell className="max-w-80 align-top whitespace-normal">
                    {receipt ? <p className="text-xs text-muted-foreground">{receipt.createdCompany ? "Company added" : "Existing company"} · {receipt.newContacts} contacts added{receipt.skippedContacts > 0 && ` · ${receipt.skippedContacts} matching contacts skipped`}</p>
                      : <>
                        {row.problems.map((problem, index) => <p key={index} className="text-xs text-destructive">{problem}</p>)}
                        {rowError && <p className="text-xs text-destructive">{rowError}</p>}
                        {row.matches.map((company) => <p key={company.id} className="wrap-anywhere text-xs text-muted-foreground">CRM match · {company.name}{company.city && ` · ${company.city}`}{company.archived_at && " (archived)"}</p>)}
                        {row.earlierRows.length > 0 && <p className="text-xs text-muted-foreground">Possible match with {row.earlierRows.length === 1 ? "row" : "rows"} {row.earlierRows.join(", ")}</p>}
                        {!row.problems.length && !rowError && !row.matches.length && !row.earlierRows.length && <p className="text-xs text-muted-foreground">Ready</p>}
                      </>}
                  </TableCell>
                  <TableCell className="align-top">
                    {receipt ? <Badge variant="secondary">Saved</Badge> : !row.company ? <Badge variant="outline">Skipped</Badge>
                      : <NativeSelect aria-label={`Import action for row ${row.number}`} className="max-w-60" value={actionFor(row.number)} disabled={busy} onChange={(event) => setChoices((current) => ({ ...current, [row.number]: event.target.value as ImportChoice }))}>
                        <NativeSelectOption value="skip">Skip</NativeSelectOption>
                        <NativeSelectOption value="create">{row.matches.length || row.earlierRows.length ? "Create separate company" : "Create company"}</NativeSelectOption>
                        {row.contacts.length > 0 && row.matches.filter((company) => !company.archived_at).map((company) =>
                          <NativeSelectOption key={company.id} value={`company:${company.id}`}>Add contacts to {company.name}{company.city && ` · ${company.city}`}</NativeSelectOption>
                        )}
                        {row.contacts.length > 0 && row.earlierRows.map((number) =>
                          <NativeSelectOption key={number} value={`row:${number}`} disabled={!results[number]?.receipt && actionFor(number) === "skip"}>Add contacts to row {number}</NativeSelectOption>
                        )}
                      </NativeSelect>}
                  </TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
            {pages > 1 && <div className="flex items-center justify-end gap-2 border-t p-2">
              <Button variant="outline" size="icon-sm" aria-label="Previous preview page" disabled={page === 0} onClick={() => setPage((current) => current - 1)}><ChevronLeft /></Button>
              <span className="text-xs text-muted-foreground">Page {page + 1} of {pages}</span>
              <Button variant="outline" size="icon-sm" aria-label="Next preview page" disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}><ChevronRight /></Button>
            </div>}
          </div>}
        </>}
      </>}
      {progress && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
      <DialogFooter className="sticky bottom-0 border-t bg-popover pt-3">
        {issues.length > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => void downloadReport()}>Download error report</Button>}
        {started && <Button type="button" variant="outline" disabled={busy} onClick={reset}>Start another import</Button>}
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close</Button>
        {sheet && <Button disabled={busy || !pending.length} onClick={() => void importSelection()}>{importing ? "Importing…" : `Import ${pending.length} ${pending.length === 1 ? "row" : "rows"}`}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
