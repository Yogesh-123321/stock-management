import { AlertTriangle } from "lucide-react";

/*
  Shared "the document says X but you entered Y" banner. Same visual
  language as the PO/PI quantity-mismatch warning already used in
  receive/PIStep.jsx — reused everywhere a document is auto-checked
  against manually-entered fields (vendor/buyer docs, PO/PI, tax invoice)
  instead of each screen rolling its own.

  Each entry in `mismatches` is either:
    { label, extractedValue, enteredValue, enteredKey }  — a direct field disagreement
    { label, extractedValue }                             — extracted value not
                                                             found in a free-text field
  (see lib/documentVerify.js's findMismatches / findMissingMentions).
*/
export default function DocumentMismatchWarning({ mismatches, documentLabel = "the document" }) {
  if (!mismatches || mismatches.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
      <div className="space-y-1">
        <p className="font-medium">
          {mismatches.length === 1 ? "Check this against " : "Check these against "}
          {documentLabel}:
        </p>
        <ul className="space-y-0.5 list-disc list-inside">
          {mismatches.map((m, i) => (
            <li key={`${m.enteredKey || m.label}-${i}`}>
              <strong>{m.label}:</strong>{" "}
              {m.enteredValue !== undefined ? (
                <>
                  document reads <strong>{String(m.extractedValue)}</strong>, you entered{" "}
                  <strong>{String(m.enteredValue)}</strong>
                </>
              ) : (
                <>
                  document shows <strong>{String(m.extractedValue)}</strong> — make sure that's included in what
                  you entered
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-amber-800/80">
          Read automatically from the file — double-check before saving, scans can be misread.
        </p>
      </div>
    </div>
  );
}