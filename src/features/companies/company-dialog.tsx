import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { companySchema, emptyCompany, findDuplicates, leadStatuses, services, type Company, type CompanyFormData } from "./model";

const fields = [
  ["name", "Company name"], ["website", "Website"], ["address", "Address"], ["city", "City"],
  ["province", "Province"], ["industry", "Industry"], ["company_type", "Company type"], ["source_type", "Lead source"],
  ["source_url", "Evidence URL"], ["verified_on", "Last verified"],
] as const;

export function CompanyDialog({ company, companies, onClose, onSave }: {
  company?: Company;
  companies: Company[];
  onClose: () => void;
  onSave: (data: CompanyFormData, id?: string) => Promise<void>;
}) {
  const [duplicates, setDuplicates] = useState<Company[]>([]);
  const [error, setError] = useState("");
  const form = useForm<CompanyFormData>({ resolver: zodResolver(companySchema), defaultValues: company ?? emptyCompany });
  const { errors, isSubmitting } = form.formState;

  async function submit(data: CompanyFormData, reviewed = false) {
    setError("");
    const matches = findDuplicates(data, companies, company?.id);
    if (matches.length && !reviewed) {
      setDuplicates(matches);
      return;
    }
    try {
      await onSave(data, company?.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save company.");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{company ? "Edit company" : "Add company"}</DialogTitle>
          <DialogDescription>Enter the details you have verified. Optional fields can stay blank.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" noValidate onSubmit={form.handleSubmit((data) => submit(data))} onChange={() => setDuplicates([])}>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {duplicates.length > 0 && (
            <Alert><AlertTitle>Possible duplicates</AlertTitle><AlertDescription>
              {duplicates.map((candidate) => <p key={candidate.id}>{candidate.name}{candidate.city && ` · ${candidate.city}`}{candidate.archived_at && " (archived)"}</p>)}
              <p>Check the existing records before saving a separate company.</p>
            </AlertDescription></Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([name, label]) => (
              <div key={name} className="grid content-start gap-1.5">
                <Label htmlFor={`company-${name}`}>{label}</Label>
                <Input id={`company-${name}`} type={name === "verified_on" ? "date" : "text"}
                  placeholder={name === "website" || name === "source_url" ? "https://" : undefined}
                  aria-required={name === "name"} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `error-${name}` : undefined} {...form.register(name)} />
                {errors[name] && <p id={`error-${name}`} className="text-xs text-destructive">{errors[name]?.message}</p>}
              </div>
            ))}
            <div className="grid content-start gap-1.5">
              <Label htmlFor="company-status">Follow-up status</Label>
              <Controller name="status" control={form.control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="company-status" ref={field.ref} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(leadStatuses).map(([key, label]) => <SelectItem value={key} key={key}>{label}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            </div>
          </div>
          <fieldset className="rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Suggested services</legend>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {services.map((service) => <label key={service} className="flex items-center gap-2"><input className="accent-primary" type="checkbox" value={service} {...form.register("suggested_services")} />{service}</label>)}
            </div>
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="company-notes">Notes</Label>
            <Textarea id="company-notes" aria-invalid={Boolean(errors.notes)} {...form.register("notes")} />
            {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button>
            {duplicates.length > 0
              ? <Button type="button" disabled={isSubmitting} onClick={form.handleSubmit((data) => submit(data, true))}>Save separate record</Button>
              : <Button disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save company"}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
