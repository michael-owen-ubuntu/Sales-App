import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { contactRoles, contactSchema, emptyContact, type Contact, type ContactFormData } from "./model";

const fields = [["name", "Name", "text"], ["phone", "Phone number", "tel"], ["email", "Email address", "email"], ["source_url", "Source URL", "url"]] as const;

export function ContactDialog({ contact, onClose, onSave }: {
  contact?: Contact;
  onClose: () => void;
  onSave: (data: ContactFormData, id?: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const form = useForm<ContactFormData>({ resolver: zodResolver(contactSchema), defaultValues: contact ?? emptyContact });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (data) => {
    setError("");
    try {
      await onSave(data, contact?.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save contact.");
    }
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle><DialogDescription>Record a business contact and their role at this company.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={submit} noValidate>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="grid gap-1.5">
            <Label htmlFor="contact-role">Role</Label>
            <Controller name="role" control={form.control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="contact-role" ref={field.ref} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(contactRoles).map(([key, label]) => <SelectItem value={key} key={key}>{label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </div>
          {fields.map(([name, label, type]) => (
            <div key={name} className="grid gap-1.5">
              <Label htmlFor={`contact-${name}`}>{label}</Label>
              <Input id={`contact-${name}`} type={type} aria-required={name === "name"} aria-invalid={Boolean(errors[name])}
                aria-describedby={errors[name] ? `contact-error-${name}` : undefined} {...form.register(name)} />
              {errors[name] && <p id={`contact-error-${name}`} className="text-xs text-destructive">{errors[name]?.message}</p>}
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" {...form.register("is_primary")} />Preferred contact for this role
          </label>
          <DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>Cancel</Button><Button disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save contact"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
