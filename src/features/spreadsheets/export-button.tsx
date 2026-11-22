import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveSpreadsheet, type Format } from "./export";

export function ExportButton({ filename, count, buildRows }: { filename: string; count: number; buildRows: () => string[][] }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("xlsx");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setSaving(true);
    setError("");
    try {
      if (await saveSpreadsheet(filename, buildRows(), format)) setOpen(false);
    } catch {
      setError("Could not save the spreadsheet. Check the destination and try again.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <Button variant="outline" disabled={!count} onClick={() => { setError(""); setOpen(true); }}><Download />Export</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export current view</DialogTitle><DialogDescription>Save {count} {count === 1 ? "record" : "records"} from the current filters.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void download(); }}>
          {error && <Alert variant="destructive"><AlertDescription role="alert">{error}</AlertDescription></Alert>}
          <div className="grid gap-1.5"><Label htmlFor="export-format">File format</Label>
            <NativeSelect id="export-format" value={format} onChange={(event) => setFormat(event.target.value as Format)}>
              <NativeSelectOption value="xlsx">Excel (.xlsx)</NativeSelectOption><NativeSelectOption value="csv">CSV (.csv)</NativeSelectOption>
            </NativeSelect>
          </div>
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={saving}>{saving ? "Saving…" : "Save export"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
