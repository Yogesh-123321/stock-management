/*
  Helpers that turn a raw activity-log row into something a person can read,
  and work out WHICH document (if any) a log row is about.

  Nothing here talks to the server — it only reads the row, so it also works for
  log entries written before this feature existed.
*/

const OBJECT_ID = /^[0-9a-f]{24}$/i;
export const isObjectId = (v) => typeof v === "string" && OBJECT_ID.test(v);

export const SECTION_LABEL = {
  po: "Purchase order",
  pi: "Proforma invoice",
  part: "Part",
  vendor: "Vendor",
  buyer: "Buyer",
  stock: "Stock",
  kit: "Kit",
  sample: "Sample issue",
  receiving: "Material receiving",
  invoice: "Tax invoice",
  payment: "Payment",
  user: "User",
  auth: "Sign in / out",
  other: "Other",
};

/* ----------------------------- field names ------------------------------ */

const LABELS = {
  voucherNo: "Voucher no.",
  voucherDate: "Voucher date",
  invoiceNo: "Invoice no.",
  invoiceNumber: "Invoice no.",
  invoiceDate: "Invoice date",
  documentNumber: "Document no.",
  documentType: "Document type",
  referenceNo: "Reference no.",
  ttUniquePartNumber: "Part number",
  manufacturerPartNumber: "Manufacturer part no.",
  itemDescription: "Description",
  additionalInfo: "Remarks",
  supplierName: "Supplier",
  supplierGSTIN: "Supplier GSTIN",
  supplierAddress: "Supplier address",
  buyerName: "Buyer",
  buyerGSTIN: "Buyer GSTIN",
  buyerAddress: "Buyer address",
  companyName: "Company",
  taxRegistrationNo: "GSTIN / Tax reg. no.",
  subTotal: "Sub-total",
  taxType: "Tax type",
  taxRate: "Tax rate",
  taxAmount: "Tax amount",
  totalAmount: "Total amount",
  totalBill: "Total bill",
  paymentAmount: "Amount before GST",
  roundOff: "Round off",
  paymentTerms: "Payment terms",
  termsOfDelivery: "Terms of delivery",
  hsnSac: "HSN / SAC",
  hsnCode: "HSN code",
  quantity: "Qty",
  totalQuantity: "Total qty",
  qtyIssued: "Qty issued",
  qtyRequired: "Qty required",
  qtyShort: "Qty short",
  qtyPerKit: "Qty per kit",
  quantityInStock: "Qty in stock",
  unitPrice: "Unit price",
  utrNumber: "UTR number",
  paymentMethod: "Payment method",
  paymentDate: "Payment date",
  kitName: "Kit name",
  kitCode: "Kit code",
  issueCode: "Issue code",
  issuedBy: "Issued by",
  lifecycleStatus: "Open / closed",
  originalFileName: "File name",
  userName: "User name",
};

const ACRONYMS = {
  gst: "GST",
  gstin: "GSTIN",
  hsn: "HSN",
  sac: "SAC",
  utr: "UTR",
  po: "PO",
  pi: "PI",
  iqc: "IQC",
  tt: "TT",
  id: "ID",
  url: "URL",
  msme: "MSME",
  pan: "PAN",
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  pdf: "PDF",
  rnd: "R&D",
};

