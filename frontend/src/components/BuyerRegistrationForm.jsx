import { useState } from "react";
import toast from "react-hot-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import api from "@/lib/api";

export const emptyBuyerForm = {
  companyName: "",
  address: "",
  phone: "",
  email: "",
  contactPersonName: "",
  contactDesignation: "",
  natureOfCompany: "Distributor",
  natureOfBusiness: "",
  taxRegistrationNo: "",
  bankDetails: "",
  principleCustomers: "",
  signatoryName: "",
  signatoryDesignation: "",
  msmeNumber: "",
};

// Every supporting document is optional.
const DOCUMENTS = [
  { field: "gstDocument", urlKey: "gstDocumentUrl", label: "GST certificate" },
  { field: "panDocument", urlKey: "panDocumentUrl", label: "PAN card" },
  { field: "bankRecordDocument", urlKey: "bankRecordDocumentUrl", label: "Bank record (cancelled cheque / passbook)" },
  { field: "msmeDocument", urlKey: "msmeDocumentUrl", label: "MSME / Udyam certificate" },
];

const toFormState = (buyer) => {
  const next = { ...emptyBuyerForm };
  Object.keys(emptyBuyerForm).forEach((k) => {
    if (buyer?.[k] !== undefined && buyer?.[k] !== null) next[k] = buyer[k];
  });
  return next;
};

const fileName = (url) => (url ? String(url).split("/").pop() : "");

/**
 * Shared buyer registration form — same fields and layout as the vendor form.
 * Pass `buyer` to edit an existing buyer instead of registering a new one.
 */
export default function BuyerRegistrationForm({
  initialName = "",
  buyer = null,
  onRegistered,
  onSaved,
  onCancel,
  submitLabel,
  className = "",
}) {
  const isEdit = !!buyer?._id;
  const [form, setForm] = useState(
    isEdit ? toFormState(buyer) : { ...emptyBuyerForm, companyName: initialName }
  );
  const [isMsme, setIsMsme] = useState(!!buyer?.isMsme);
  const [files, setFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFile = (field) => (e) =>
    setFiles((prev) => ({ ...prev, [field]: e.target.files?.[0] || null }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append("isMsme", isMsme ? "true" : "false");
      Object.entries(files).forEach(([field, file]) => {
        if (file) fd.append(field, file);
      });

      const { data } = isEdit
        ? await api.put(`/buyers/${buyer._id}`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          })
        : await api.post("/buyers", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });

      if (isEdit) {
        toast.success("Buyer updated");
        onSaved?.(data);
      } else {
        toast.success("Buyer registered. Awaiting approval.");
        onRegistered?.(data);
      }
    } catch (err) {
      toast.error(
        err.response?.data?.message || (isEdit ? "Could not save changes" : "Registration failed")
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="space-y-6">
        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            General
          </legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Name of the company</Label>
            <Input required value={form.companyName} onChange={set("companyName")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Full address of company</Label>
            <Textarea rows={2} value={form.address} onChange={set("address")} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact person</Label>
            <Input value={form.contactPersonName} onChange={set("contactPersonName")} />
          </div>
          <div className="space-y-1.5">
            <Label>Designation</Label>
            <Input value={form.contactDesignation} onChange={set("contactDesignation")} />
          </div>
          <div className="space-y-1.5">
            <Label>Nature of the company</Label>
            <Select value={form.natureOfCompany} onValueChange={(v) => setForm((f) => ({ ...f, natureOfCompany: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Manufacturer", "Supplier", "Service Provider", "Distributor", "Other"].map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Nature of business</Label>
            <Input value={form.natureOfBusiness} onChange={set("natureOfBusiness")} placeholder="Distributor / Trading / ..." />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Financial &amp; commercial
          </legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Bank name, branch, A/C no. &amp; IFSC</Label>
            <Textarea rows={2} value={form.bankDetails} onChange={set("bankDetails")} />
          </div>
          <div className="space-y-1.5">
            <Label>GST / Sales Tax registration no.</Label>
            <Input value={form.taxRegistrationNo} onChange={set("taxRegistrationNo")} placeholder="GSTIN / PAN" />
          </div>
          <div className="space-y-1.5">
            <Label>Principal customers</Label>
            <Input value={form.principleCustomers} onChange={set("principleCustomers")} />
          </div>

          <div className="sm:col-span-2 rounded-md border border-border p-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isMsme}
                onChange={(e) => setIsMsme(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <span className="text-sm">
                <span className="font-medium">This buyer is registered as an MSME</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Tick if the buyer holds a Micro / Small / Medium Enterprise (Udyam) registration.
                </span>
              </span>
            </label>
            {isMsme && (
              <div className="space-y-1.5 mt-3">
                <Label>MSME / Udyam registration no. (optional)</Label>
                <Input value={form.msmeNumber} onChange={set("msmeNumber")} placeholder="UDYAM-XX-00-0000000" />
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Signatory
          </legend>
          <div className="space-y-1.5">
            <Label>Signatory name</Label>
            <Input value={form.signatoryName} onChange={set("signatoryName")} />
          </div>
          <div className="space-y-1.5">
            <Label>Signatory designation</Label>
            <Input value={form.signatoryDesignation} onChange={set("signatoryDesignation")} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Supporting documents — all optional
          </legend>
          {DOCUMENTS.map((doc) => {
            const existing = buyer?.[doc.urlKey];
            return (
              <div key={doc.field} className="space-y-1.5">
                <Label>
                  {doc.label} <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input type="file" onChange={setFile(doc.field)} />
                {existing && !files[doc.field] && (
                  <p className="text-xs text-muted-foreground truncate">
                    Current:{" "}
                    <a href={existing} target="_blank" rel="noreferrer" className="underline">
                      {fileName(existing)}
                    </a>{" "}
                    — choose a file to replace it.
                  </p>
                )}
              </div>
            );
          })}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>
              Other supporting document <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input type="file" onChange={setFile("registrationDocument")} />
            {buyer?.registrationDocumentUrl && !files.registrationDocument && (
              <p className="text-xs text-muted-foreground truncate">
                Current:{" "}
                <a href={buyer.registrationDocumentUrl} target="_blank" rel="noreferrer" className="underline">
                  {fileName(buyer.registrationDocumentUrl)}
                </a>{" "}
                — choose a file to replace it.
              </p>
            )}
          </div>
        </fieldset>
      </div>

      <div className="flex justify-end gap-2 pt-6">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting
            ? isEdit
              ? "Saving..."
              : "Submitting..."
            : submitLabel || (isEdit ? "Save changes" : "Register buyer")}
        </Button>
      </div>
    </form>
  );
}
