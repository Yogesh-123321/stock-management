/*
  Compares AI-extracted document field values (see
  lib/useAutoExtractOnUpload.js) against whatever a person has already
  typed into a form, and reports the ones that disagree — used everywhere
  a document is uploaded alongside manually-entered fields (vendor/buyer
  docs, PO/PI upload, tax invoice upload) so a typo, or the wrong file
  attached to the wrong record, doesn't slip through unnoticed.

  This is deliberately a *disagreement* check, not a completeness check:
  a field left empty on either side is skipped rather than flagged — see
  findAutoFillable below for filling those in instead.
*/

const normalizeText = (v) =>
  String(v ?? "")
    .toUpperCase()
    .replace(/[\s\-.,]/g, "")
    .trim();

const textsMatch = (a, b) => {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return true; // nothing to compare on one side
  if (x === y) return true;
  // Loose containment — same idea as partNumberScore in
  // taxInvoiceController.js, for numbers/names keyed slightly differently
  // (leading zeros, a trailing branch code, "Pvt Ltd" vs "Private Limited").
  return x.includes(y) || y.includes(x);
};

const normalizeNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const numbersMatch = (a, b, tolerance = 0.01) => {
  const x = normalizeNumber(a);
  const y = normalizeNumber(b);
  if (x == null || y == null) return true;
  if (x === y) return true;
  const base = Math.max(Math.abs(x), Math.abs(y), 1);
  return Math.abs(x - y) / base <= tolerance;
};

/**
 * @param {Object} extracted  raw { fieldName: value } from the AI
 * @param {Object} entered    current form state (or any object with the enteredKey values)
 * @param {Array<{extractedKey:string, enteredKey:string, label:string, type?: "text"|"number"}>} mapping
 * @returns {Array<{label:string, extractedValue:*, enteredValue:*, enteredKey:string}>}
 */
export function findMismatches(extracted, entered, mapping) {
  if (!extracted || !entered || !mapping) return [];
  const mismatches = [];
  for (const m of mapping) {
    const extractedValue = extracted[m.extractedKey];
    const enteredValue = entered[m.enteredKey];
    if (extractedValue == null || String(extractedValue).trim() === "") continue;
    if (enteredValue == null || String(enteredValue).trim() === "") continue;
    const ok = m.type === "number" ? numbersMatch(extractedValue, enteredValue) : textsMatch(extractedValue, enteredValue);
    if (!ok) {
      mismatches.push({ label: m.label, extractedValue, enteredValue, enteredKey: m.enteredKey });
    }
  }
  return mismatches;
}

/**
 * Extracted values for fields the person hasn't filled in yet, keyed by
 * enteredKey — spread this into form state to auto-fill blanks without
 * ever overwriting something already typed.
 */
export function findAutoFillable(extracted, entered, mapping) {
  if (!extracted || !mapping) return {};
  const fill = {};
  for (const m of mapping) {
    const extractedValue = extracted[m.extractedKey];
    const enteredValue = entered?.[m.enteredKey];
    if (extractedValue == null || String(extractedValue).trim() === "") continue;
    if (enteredValue != null && String(enteredValue).trim() !== "") continue;
    fill[m.enteredKey] = extractedValue;
  }
  return fill;
}

/**
 * For a single free-text field that's expected to *mention* several
 * extracted values (e.g. a "bank details" textarea that should include the
 * account number and IFSC read off a cancelled cheque), reports any
 * extracted value that doesn't appear anywhere in that text.
 * @param {Object} extracted
 * @param {string} enteredText
 * @param {Array<{extractedKey:string, label:string}>} checks
 */
export function findMissingMentions(extracted, enteredText, checks) {
  if (!extracted || !checks || !enteredText || !String(enteredText).trim()) return [];
  const haystack = normalizeText(enteredText);
  const missing = [];
  for (const c of checks) {
    const value = extracted[c.extractedKey];
    if (value == null || String(value).trim() === "") continue;
    const needle = normalizeText(value);
    if (!needle) continue;
    if (!haystack.includes(needle)) {
      missing.push({ label: c.label, extractedValue: value });
    }
  }
  return missing;
}