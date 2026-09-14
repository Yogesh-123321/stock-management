import { useState } from "react";
import toast from "react-hot-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import api from "@/lib/api";
import PartyDocumentAutoCheck from "@/components/PartyDocumentAutoCheck";
import GstVerifyField from "@/components/GstVerifyField";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";
import { REGEX, isValidGstinChecksum } from "@/lib/validators";

export const emptyVendorForm = {
  companyName: "",
  address: "",
  phone: "",
  email: "",
  contactPersonName: "",
  contactDesignation: "",
  natureOfCompany: "Supplier",
  natureOfBusiness: "",
  taxRegistrationNo: "",
  bankDetails: "",
  principleCustomers: "",
  signatoryName: "",
  signatoryDesignation: "",
  msmeNumber: "",
  remarks: "",
};

// Regex rules for every text field on this form — see lib/validators.js
// for the shared pattern library and lib/useFormValidation.js for how
// these get wired into per-field error messages.
const VENDOR_FORM_SCHEMA = {
  companyName: {
    required: true,
    requiredMessage: "Company name is required",
    regex: "companyName",
    maxLength: 150,
  },
  address: { maxLength: 300 },
  phone: { regex: "phoneLoose" },
  email: { regex: "email" },
  contactPersonName: { regex: "personName", maxLength: 80 },
  contactDesignation: { regex: "alphaNumSpace", maxLength: 60 },
  natureOfBusiness: { maxLength: 100 },
  taxRegistrationNo: {
    regex: "gstin",
    validate: (v) =>
      REGEX.gstin.test(v) && !isValidGstinChecksum(v)
        ? "That GSTIN's checksum digit doesn't match — double-check for a typo"
        : null,
  },
  principleCustomers: { maxLength: 150 },
  signatoryName: { regex: "personName", maxLength: 80 },
  signatoryDesignation: { regex: "alphaNumSpace", maxLength: 60 },
  msmeNumber: { regex: "udyam" },
  remarks: { maxLength: 500 },
};

// Every supporting document is optional.
const DOCUMENTS = [
  { field: "gstDocument", urlKey: "gstDocumentUrl", label: "GST certificate" },
  { field: "panDocument", urlKey: "panDocumentUrl", label: "PAN card" },
  { field: "bankRecordDocument", urlKey: "bankRecordDocumentUrl", label: "Bank record (cancelled cheque / passbook)" },
  { field: "msmeDocument", urlKey: "msmeDocumentUrl", label: "MSME / Udyam certificate" },
];

const toFormState = (vendor) => {
  const next = { ...emptyVendorForm };
  Object.keys(emptyVendorForm).forEach((k) => {
    if (vendor?.[k] !== undefined && vendor?.[k] !== null) next[k] = vendor[k];
  });
  return next;
};

const fileName = (url) => (url ? String(url).split("/").pop() : "");

/**
 * Shared vendor registration form (TISPL / PLC supplier evaluation fields).
 * Used by the "Receive material" vendor step and the Vendors list page.
 * Pass `vendor` to edit an existing vendor instead of registering a new one.
 */