/** "supplierGSTIN" -> "Supplier GSTIN", "qty_issued" -> "Qty issued". */
export function humanizeKey(key) {
  const k = String(key ?? "");
  if (LABELS[k]) return LABELS[k];
  const words = k
    .replace(/^_+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ACRONYMS[w.toLowerCase()] || w.toLowerCase());
  if (!words.length) return k;
  const first = words[0];
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

/* ------------------------------- values --------------------------------- */

const ENUM_TEXT = {
  cgst_sgst: "CGST + SGST",
  CGST_SGST: "CGST + SGST",
  igst: "IGST",
  IGST: "IGST",
  none: "None",
  NONE: "None",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

const isPercentKey = (k) => /(tax|gst|discount)rate$|percent$/i.test(k);
const isMoneyKey = (k) =>
  !isPercentKey(k) &&
  /(amount|total|subtotal|price|rate|cost|cgst|sgst|igst|roundoff|totalbill)$/i.test(k);

export const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * One simple value -> { text, tone }. `tone` is only set for yes/no values so
 * the screen can colour them.
 */
export function formatScalar(key, value) {
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", tone: value ? "yes" : "no" };
  if (typeof value === "number") {
    if (isPercentKey(key)) return { text: `${value}%` };
    if (isMoneyKey(key)) return { text: inr(value) };
    return { text: value.toLocaleString("en-IN") };
  }

  const s = String(value ?? "");
  // Placeholders written by safeMeta() in utils/activityLog.js.
  if (s === "***") return { text: "Hidden (sensitive)" };
  if (s === "[file]") return { text: "File attached (the file itself is not kept in the log)" };
  if (s === "[object]") return { text: "(details not kept in the log)" };
  const items = s.match(/^\[(\d+) items\]$/);
  if (items) return { text: `${items[1]} items (details not kept in the log)` };

  if (ENUM_TEXT[s]) return { text: ENUM_TEXT[s] };
  if (ISO_DATE.test(s)) return { text: s.includes("T") ? fmtDateTime(s) : fmtDate(s) };
  if (/^[a-z]+(_[a-z]+)+$/.test(s)) {
    const spaced = s.replace(/_/g, " ");
    return { text: spaced.charAt(0).toUpperCase() + spaced.slice(1) };
  }
  if (isPercentKey(key) && /^\d+(\.\d+)?$/.test(s)) return { text: `${s}%` };
  if (isMoneyKey(key) && /^-?\d+(\.\d+)?$/.test(s)) return { text: inr(s) };
  return { text: s };
}

export const relativeTime = (d) => {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Plain-English reason behind an HTTP status of a failed action. */
export function explainStatus(code) {
  const c = Number(code) || 0;
  if (c === 400 || c === 422) return "The system rejected it because some information was missing or not valid.";
  if (c === 401) return "The person was not signed in, or their session had expired.";
  if (c === 403) return "The person does not have permission to do this.";
  if (c === 404) return "The record being worked on could not be found.";
  if (c === 409) return "It clashed with something already on record (for example a duplicate).";
  if (c >= 500) return "Something went wrong on the server while doing this.";
  return "The action did not go through.";
}

/* ----------------------- which document is this row about? -------------- */

/*
  kind -> what the preview shows:
    po / pi        generated Purchase Order / Proforma Invoice (printable view)
    upload         PO / PI file uploaded while receiving material
    invoice        supplier tax invoice file
    vendor, buyer  registration details + their documents
    part           parts-master record
    kit-issue      one issue of a kit to a vendor
*/
const KIND_LABEL = {
  po: "Purchase order",
  pi: "Proforma invoice",
  upload: "Uploaded PO / PI",
  invoice: "Tax invoice",
  vendor: "Vendor",
  buyer: "Buyer",
  part: "Part",
  "kit-issue": "Kit issue",
};

export const docKindLabel = (kind) => KIND_LABEL[kind] || "Document";

/**
 * Work out which record a log row relates to. Returns { kind, id } or null when
 * the row has no document that can be opened (sign-ins, users, deleted records…).
 */
export function resolveDocRef(row) {
  if (!row) return null;
  // A deleted record is gone — there is nothing left to open.
  if (row.method === "DELETE" && row.success !== false) return null;

  // Approvals are stamped with the document they were about (see activityLogger.js).
  const stamped = row.meta?._docRef;
  if (stamped && isObjectId(stamped.id) && KIND_LABEL[stamped.kind]) {
    return { kind: stamped.kind, id: stamped.id };
  }

  const segs = String(row.path || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);
  const apiAt = segs.indexOf("api");
  const seg = (apiAt >= 0 ? segs[apiAt + 1] : segs[0]) || "";
  const id = isObjectId(row.entityId) ? row.entityId : segs.find((s) => isObjectId(s));
  if (!id) return null;

  switch (seg) {
    case "po-generator":
      return { kind: "po", id };
    case "pi-generator":
      return { kind: "pi", id };
    case "purchase-orders":
      return { kind: "upload", id };
    case "tax-invoices":
    case "billing":
      return { kind: "invoice", id };
    case "vendors":
      return { kind: "vendor", id };
    case "buyers":
      return { kind: "buyer", id };
    case "parts":
      return { kind: "part", id };
    case "kits":
      // Only an ISSUE of a kit can be opened; templates & drafts have no preview.
      return segs.some((s) => s === "issues" || s === "issue" || s === "edit")
        ? { kind: "kit-issue", id }
        : null;
    default:
      return null;
  }
}