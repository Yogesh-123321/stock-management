import TaxInvoice from "../models/TaxInvoice.js";
import { extractDocumentFields, AiExtractionError } from "./aiDocumentExtract.js";
import { getDocumentSchema } from "./aiDocumentSchemas.js";
import { computeBillAmounts } from "../controllers/taxInvoiceController.js";

/*
  Billing back-fill: invoices whose amount is 0 (or was never entered) get it
  read ONCE from the invoice PDF and saved.

  - Only invoices with no usable amount are touched; anything that already has
    an amount is never read or changed.
  - "Once" = amountExtractedAt is stamped after a successful read, even if the
    PDF had no amount on it, so that invoice is never sent to the AI again.
  - If the AI itself is unavailable (quota, not configured, network) nothing is
    stamped, so those invoices are retried on a later run (after a cool-down).
*/

// Same fallback chain the Billing screen uses to show an amount.
export const AMOUNT_EXPR = {
  $ifNull: ["$grandTotal", { $ifNull: ["$totalBill", { $ifNull: ["$paymentAmount", 0] }] }],
};

// Zero-amount invoices not yet read from their PDF.
export const NEEDS_AMOUNT = {
  amountExtractedAt: null,
  documentUrl: { $exists: true, $ne: "" },
  $expr: { $lte: [AMOUNT_EXPR, 0] },
};

export const countNeedingAmount = () => TaxInvoice.countDocuments(NEEDS_AMOUNT);

const isPdf = (inv) =>
  /\.pdf(\?|$)/i.test(inv.documentUrl || "") || /\.pdf$/i.test(inv.originalFileName || "");

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

let running = false;
let pausedUntil = 0;

// What the Billing screen shows, so a stalled back-fill is never a mystery.
// Lives in server memory and resets when the server restarts.
const status = {
  lastError: "",
  lastErrorAt: null,
  read: 0, // invoices read from their PDF since the server started
  saved: 0, // of those, how many gave an amount
  failed: new Set(), // invoices that errored — skipped until "Retry now"
};
const failCounts = new Map();

export const getBackfillStatus = () => ({
  running,
  paused: Date.now() < pausedUntil,
  pausedUntil: Date.now() < pausedUntil ? new Date(pausedUntil).toISOString() : null,
  lastError: status.lastError,
  lastErrorAt: status.lastErrorAt,
  read: status.read,
  saved: status.saved,
  failedCount: status.failed.size,
});

const noteError = (msg) => {
  status.lastError = String(msg || "").slice(0, 300);
  status.lastErrorAt = new Date().toISOString();
};
const RETRY_AFTER_AI_FAILURE_MS = 10 * 60 * 1000;
const MAX_PER_RUN = 40;

async function processOne(inv) {
  // Not something the AI can read: stamp it so it is not picked up again.
  if (!isPdf(inv)) {
    await TaxInvoice.updateOne({ _id: inv._id, amountExtractedAt: null }, { $set: { amountExtractedAt: new Date() } });
    return;
  }

  const res = await fetch(inv.documentUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching the invoice file`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const { fields, modelUsed } = await extractDocumentFields({
    buffer,
    mimeType: "application/pdf",
    fileName: inv.originalFileName || "invoice.pdf",
    fields: getDocumentSchema("taxInvoice"),
  });

  const { amounts } = computeBillAmounts({
    paymentAmount: num(fields.taxableAmount),
    cgstAmount: num(fields.cgstAmount),
    sgstAmount: num(fields.sgstAmount),
    igstAmount: num(fields.igstAmount),
    // Keep a freight figure someone already entered.
    freightCharges: inv.freightCharges > 0 ? inv.freightCharges : num(fields.freightCharges),
    grandTotal: num(fields.totalAmount),
  }) || {};

  const set = { amountExtractedAt: new Date(), amountExtractionModel: modelUsed || null };
  // Save only when the PDF actually gave an amount; otherwise just stamp it.
  if (amounts && (amounts.grandTotal > 0 || amounts.totalBill > 0)) {
    Object.assign(set, {
      paymentAmount: amounts.paymentAmount,
      gstType: amounts.gstType,
      cgstAmount: amounts.cgstAmount,
      sgstAmount: amounts.sgstAmount,
      igstAmount: amounts.igstAmount,
      freightCharges: amounts.freightCharges,
      totalBill: amounts.totalBill,
      grandTotal: amounts.grandTotal,
    });
  }
  // The filter makes sure two runs can never both save the same invoice.
  await TaxInvoice.updateOne({ _id: inv._id, amountExtractedAt: null }, { $set: set });
  status.read += 1;
  if (set.grandTotal > 0 || set.totalBill > 0) status.saved += 1;
}

/** "Retry now": forgets the pause and past failures, then starts a run. */
export function resumeBackfill() {
  pausedUntil = 0;
  status.failed.clear();
  failCounts.clear();
  status.lastError = "";
  triggerAmountBackfill();
}

/**
 * Fire-and-forget: reads up to MAX_PER_RUN pending invoices, one at a time.
 * Safe to call on every page load — it does nothing if a run is already going
 * or the AI recently failed.
 */
export function triggerAmountBackfill() {
  if (running || Date.now() < pausedUntil) return;
  running = true;

  (async () => {
    try {
      const batch = await TaxInvoice.find({ ...NEEDS_AMOUNT, _id: { $nin: [...status.failed] } })
        .select("documentUrl originalFileName freightCharges")
        .sort({ createdAt: -1 })
        .limit(MAX_PER_RUN)
        .lean();

      for (const inv of batch) {
        try {
          await processOne(inv);
        } catch (err) {
          // AI down / quota / download failed: leave unstamped and try again later.
          console.warn(`[billing back-fill] ${inv._id}: ${err.message}`);
          noteError(err.message);
          if (err instanceof AiExtractionError) {
            pausedUntil = Date.now() + RETRY_AFTER_AI_FAILURE_MS;
            break;
          }
          // A file that can't be downloaded/read: give up on it after 2 tries.
          const n = (failCounts.get(String(inv._id)) || 0) + 1;
          failCounts.set(String(inv._id), n);
          if (n >= 2) status.failed.add(inv._id);
        }
      }
    } catch (err) {
      console.warn(`[billing back-fill] stopped: ${err.message}`);
      noteError(err.message);
    } finally {
      running = false;
    }
  })();
}