export default function VendorRegistrationForm({
  initialName = "",
  vendor = null,
  onRegistered,
  onSaved,
  onCancel,
  submitLabel,
  className = "",
}) {
  const isEdit = !!vendor?._id;
  const [form, setForm] = useState(
    isEdit ? toFormState(vendor) : { ...emptyVendorForm, companyName: initialName }
  );
  const [isMsme, setIsMsme] = useState(!!vendor?.isMsme);
  const [files, setFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const v = useFormValidation(VENDOR_FORM_SCHEMA);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFile = (field) => (e) =>
    setFiles((prev) => ({ ...prev, [field]: e.target.files?.[0] || null }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!v.validateAll(form)) {
      toast.error("Please fix the highlighted fields before submitting");
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
        ? await api.put(`/vendors/${vendor._id}`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          })
        : await api.post("/vendors", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });

      if (isEdit) {
        toast.success("Vendor updated");
        onSaved?.(data);
      } else {
        toast.success("Vendor registered. Awaiting purchase-head approval.");
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
            <Input
              required
              value={form.companyName}
              onChange={set("companyName")}
              onBlur={() => v.handleBlur("companyName", form.companyName, form)}
            />
            <FieldError error={v.fieldError("companyName")} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Full address of company</Label>
            <Textarea
              rows={2}
              value={form.address}
              onChange={set("address")}
              onBlur={() => v.handleBlur("address", form.address, form)}
            />
            <FieldError error={v.fieldError("address")} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={set("phone")}
              onBlur={() => v.handleBlur("phone", form.phone, form)}
            />
            <FieldError error={v.fieldError("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={set("email")}
              onBlur={() => v.handleBlur("email", form.email, form)}
            />
            <FieldError error={v.fieldError("email")} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact person</Label>
            <Input
              value={form.contactPersonName}
              onChange={set("contactPersonName")}
              onBlur={() => v.handleBlur("contactPersonName", form.contactPersonName, form)}
            />
            <FieldError error={v.fieldError("contactPersonName")} />
          </div>
          <div className="space-y-1.5">
            <Label>Designation</Label>
            <Input
              value={form.contactDesignation}
              onChange={set("contactDesignation")}
              onBlur={() => v.handleBlur("contactDesignation", form.contactDesignation, form)}
            />
            <FieldError error={v.fieldError("contactDesignation")} />
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
            <Input
              value={form.natureOfBusiness}
              onChange={set("natureOfBusiness")}
              onBlur={() => v.handleBlur("natureOfBusiness", form.natureOfBusiness, form)}
              placeholder="Supplier / Manufacturing / ..."
            />
            <FieldError error={v.fieldError("natureOfBusiness")} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Financial & commercial
          </legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Bank name, branch, A/C no. & IFSC</Label>
            <Textarea rows={2} value={form.bankDetails} onChange={set("bankDetails")} />
          </div>
          <GstVerifyField
            value={form.taxRegistrationNo}
            onChange={set("taxRegistrationNo")}
            onBlur={() => v.handleBlur("taxRegistrationNo", form.taxRegistrationNo, form)}
            error={v.fieldError("taxRegistrationNo")}
            form={form}
            setForm={setForm}
            companyNameKey="companyName"
            addressKey="address"
            label="GST / Sales Tax registration no."
          />
          <div className="space-y-1.5">
            <Label>Principal customers</Label>
            <Input
              value={form.principleCustomers}
              onChange={set("principleCustomers")}
              onBlur={() => v.handleBlur("principleCustomers", form.principleCustomers, form)}
            />
            <FieldError error={v.fieldError("principleCustomers")} />
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
                <span className="font-medium">This vendor is registered as an MSME</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Tick if the supplier holds a Micro / Small / Medium Enterprise (Udyam) registration.
                </span>
              </span>
            </label>
            {isMsme && (
              <div className="space-y-1.5 mt-3">
                <Label>MSME / Udyam registration no. (optional)</Label>
                <Input
                  value={form.msmeNumber}
                  onChange={set("msmeNumber")}
                  onBlur={() => v.handleBlur("msmeNumber", form.msmeNumber, form)}
                  placeholder="UDYAM-XX-00-0000000"
                />
                <FieldError error={v.fieldError("msmeNumber")} />
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
            <Input
              value={form.signatoryName}
              onChange={set("signatoryName")}
              onBlur={() => v.handleBlur("signatoryName", form.signatoryName, form)}
            />
            <FieldError error={v.fieldError("signatoryName")} />
          </div>
          <div className="space-y-1.5">
            <Label>Signatory designation</Label>
            <Input
              value={form.signatoryDesignation}
              onChange={set("signatoryDesignation")}
              onBlur={() => v.handleBlur("signatoryDesignation", form.signatoryDesignation, form)}
            />
            <FieldError error={v.fieldError("signatoryDesignation")} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Remarks — optional
          </legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea
              rows={3}
              value={form.remarks}
              onChange={set("remarks")}
              onBlur={() => v.handleBlur("remarks", form.remarks, form)}
              placeholder="Any internal notes about this vendor (optional)"
            />
            <FieldError error={v.fieldError("remarks")} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <legend className="col-span-full text-xs font-display font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Supporting documents — all optional
          </legend>
          {[...DOCUMENTS, { field: "registrationDocument", urlKey: "registrationDocumentUrl", label: "Other supporting document", wide: true }].map((doc) => {
            const existing = vendor?.[doc.urlKey];
            const replacing = !!files[doc.field];
            // An already-uploaded document is tinted green so it stands out from
            // the empty slots; picking a new file switches the tint to amber.
            const tone = replacing
              ? "border-warning/60 bg-warning/10"
              : existing
                ? "border-success/60 bg-success/10"
                : "border-border";
            return (
              <div
                key={doc.field}
                className={`space-y-1.5 rounded-md border p-3 transition-colors ${tone} ${
                  doc.wide ? "sm:col-span-2" : ""
                }`}
              >
                <Label className="flex flex-wrap items-center gap-2">
                  <span>{doc.label}</span>
                  {existing && !replacing && (
                    <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                      Uploaded
                    </span>
                  )}
                  {replacing && (
                    <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      New file selected
                    </span>
                  )}
                  {!existing && !replacing && (
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  )}
                </Label>
                <Input type="file" onChange={setFile(doc.field)} />
                <PartyDocumentAutoCheck docField={doc.field} file={files[doc.field]} form={form} setForm={setForm} />
                {existing && !replacing && (
                  <p className="text-xs text-success truncate">
                    Current:{" "}
                    <a href={existing} target="_blank" rel="noreferrer" className="underline">
                      {fileName(existing)}
                    </a>{" "}
                    — choose a file to replace it.
                  </p>
                )}
                {existing && replacing && (
                  <p className="text-xs text-warning truncate">
                    Will replace {fileName(existing)} on save.
                  </p>
                )}
              </div>
            );
          })}
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
            : submitLabel || (isEdit ? "Save changes" : "Register vendor")}
        </Button>
      </div>
    </form>
  );
}