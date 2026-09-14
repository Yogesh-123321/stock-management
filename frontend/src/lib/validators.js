/*
  One shared regex/validation library for every form in the app, instead
  of each screen inventing its own ad-hoc checks. Add a pattern here once
  and every form that needs it (vendor/buyer registration, users, part
  categories, login, ...) references it by name — see useFormValidation.js
  for how a form wires these into per-field error messages.
*/

export const REGEX = {
  // Loose-but-solid email check — good enough for form validation (the
  // backend / auth flow is still the source of truth).
  email: /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/,
  // Indian mobile number, optionally with +91 / 0 prefix, first digit 6-9.
  phone: /^(?:\+?91[-\s]?|0)?[6-9]\d{9}$/,
  // Landline or mobile, more permissive (used where a company switchboard
  // number is just as likely as a mobile).
  phoneLoose: /^[+]?[\d][\d\s()-]{6,17}\d$/,
  // 15-character GSTIN: 2-digit state code, 10-char PAN, entity code,
  // literal "Z", checksum char.
  gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  pincode: /^[1-9]\d{5}$/,
  udyam: /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/i,
  bankAccountNumber: /^\d{9,18}$/,
  // Person / company names — letters, spaces, and a handful of punctuation
  // that legitimately shows up in Indian company names ("R.K. & Sons Pvt.
  // Ltd.", "O'Brien").
  personName: /^[A-Za-z][A-Za-z.' -]{1,79}$/,
  companyName: /^[A-Za-z0-9][A-Za-z0-9.,&'()/\- ]{1,149}$/,
  username: /^[a-zA-Z0-9._-]{3,32}$/,
  categoryCode: /^[A-Z0-9]{2,10}$/,
  // PO / PI / invoice numbers — letters, numbers, and the punctuation that
  // actually shows up in these (PO-2026-0142, INV/24-25/0091, ...).
  docNumber: /^[A-Za-z0-9][A-Za-z0-9/.\-_ ]{0,49}$/,
  alphaNumSpace: /^[A-Za-z0-9 ]+$/,
  positiveInteger: /^\d+$/,
  decimal2: /^\d+(\.\d{1,2})?$/,
  // Free-text fields (address, remarks, ...): block a value made up of
  // nothing but punctuation/whitespace, still allow full sentences.
  nonBlank: /\S/,
};

export const MESSAGES = {
  email: "Enter a valid email address",
  phone: "Enter a valid 10-digit Indian mobile number",
  phoneLoose: "Enter a valid phone number",
  gstin: "Enter a valid 15-character GSTIN (e.g. 27AAAPL1234C1ZE)",
  pan: "Enter a valid 10-character PAN (e.g. AAAPL1234C)",
  ifsc: "Enter a valid 11-character IFSC code (e.g. HDFC0001234)",
  pincode: "Enter a valid 6-digit PIN code",
  udyam: "Enter a valid Udyam number (e.g. UDYAM-KA-00-0000000)",
  bankAccountNumber: "Enter a valid bank account number (9-18 digits)",
  personName: "Letters only — 2 to 80 characters",
  companyName: "2-150 characters, letters/numbers and common punctuation only",
  username: "3-32 characters: letters, numbers, dot, underscore or hyphen only",
  categoryCode: "2-10 uppercase letters/numbers only",
  docNumber: "Letters, numbers, and / . - _ only (max 50 characters)",
  alphaNumSpace: "Letters, numbers and spaces only",
  positiveInteger: "Whole numbers only",
  decimal2: "Numbers only, up to 2 decimal places",
  nonBlank: "This field can't be just spaces",
};

/**
 * Validates a single value against a field rule and returns an error
 * string, or null when the value is fine.
 *
 * rule shape: {
 *   required?: boolean,
 *   requiredMessage?: string,
 *   regex?: keyof REGEX | RegExp,
 *   message?: string,               // overrides the REGEX default message
 *   minLength?: number,
 *   maxLength?: number,
 *   min?: number, max?: number,     // for numeric rules
 *   validate?: (value, form) => string | null,  // custom/cross-field check
 * }
 */
export function validateValue(rawValue, rule, form) {
  if (!rule) return null;
  const value = rawValue == null ? "" : String(rawValue).trim();

  if (rule.required && !value) {
    return rule.requiredMessage || "This field is required";
  }
  if (!value) return null; // optional and empty: nothing further to check

  if (rule.minLength != null && value.length < rule.minLength) {
    return `Must be at least ${rule.minLength} characters`;
  }
  if (rule.maxLength != null && value.length > rule.maxLength) {
    return `Must be at most ${rule.maxLength} characters`;
  }

  if (rule.regex) {
    const pattern = typeof rule.regex === "string" ? REGEX[rule.regex] : rule.regex;
    if (pattern && !pattern.test(value)) {
      return rule.message || (typeof rule.regex === "string" ? MESSAGES[rule.regex] : "Invalid format");
    }
  }

  if (rule.min != null || rule.max != null) {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      if (rule.min != null && n < rule.min) return `Must be at least ${rule.min}`;
      if (rule.max != null && n > rule.max) return `Must be at most ${rule.max}`;
    }
  }

  if (rule.validate) {
    const err = rule.validate(value, form);
    if (err) return err;
  }

  return null;
}

/** Validates a whole form object against a { field: rule } schema. */
export function validateForm(form, schema) {
  const errors = {};
  Object.entries(schema).forEach(([key, rule]) => {
    const err = validateValue(form?.[key], rule, form);
    if (err) errors[key] = err;
  });
  return errors;
}

export function hasErrors(errors) {
  return Object.values(errors || {}).some(Boolean);
}

// --- GSTIN-specific helpers (also mirrored server-side in
// backend/src/utils/gstVerify.js — kept here too so the frontend can give
// instant feedback without a round trip for an obviously-mistyped GSTIN) ---

const CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function isValidGstinChecksum(gstinRaw) {
  const gstin = String(gstinRaw || "").toUpperCase();
  if (gstin.length !== 15) return false;
  let factor = 2;
  let sum = 0;
  const codeLen = CHECKSUM_ALPHABET.length;
  for (let i = 13; i >= 0; i--) {
    const code = CHECKSUM_ALPHABET.indexOf(gstin[i]);
    if (code === -1) return false;
    let digit = factor * code;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / codeLen) + (digit % codeLen);
    sum += digit;
  }
  const checkCodePoint = (codeLen - (sum % codeLen)) % codeLen;
  return CHECKSUM_ALPHABET[checkCodePoint] === gstin[14];
}

export function panFromGstin(gstinRaw) {
  const gstin = String(gstinRaw || "").toUpperCase();
  return REGEX.gstin.test(gstin) ? gstin.slice(2, 12) : null;
}