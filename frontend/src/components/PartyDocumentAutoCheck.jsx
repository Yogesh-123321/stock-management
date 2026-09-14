import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useAutoExtractOnUpload } from "@/lib/useAutoExtractOnUpload";
import { findMismatches, findMissingMentions, findAutoFillable } from "@/lib/documentVerify";
import DocumentMismatchWarning from "@/components/DocumentMismatchWarning";

/*
  Registers what to check for each supporting-document field on the vendor
  / buyer registration form (VendorRegistrationForm.jsx and
  BuyerRegistrationForm.jsx share this exact field set). Add an entry here
  to wire AI auto-check into a new document type — nothing in
  PartyDocumentAutoCheck itself needs to change.

  Each config's `documentType` must match a key in the backend's
  aiDocumentSchemas.js registry.
*/
export const PARTY_DOC_AI_CONFIG = {
  gstDocument: {
    documentType: "partyGstDoc",
    mapping: [
      { extractedKey: "companyName", enteredKey: "companyName", label: "Company name", type: "text" },
      { extractedKey: "gstNumber", enteredKey: "taxRegistrationNo", label: "GST / tax registration no.", type: "text" },
    ],
    autoFillMapping: [{ extractedKey: "gstNumber", enteredKey: "taxRegistrationNo" }],
  },
  panDocument: {
    documentType: "partyPanDoc",
    mapping: [
      { extractedKey: "companyName", enteredKey: "companyName", label: "Company / holder name", type: "text" },
      { extractedKey: "panNumber", enteredKey: "taxRegistrationNo", label: "PAN (vs. tax reg. no. entered)", type: "text" },
    ],
    // Don't auto-fill: a bare PAN shouldn't silently overwrite a typed GSTIN.
    autoFillMapping: [],
  },
  bankRecordDocument: {
    documentType: "partyBankDoc",
    mapping: [],
    containerKey: "bankDetails",
    containsChecks: [
      { extractedKey: "accountNumber", label: "Account number" },
      { extractedKey: "ifscCode", label: "IFSC code" },
    ],
    autoFillCompose: (f) =>
      [f.accountHolderName, f.bankName, f.branch, f.accountNumber && `A/C ${f.accountNumber}`, f.ifscCode]
        .filter(Boolean)
        .join(", "),
  },
  msmeDocument: {
    documentType: "partyMsmeDoc",
    mapping: [
      { extractedKey: "companyName", enteredKey: "companyName", label: "Company name", type: "text" },
      { extractedKey: "msmeNumber", enteredKey: "msmeNumber", label: "MSME / Udyam no.", type: "text" },
    ],
    autoFillMapping: [{ extractedKey: "msmeNumber", enteredKey: "msmeNumber" }],
  },
};

/**
 * Drop next to a supporting-document file input:
 *   <PartyDocumentAutoCheck docField="gstDocument" file={files.gstDocument} form={form} setForm={setForm} />
 *
 * On file selection it auto-fetches details via AI, fills in whichever
 * mapped fields are still empty, and shows a warning if a field that was
 * already typed disagrees with what the document says. Renders nothing
 * for document types with no config (e.g. the generic "other document"
 * slot) or before a file is chosen.
 */
export default function PartyDocumentAutoCheck({ docField, file, form, setForm }) {
  const config = PARTY_DOC_AI_CONFIG[docField];
  const { status, fields: extracted } = useAutoExtractOnUpload(
    config && file ? file : null,
    config ? { documentType: config.documentType } : {}
  );
  const appliedFileRef = useRef(null);

  // Auto-fill empty fields once per newly-extracted file — never overwrites
  // something the person already typed.
  useEffect(() => {
    if (!config || status !== "done" || !extracted || !file) return;
    if (appliedFileRef.current === file) return;
    appliedFileRef.current = file;

    const fill = findAutoFillable(extracted, form, config.mapping || []);
    (config.autoFillMapping || []).forEach(({ extractedKey, enteredKey }) => {
      const value = extracted[extractedKey];
      if (value && !String(form[enteredKey] || "").trim() && fill[enteredKey] === undefined) {
        fill[enteredKey] = value;
      }
    });
    if (config.containerKey && config.autoFillCompose && !String(form[config.containerKey] || "").trim()) {
      const composed = config.autoFillCompose(extracted);
      if (composed) fill[config.containerKey] = composed;
    }
    if (Object.keys(fill).length > 0) {
      setForm((prev) => ({ ...prev, ...fill }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, extracted, file]);

  if (!config || !file) return null;

  if (status === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Reading document to check the details…
      </p>
    );
  }
  if (status !== "done" || !extracted) return null;

  const fieldMismatches = findMismatches(extracted, form, config.mapping || []);
  const missingMentions = config.containerKey
    ? findMissingMentions(extracted, form[config.containerKey], config.containsChecks || [])
    : [];
  const mismatches = [...fieldMismatches, ...missingMentions];

  return <DocumentMismatchWarning mismatches={mismatches} documentLabel="this document" />;
}