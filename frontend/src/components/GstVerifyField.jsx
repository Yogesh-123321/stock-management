import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import FieldError from "@/components/FieldError";
import DocumentMismatchWarning from "@/components/DocumentMismatchWarning";
import { findMismatches, findAutoFillable } from "@/lib/documentVerify";
import { REGEX } from "@/lib/validators";
import { verifyGstin } from "@/lib/gstVerify";

// Same shape PartyDocumentAutoCheck/documentVerify.js use for "extracted vs
// entered" comparisons, just sourced from the live GST registry lookup
// instead of an uploaded document.
const GST_MAPPING = [
  { extractedKey: "companyName", enteredKey: "companyNameField", label: "Company name", type: "text" },
];

/**
 * Drop-in replacement for the plain "GST / Sales Tax registration no."
 * Input on the vendor/buyer registration forms. Validates the GSTIN
 * format+checksum as it's typed, then (once it's a well-formed GSTIN)
 * looks it up against the GST registry and flags if the registered legal
 * name / address don't match what was typed into the form — same "check
 * this against X" pattern already used for uploaded documents.
 *
 *   <GstVerifyField
 *     value={form.taxRegistrationNo}
 *     onChange={set("taxRegistrationNo")}
 *     onBlur={() => v.handleBlur("taxRegistrationNo", form.taxRegistrationNo, form)}
 *     error={v.fieldError("taxRegistrationNo")}
 *     form={form}
 *     setForm={setForm}
 *     companyNameKey="companyName"
 *     addressKey="address"
 *   />
 */
export default function GstVerifyField({
  value,
  onChange,
  onBlur,
  error,
  form,
  setForm,
  companyNameKey = "companyName",
  addressKey = "address",
  label = "GST registration no.",
}) {
  const [state, setState] = useState({ status: "idle", result: null });
  const checkedRef = useRef(null);

  const gstin = String(value || "").trim().toUpperCase();
  const looksLikeGstin = REGEX.gstin.test(gstin);

  const runVerify = async (candidate) => {
    setState({ status: "loading", result: null });
    try {
      const data = await verifyGstin(candidate);
      setState({ status: "done", result: data });
    } catch {
      setState({ status: "done", result: { valid: true, verified: false, message: "Could not reach the verification service" } });
    }
  };

  // Auto-verify once the field holds a well-formed GSTIN — mirrors the
  // "pick a file, get checked automatically" behaviour of
  // PartyDocumentAutoCheck for uploaded documents.
  useEffect(() => {
    if (!looksLikeGstin) {
      checkedRef.current = null;
      if (state.status !== "idle") setState({ status: "idle", result: null });
      return;
    }
    if (checkedRef.current === gstin) return;
    checkedRef.current = gstin;
    const t = setTimeout(() => runVerify(gstin), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstin, looksLikeGstin]);

  const result = state.result;
  const details =
    result?.verified && (result.legalName || result.tradeName || result.address)
      ? { companyName: result.tradeName || result.legalName, address: result.address }
      : null;

  const mismatches = details
    ? findMismatches(
        { companyName: details.companyName },
        { companyNameField: form?.[companyNameKey] },
        GST_MAPPING
      )
    : [];

  const autoFillable = details
    ? findAutoFillable(
        { companyName: details.companyName, address: details.address },
        { companyName: form?.[companyNameKey], address: form?.[addressKey] },
        [
          { extractedKey: "companyName", enteredKey: companyNameKey },
          { extractedKey: "address", enteredKey: addressKey },
        ]
      )
    : {};
  const hasAutoFill = Object.keys(autoFillable).length > 0;

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange({ target: { value: e.target.value.toUpperCase() } })}
        onBlur={onBlur}
        placeholder="GSTIN (e.g. 27AAAPL1234C1ZE)"
        maxLength={15}
      />
      <FieldError error={error} />

      {!error && state.status === "loading" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking GSTIN against the GST registry…
        </p>
      )}

      {!error && state.status === "done" && result && (
        <>
          {result.verified ? (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified — {result.tradeName || result.legalName}
              {result.stateName ? ` · ${result.stateName}` : ""}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {result.message || "Could not verify against the GST registry."}
                {result.stateName ? ` GSTIN state: ${result.stateName}.` : ""}
              </span>
            </p>
          )}

          {mismatches.length > 0 && (
            <DocumentMismatchWarning mismatches={mismatches} documentLabel="the GST registry" />
          )}

          {hasAutoFill && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setForm((f) => ({ ...f, ...autoFillable }))}
            >
              Use registered {[autoFillable[companyNameKey] && "name", autoFillable[addressKey] && "address"]
                .filter(Boolean)
                .join(" & ")}{" "}
              from GST registry
            </Button>
          )}
        </>
      )}
    </div>
  );
}