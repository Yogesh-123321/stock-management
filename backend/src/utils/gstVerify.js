/*
  GSTIN format/checksum validation + lookup against a free third-party GST
  verification API (gstincheck.co.in by default — 20 free lookups/month,
  no card required: https://gstincheck.co.in). The provider is swappable
  via env vars without touching any other code, and the response is
  normalized so the rest of the app never has to know which provider is
  configured.

  Env vars (backend/.env):
    GST_VERIFY_API_URL   e.g. https://sheet.gstincheck.co.in/check/{key}/{gstin}
                          {key} and {gstin} are replaced automatically.
                          Leave unset to disable the live lookup — format
                          validation still runs, callers just get
                          { verified: false, reason: "not_configured" }.
    GST_VERIFY_API_KEY   the provider's API key.
*/

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// 36th char of a GSTIN is a checksum over the first 14 characters —
// standard GSTIN checksum algorithm (mod-36, same one used by the GST
// portal and every third-party validator).
const CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstinChecksumValid(gstin) {
  if (typeof gstin !== "string" || gstin.length !== 15) return false;
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

// Enough of the GST state-code list to give a useful cross-check / label;
// unknown codes just fall back to the raw code instead of throwing.
const STATE_CODES = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  10: "Bihar", 11: "Sikkim", 12: "Arunachal Pradesh", 13: "Nagaland", 14: "Manipur",
  15: "Mizoram", 16: "Tripura", 17: "Meghalaya", 18: "Assam", 19: "West Bengal",
  20: "Jharkhand", 21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh", 24: "Gujarat",
  26: "Dadra & Nagar Haveli and Daman & Diu", 27: "Maharashtra", 28: "Andhra Pradesh (Old)",
  29: "Karnataka", 30: "Goa", 31: "Lakshadweep", 32: "Kerala", 33: "Tamil Nadu",
  34: "Puducherry", 35: "Andaman & Nicobar Islands", 36: "Telangana", 37: "Andhra Pradesh",
  38: "Ladakh", 97: "Other Territory",
};

export function validateGstinFormat(gstinRaw) {
  const gstin = String(gstinRaw || "").trim().toUpperCase();
  if (!gstin) return { valid: false, reason: "empty" };
  if (!GSTIN_RE.test(gstin)) return { valid: false, reason: "format", gstin };
  if (!gstinChecksumValid(gstin)) return { valid: false, reason: "checksum", gstin };
  const stateCode = gstin.slice(0, 2);
  return {
    valid: true,
    gstin,
    panFromGstin: gstin.slice(2, 12),
    stateCode,
    stateName: STATE_CODES[stateCode] || STATE_CODES[Number(stateCode)] || null,
  };
}

// Tiny in-memory TTL cache — free-tier lookup quotas are small, and the
// same GSTIN is often re-checked as a form is edited/re-submitted.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

function normalizeProviderResponse(raw, gstin) {
  // Different free/paid providers use different key casing
  // (lgnm/tradeNam/pradr.addr vs legal_name_of_business/... etc). Try the
  // common shapes rather than betting on exactly one provider's schema.
  const data = raw?.data || raw?.result || raw;
  if (!data) return null;

  const legalName = data.lgnm || data.legal_name_of_business || data.legalName || null;
  const tradeName = data.tradeNam || data.trade_name_of_business || data.tradeName || null;
  const status = data.sts || data.gst_in_status || data.status || null;
  const constitution = data.ctb || data.constitution_of_business || data.constitution || null;
  const registrationDate = data.rgdt || data.date_of_registration || data.registrationDate || null;

  let address = data.principal_place_address || null;
  if (!address && data.pradr) {
    if (typeof data.pradr === "string") {
      address = data.pradr;
    } else if (typeof data.pradr.adr === "string" && data.pradr.adr.trim()) {
      // gstincheck.co.in / GSTN already hand back a fully formatted
      // address string here (pradr.adr) — prefer it over reconstructing
      // one ourselves, since the structured pradr.addr sub-object below
      // is lossy (it can drop floor/building-name/street entirely, and
      // its "building number" field is sometimes just "0" as a
      // placeholder) compared to this ready-made string.
      address = data.pradr.adr.trim();
    } else {
      // Fallback for providers that only give the structured sub-object
      // and no pre-formatted string. pradr.addr is itself an object
      // ({ bno, bnm, st, loc, dst, city, stcd, pncd, flno, ... }), not a
      // string — assigning it directly used to render as "[object
      // Object]" wherever the address was shown. Flatten it into a
      // human-readable, comma-joined line instead.
      const addr = data.pradr.addr || data.pradr.address || data.pradr;
      if (typeof addr === "string") {
        address = addr;
      } else if (addr && typeof addr === "object") {
        address = [addr.flno, addr.bno, addr.bnm, addr.st, addr.loc, addr.city, addr.dst, addr.stcd, addr.pncd]
          .filter(Boolean)
          .join(", ") || null;
      }
    }
  }
  if (!address && data.principal_place_split_address) {
    const a = data.principal_place_split_address;
    address = [a.building_name, a.street, a.location, a.district, a.state, a.pincode].filter(Boolean).join(", ");
  }

  if (!legalName && !tradeName && !address) return null;

  return {
    gstin,
    legalName,
    tradeName,
    address,
    status,
    constitution,
    registrationDate,
  };
}

/**
 * Looks up a GSTIN against the configured free/paid provider.
 * Never throws — callers get { verified:false, reason } on any failure
 * (bad format, provider not configured, provider error/timeout) so a
 * lookup hiccup never blocks someone from saving the form.
 */
export async function lookupGstin(gstinRaw) {
  const format = validateGstinFormat(gstinRaw);
  if (!format.valid) return { verified: false, reason: format.reason, format };

  const cached = cache.get(format.gstin);
  if (cached && cached.expires > Date.now()) return cached.value;

  const urlTemplate = process.env.GST_VERIFY_API_URL;
  const apiKey = process.env.GST_VERIFY_API_KEY;
  if (!urlTemplate || !apiKey) {
    return { verified: false, reason: "not_configured", format };
  }

  const url = urlTemplate.replace("{key}", encodeURIComponent(apiKey)).replace("{gstin}", format.gstin);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { headers: { "x-api-key": apiKey }, signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { verified: false, reason: `provider_http_${res.status}`, format };
    }
    const raw = await res.json();
    if (raw?.flag === false || raw?.success === false || raw?.error) {
      return { verified: false, reason: raw.message || "provider_no_match", format };
    }

    const details = normalizeProviderResponse(raw, format.gstin);
    if (!details) return { verified: false, reason: "provider_no_match", format };

    const value = { verified: true, format, details };
    cache.set(format.gstin, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    const reason = err?.name === "AbortError" ? "provider_timeout" : "provider_unreachable";
    return { verified: false, reason, format };
  }
}