import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import TaxInvoice, { PAYMENT_METHODS, CASH_METHOD } from "../models/TaxInvoice.js";
import Vendor from "../models/Vendor.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import StockEntry from "../models/StockEntry.js";
import Part from "../models/Part.js";
import { triggerAmountBackfill, resumeBackfill, getBackfillStatus, countNeedingAmount } from "../utils/backfillInvoiceAmounts.js";

/**
 * Billing = the tax invoices uploaded at stock entry (Receive material, step 5).
 * Nobody uploads bills here any more: each invoice arrives UNPAID and is marked
 * paid once, with a UTR number (left null for a cash purchase).
 */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Invoices saved before billing existed have no payment.status, so "unpaid"
// has to mean "anything that is not paid", not "equals unpaid".
const NOT_PAID = { $ne: "paid" };

const POPULATE = [
  { path: "vendor", select: "companyName taxRegistrationNo" },
  { path: "purchaseOrder", select: "documentType documentNumber" },
  { path: "payment.paidBy", select: "name username" },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The amount payable on an invoice: the invoice's own grand total, else the
// computed bill total (taxable + GST), else the taxable value. Old invoices
// saved before amounts were captured have none of these -> 0.
const invoiceAmount = (inv) =>
  Number(inv?.grandTotal ?? inv?.totalBill ?? inv?.paymentAmount ?? 0) || 0;

const gstOf = (inv) =>
  (Number(inv?.cgstAmount) || 0) + (Number(inv?.sgstAmount) || 0) + (Number(inv?.igstAmount) || 0);

const AMOUNT_EXPR = { $ifNull: ["$grandTotal", { $ifNull: ["$totalBill", { $ifNull: ["$paymentAmount", 0] }] }] };

// Installments: an invoice can be settled in parts. payment.status goes
// unpaid -> partial -> paid; payment.paidAmount is the running total received.
// An invoice that is "paid" (including every one marked before installments
// existed) counts as fully received, whatever paidAmount says.
const receivedOf = (inv) =>
  inv?.payment?.status === "paid"
    ? round2(invoiceAmount(inv))
    : round2(Math.min(Number(inv?.payment?.paidAmount) || 0, invoiceAmount(inv) || Infinity));
const balanceOf = (inv) => Math.max(0, round2(invoiceAmount(inv) - receivedOf(inv)));
const statusOf = (inv) => inv?.payment?.status || "unpaid";
const withMoney = (inv) => {
  const o = inv.toObject ? inv.toObject() : inv;
  return {
    ...o,
    amount: invoiceAmount(inv),
    gstTotal: round2(gstOf(inv)),
    paidAmount: receivedOf(inv),
    balance: balanceOf(inv),
  };
};

const sumAmounts = (rows) => round2(rows.reduce((s, r) => s + invoiceAmount(r), 0));

// GET /api/billing?status=unpaid|paid|all&search=
export const listInvoices = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "unpaid");
  const filter = {};
  if (status === "paid") filter["payment.status"] = "paid";
  else if (status === "partial") filter["payment.status"] = "partial";
  // "Unpaid" = still owes money, so part-paid invoices stay in this tab.
  else if (status === "unpaid") filter["payment.status"] = NOT_PAID;

  const q = String(req.query.search || "").trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    const [vendors, docs] = await Promise.all([
      Vendor.find({ $or: [{ companyName: rx }, { taxRegistrationNo: rx }] }, "_id").lean(),
      PurchaseOrder.find({ documentNumber: rx }, "_id").lean(),
    ]);
    filter.$or = [
      { invoiceNumber: rx },
      { "payment.utrNumber": rx },
      ...(vendors.length ? [{ vendor: { $in: vendors.map((v) => v._id) } }] : []),
      ...(docs.length ? [{ purchaseOrder: { $in: docs.map((d) => d._id) } }] : []),
    ];
  }

  const [items, amountRows, amountsPending] = await Promise.all([
    TaxInvoice.find(filter)
      .select("-extractedLines")
      .populate(POPULATE)
      .sort(status === "paid" ? { "payment.paidAt": -1 } : { createdAt: -1 })
      .limit(500),
    // Counts and rupee totals per tab (whole collection, not just the 500 rows shown).
    TaxInvoice.aggregate([
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                { case: { $eq: ["$payment.status", "paid"] }, then: "paid" },
                { case: { $eq: ["$payment.status", "partial"] }, then: "partial" },
              ],
              default: "unpaid",
            },
          },
          count: { $sum: 1 },
          total: { $sum: AMOUNT_EXPR },
          received: { $sum: { $ifNull: ["$payment.paidAmount", 0] } },
        },
      },
    ]),
    countNeedingAmount(),
  ]);

  // Invoices with a 0 amount get it read once from their PDF in the background;
  // the page re-loads while amountsPending > 0.
  if (amountsPending > 0) triggerAmountBackfill();

  // Tab figures: "Unpaid" and "Partial" show what is still OWED (invoice amount
  // minus installments received); "Paid" and "All" show full invoice values.
  const by = Object.fromEntries(amountRows.map((r) => [r._id, r]));
  const g = (k) => by[k] || { count: 0, total: 0, received: 0 };
  const partialDue = Math.max(0, g("partial").total - g("partial").received);
  const counts = {
    unpaid: g("unpaid").count + g("partial").count,
    partial: g("partial").count,
    paid: g("paid").count,
    all: g("unpaid").count + g("partial").count + g("paid").count,
  };
  const amounts = {
    unpaid: round2(g("unpaid").total + partialDue),
    partial: round2(partialDue),
    paid: round2(g("paid").total),
    all: round2(g("unpaid").total + g("partial").total + g("paid").total),
  };

  // Total of the rows currently listed (respects the search box).
  const listedTotal = sumAmounts(items);

  res.json({
    items: items.map(withMoney),
    counts,
    amounts,
    listedTotal,
    amountsPending,
    backfill: getBackfillStatus(),
    paymentMethods: PAYMENT_METHODS,
  });
});

// GET /api/billing/pending-count — unpaid invoices (sidebar badge).
// Returns 0 rather than 403 for people without billing access.
export const pendingCount = asyncHandler(async (req, res) => {
  const allowed = (req.permissions || []).includes("payment.pay");
  const count = allowed ? await TaxInvoice.countDocuments({ "payment.status": NOT_PAID }) : 0;
  res.json({ count });
});

// PATCH /api/billing/:id/pay   { paymentMethod, utrNumber, paymentDate, remarks, amount? }
// Records ONE payment against the invoice.
//   - no `amount`            -> pays the whole remaining balance (invoice closes as "paid")
//   - `amount` < balance     -> an installment: invoice becomes / stays "partial"
//   - `amount` == balance    -> last installment: invoice closes as "paid"
// Every payment is kept in payment.installments; the top-level payment fields
// mirror the latest one.
export const markPaid = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid invoice id" });

  const method = String(req.body?.paymentMethod || "").trim();
  if (!PAYMENT_METHODS.includes(method))
    return res.status(400).json({ message: "Choose how this invoice was paid." });

  // UTR is mandatory for every method except a cash purchase, where it is
  // always stored as null (anything sent for it is ignored).
  let utrNumber = null;
  if (method !== CASH_METHOD) {
    utrNumber = String(req.body?.utrNumber || "").trim().toUpperCase();
    if (!utrNumber) return res.status(400).json({ message: "Enter the UTR number." });
    if (!/^[A-Z0-9][A-Z0-9\-/]{4,39}$/.test(utrNumber))
      return res.status(400).json({
        message: "The UTR number should be 5–40 characters: letters, digits, - or / only.",
      });
  }

  const paymentDate = req.body?.paymentDate ? new Date(req.body.paymentDate) : new Date();
  if (Number.isNaN(paymentDate.getTime()))
    return res.status(400).json({ message: "Enter a valid payment date." });
  if (paymentDate.getTime() > Date.now() + 24 * 60 * 60 * 1000)
    return res.status(400).json({ message: "Payment date cannot be in the future." });

  const remarks = String(req.body?.remarks || "").trim();

  const invoice = await TaxInvoice.findById(id).select("-extractedLines");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (statusOf(invoice) === "paid")
    return res.status(409).json({ message: "This invoice has already been marked as paid." });

  const total = round2(invoiceAmount(invoice));
  const before = round2(Math.max(0, Number(invoice.payment?.paidAmount) || 0));
  const balance = round2(Math.max(0, total - before));

  // How much is being paid now. Left blank = the whole balance.
  const rawAmount = req.body?.amount;
  const given = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== "";
  let amount = balance;
  if (given) {
    amount = round2(Number(rawAmount));
    if (!Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({ message: "Enter an amount greater than 0." });
    if (total <= 0)
      return res.status(400).json({
        message:
          "This invoice's amount has not been read yet, so a part payment cannot be recorded. Wait for the amount to appear (or use Read amounts now), then try again.",
      });
    if (amount > balance + 0.004)
      return res.status(400).json({
        message: `The amount is more than the balance due (₹${balance.toLocaleString("en-IN", {
          minimumFractionDigits: 2,
        })}).`,
      });
  }

  const nowPaid = round2(before + amount);
  // Closes the invoice when nothing is left (or it never had an amount, which
  // keeps the old "mark paid" behaviour for such invoices).
  const closes = total <= 0 || nowPaid >= total - 0.004;
  const now = new Date();
  const byName = req.user.name || req.user.username || "";

  const update = {
    $set: {
      "payment.status": closes ? "paid" : "partial",
      "payment.method": method,
      "payment.utrNumber": utrNumber,
      "payment.paymentDate": paymentDate,
      "payment.paidAt": now,
      "payment.paidBy": req.user._id,
      "payment.paidByName": byName,
      "payment.remarks": remarks,
      "payment.paidAmount": closes && total > 0 ? total : nowPaid,
    },
  };
  if (amount > 0)
    update.$push = {
      "payment.installments": {
        amount,
        method,
        utrNumber,
        paymentDate,
        paidAt: now,
        paidBy: req.user._id,
        paidByName: byName,
        remarks,
      },
    };

  // Only applies if the invoice is still exactly as it was read above (not
  // paid, same amount already received), so two people paying at the same
  // moment can never overwrite each other or overpay the invoice.
  const updated = await TaxInvoice.findOneAndUpdate(
    {
      _id: id,
      "payment.status": NOT_PAID,
      "payment.paidAmount": before === 0 ? { $in: [0, null] } : before,
    },
    update,
    { new: true }
  )
    .select("-extractedLines")
    .populate(POPULATE);

  if (!updated)
    return res.status(409).json({
      message: "This invoice was just updated by someone else. Refresh the page and check the balance.",
    });

  res.json(withMoney(updated));
});

// PATCH /api/billing/:id/payment   { paymentMethod, utrNumber, paymentDate, remarks }
// Corrects the payment details of an invoice that is ALREADY paid or part-paid
// (for a part-paid / multi-installment invoice this edits the LATEST payment).
// The invoice keeps its status; every changed field is appended to payment.editHistory
// (from -> to, who, when) so the original entry is never silently lost.
export const updatePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid invoice id" });

  const invoice = await TaxInvoice.findById(id).select("-extractedLines");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (!["paid", "partial"].includes(invoice.payment?.status))
    return res.status(409).json({ message: "No payment has been recorded for this invoice yet." });

  const method = String(req.body?.paymentMethod || "").trim();
  if (!PAYMENT_METHODS.includes(method))
    return res.status(400).json({ message: "Choose how this invoice was paid." });

  let utrNumber = null;
  if (method !== CASH_METHOD) {
    utrNumber = String(req.body?.utrNumber || "").trim().toUpperCase();
    if (!utrNumber) return res.status(400).json({ message: "Enter the UTR number." });
    if (!/^[A-Z0-9][A-Z0-9\-/]{4,39}$/.test(utrNumber))
      return res.status(400).json({
        message: "The UTR number should be 5–40 characters: letters, digits, - or / only.",
      });
  }

  const paymentDate = req.body?.paymentDate ? new Date(req.body.paymentDate) : null;
  if (!paymentDate || Number.isNaN(paymentDate.getTime()))
    return res.status(400).json({ message: "Enter a valid payment date." });
  if (paymentDate.getTime() > Date.now() + 24 * 60 * 60 * 1000)
    return res.status(400).json({ message: "Payment date cannot be in the future." });

  const remarks = String(req.body?.remarks || "").trim();

  const old = invoice.payment;
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const changes = [];
  const track = (field, from, to) => {
    if (String(from ?? "") !== String(to ?? "")) changes.push({ field, from: String(from ?? ""), to: String(to ?? "") });
  };
  track("Payment method", old.method, method);
  track("UTR number", old.utrNumber, utrNumber);
  track("Payment date", day(old.paymentDate), day(paymentDate));
  track("Remarks", old.remarks, remarks);

  if (changes.length === 0) {
    await invoice.populate(POPULATE);
    return res.json(withMoney(invoice));
  }

  const byName = req.user.name || req.user.username || "";
  const now = new Date();

  // Targeted $set/$push (not doc.save) so older invoices with missing fields
  // are never re-validated, and the invoice can only be edited while paid.
  const set = {
    "payment.method": method,
    "payment.utrNumber": utrNumber,
    "payment.paymentDate": paymentDate,
    "payment.remarks": remarks,
    "payment.editedAt": now,
    "payment.editedByName": byName,
  };
  // Keep the latest installment in step with the top-level fields.
  const lastIdx = (invoice.payment?.installments?.length || 0) - 1;
  if (lastIdx >= 0) {
    set[`payment.installments.${lastIdx}.method`] = method;
    set[`payment.installments.${lastIdx}.utrNumber`] = utrNumber;
    set[`payment.installments.${lastIdx}.paymentDate`] = paymentDate;
    set[`payment.installments.${lastIdx}.remarks`] = remarks;
  }

  const updated = await TaxInvoice.findOneAndUpdate(
    { _id: id, "payment.status": { $in: ["paid", "partial"] } },
    {
      $set: set,
      $push: { "payment.editHistory": { at: now, by: req.user._id, byName, changes } },
    },
    { new: true }
  )
    .select("-extractedLines")
    .populate(POPULATE);

  if (!updated) return res.status(409).json({ message: "No payment is recorded for this invoice any more." });
  res.json(withMoney(updated));
});

// DELETE /api/billing/:id/payment   { installmentId?, reason }
// Removes a payment that should not be there (entered by mistake, wrong invoice…).
//   - installmentId given -> that installment is removed
//   - no installmentId    -> only allowed for an invoice paid in one go before
//                            installments existed (it has none): clears that payment
// The invoice's status and paid total are recalculated (Paid -> Part-paid -> Unpaid)
// and the removed entry is kept in payment.deletedPayments with who/when/why.
export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: "Invalid invoice id" });

  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ message: "Write a reason for deleting this payment." });

  const invoice = await TaxInvoice.findById(id).select("-extractedLines");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (!["paid", "partial"].includes(statusOf(invoice)))
    return res.status(409).json({ message: "No payment is recorded for this invoice." });

  const p = invoice.payment || {};
  const all = (p.installments || []).map((i) => (i.toObject ? i.toObject() : i));
  const installmentId = String(req.body?.installmentId || "").trim();

  let removed;
  let remaining;
  if (installmentId) {
    const idx = all.findIndex((i) => String(i._id) === installmentId);
    if (idx < 0)
      return res.status(404).json({ message: "That payment was not found (it may already be deleted)." });
    removed = all[idx];
    remaining = all.filter((_, i) => i !== idx);
  } else {
    if (all.length)
      return res.status(400).json({ message: "Choose which payment to delete." });
    // Paid in one go before installments existed.
    removed = {
      amount: round2(invoiceAmount(invoice)),
      method: p.method,
      utrNumber: p.utrNumber,
      paymentDate: p.paymentDate,
      paidByName: p.paidByName,
    };
    remaining = [];
  }

  const total = round2(invoiceAmount(invoice));
  const paidAmount = round2(remaining.reduce((s, i) => s + (Number(i.amount) || 0), 0));
  const status = remaining.length === 0 ? "unpaid" : total > 0 && paidAmount >= total - 0.004 ? "paid" : "partial";
  const last = remaining[remaining.length - 1];

  const byName = req.user.name || req.user.username || "";
  const now = new Date();
  const set = {
    "payment.status": status,
    "payment.installments": remaining,
    "payment.paidAmount": paidAmount,
    // The top-level fields always mirror the latest remaining payment.
    "payment.method": last?.method || "",
    "payment.utrNumber": last ? last.utrNumber ?? null : null,
    "payment.paymentDate": last?.paymentDate || null,
    "payment.paidAt": last?.paidAt || null,
    "payment.paidBy": last?.paidBy || null,
    "payment.paidByName": last?.paidByName || "",
    "payment.remarks": last?.remarks || "",
  };
  // Nothing left: the invoice goes back to a clean unpaid state.
  if (!last) {
    set["payment.editedAt"] = null;
    set["payment.editedByName"] = "";
  }

  // Only applies if the payments are still exactly as read above.
  const sizeGuard = all.length
    ? { "payment.installments": { $size: all.length } }
    : { "payment.installments.0": { $exists: false } };
  const updated = await TaxInvoice.findOneAndUpdate(
    { _id: id, "payment.status": { $in: ["paid", "partial"] }, ...sizeGuard },
    {
      $set: set,
      $push: {
        "payment.deletedPayments": {
          at: now,
          by: req.user._id,
          byName,
          reason,
          amount: round2(removed.amount),
          method: removed.method || "",
          utrNumber: removed.utrNumber ?? null,
          paymentDate: removed.paymentDate || null,
          paidByName: removed.paidByName || "",
        },
      },
    },
    { new: true }
  )
    .select("-extractedLines")
    .populate(POPULATE);

  if (!updated)
    return res.status(409).json({
      message: "This invoice's payments just changed. Refresh the page and try again.",
    });

  res.json(withMoney(updated));
});

/* ------------------------------------------------------------------ */
/* Custom report                                                       */
/* ------------------------------------------------------------------ */

const startOfDay = (s) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const endOfDay = (s) => {
  const d = new Date(`${s}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/*
  Keyword matching for the report.
    search=<words>      spaces or commas separate words; "quoted text" (straight
                        or curly quotes) stays one phrase. Up to 8 terms.
    searchMode=all|any  all (default): an invoice must match EVERY term;
                        any: matching one term is enough.
    searchIn=a,b,c      where to look (default: all of them) —
                        vendor (name / GSTIN), invoice (invoice no.),
                        po (PO / PI no.), utr, remarks (payment remarks and
                        who paid), parts (part no. / description / MPN of the
                        parts received against the invoice).
  A term matches anywhere inside a value, ignoring case.
*/
const KEYWORD_FIELDS = ["vendor", "invoice", "po", "utr", "remarks", "parts"];
const MAX_KEYWORDS = 8;

function parseKeywords(raw) {
  const terms = [];
  const re = /["\u201c]([^"\u201d]+)["\u201d]|([^\s,]+)/g;
  let m;
  while ((m = re.exec(String(raw || "")))) {
    const t = (m[1] || m[2] || "").trim();
    if (t) terms.push(t);
  }
  const seen = new Set();
  return terms
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_KEYWORDS);
}

function keywordOptions(query) {
  const requested = String(query.searchIn || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => KEYWORD_FIELDS.includes(x));
  return {
    terms: parseKeywords(query.search),
    mode: query.searchMode === "any" ? "any" : "all",
    fields: requested.length ? requested : KEYWORD_FIELDS,
  };
}

// One Mongo condition per term: the invoice matches the term if ANY of the
// chosen fields contains it.
async function keywordClause(term, fields) {
  const has = (f) => fields.includes(f);
  const rx = { $regex: escapeRegex(term), $options: "i" };
  const or = [];
  if (has("invoice")) or.push({ invoiceNumber: rx });
  if (has("utr")) or.push({ "payment.utrNumber": rx }, { "payment.installments.utrNumber": rx });
  if (has("remarks"))
    or.push(
      { "payment.remarks": rx },
      { "payment.installments.remarks": rx },
      { "payment.paidByName": rx },
      { "payment.installments.paidByName": rx }
    );

  const [vendors, docs, partDocs] = await Promise.all([
    has("vendor") ? Vendor.find({ $or: [{ companyName: rx }, { taxRegistrationNo: rx }] }, "_id").lean() : [],
    has("po") ? PurchaseOrder.find({ documentNumber: rx }, "_id").lean() : [],
    has("parts")
      ? Part.find(
          { $or: [{ ttUniquePartNumber: rx }, { itemDescription: rx }, { manufacturerPartNumber: rx }] },
          "_id"
        ).lean()
      : [],
  ]);
  if (vendors.length) or.push({ vendor: { $in: vendors.map((v) => v._id) } });
  if (docs.length) or.push({ purchaseOrder: { $in: docs.map((d) => d._id) } });
  if (partDocs.length) {
    const invoiceIds = await StockEntry.distinct("appliedVia", {
      part: { $in: partDocs.map((p) => p._id) },
      appliedVia: { $ne: null },
    });
    if (invoiceIds.length) or.push({ _id: { $in: invoiceIds } });
  }
  // Nothing can match this term in the chosen fields.
  return or.length ? { $or: or } : { _id: { $in: [] } };
}

// Builds the report from query params:
//   status=all|paid|unpaid  dateField=invoice|payment  from=YYYY-MM-DD  to=YYYY-MM-DD
//   vendor=<id>  method=<payment method>  minAmount  maxAmount  groupBy=none|vendor|method|month
//   search / searchMode / searchIn  (keyword matching — see above)
async function buildReport(query) {
  const status = ["paid", "unpaid", "partial"].includes(query.status) ? query.status : "all";
  const dateField = query.dateField === "payment" ? "payment" : "invoice";
  const groupBy = ["vendor", "method", "month"].includes(query.groupBy) ? query.groupBy : "none";

  const and = [];
  if (status === "paid") and.push({ "payment.status": "paid" });
  if (status === "unpaid") and.push({ "payment.status": NOT_PAID }); // includes part-paid
  if (status === "partial") and.push({ "payment.status": "partial" });

  if (query.vendor && mongoose.isValidObjectId(query.vendor))
    and.push({ vendor: new mongoose.Types.ObjectId(query.vendor) });

  const method = String(query.method || "").trim();
  if (method && PAYMENT_METHODS.includes(method)) and.push({ "payment.method": method });

  const from = query.from ? startOfDay(String(query.from)) : null;
  const to = query.to ? endOfDay(String(query.to)) : null;
  if (from || to) {
    const dateExpr =
      dateField === "payment" ? "$payment.paymentDate" : { $ifNull: ["$invoiceDate", "$createdAt"] };
    const conds = [];
    if (from) conds.push({ $gte: [dateExpr, from] });
    if (to) conds.push({ $lte: [dateExpr, to] });
    and.push({ $expr: { $and: conds } });
  }

  // Part filter (comma-separated Part ids from the report's part picker): keep
  // only invoices that cover at least one of those parts, i.e. that a received
  // stock line of the part was booked against (StockEntry.appliedVia).
  const partIds = String(query.parts || "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => mongoose.isValidObjectId(x));
  if (partIds.length) {
    const invoiceIds = await StockEntry.distinct("appliedVia", {
      part: { $in: partIds },
      appliedVia: { $ne: null },
    });
    and.push({ _id: { $in: invoiceIds } });
  }

  const min = query.minAmount !== undefined && query.minAmount !== "" ? Number(query.minAmount) : null;
  const max = query.maxAmount !== undefined && query.maxAmount !== "" ? Number(query.maxAmount) : null;
  if (min !== null && !Number.isNaN(min)) and.push({ $expr: { $gte: [AMOUNT_EXPR, min] } });
  if (max !== null && !Number.isNaN(max)) and.push({ $expr: { $lte: [AMOUNT_EXPR, max] } });

  const kw = keywordOptions(query);
  if (kw.terms.length) {
    const clauses = await Promise.all(kw.terms.map((t) => keywordClause(t, kw.fields)));
    and.push(kw.mode === "any" ? { $or: clauses } : { $and: clauses });
  }

  const filter = and.length ? { $and: and } : {};
  const sortKey = dateField === "payment" ? { "payment.paymentDate": -1 } : { invoiceDate: -1, createdAt: -1 };

  const invoices = await TaxInvoice.find(filter)
    .select("-extractedLines")
    .populate(POPULATE)
    .sort(sortKey)
    .limit(5000)
    .lean();

  const rows = invoices.map((inv) => {
    const st = statusOf(inv);
    const paid = st === "paid";
    // Method / UTR / date / who show the LATEST payment for paid and part-paid invoices.
    const hasPayment = paid || st === "partial";
    return {
      _id: String(inv._id),
      vendor: inv.vendor?.companyName || "—",
      gstin: inv.vendor?.taxRegistrationNo || "",
      invoiceNumber: inv.invoiceNumber || "",
      invoiceDate: inv.invoiceDate || inv.createdAt,
      poNumber: inv.purchaseOrder?.documentNumber || "",
      status: paid ? "Paid" : st === "partial" ? "Partial" : "Unpaid",
      taxable: round2(inv.paymentAmount),
      gst: round2(gstOf(inv)),
      freight: round2(inv.freightCharges),
      amount: round2(invoiceAmount(inv)),
      received: receivedOf(inv),
      balance: balanceOf(inv),
      installments: (inv.payment?.installments || []).length,
      method: hasPayment ? inv.payment?.method || "" : "",
      utr: hasPayment ? inv.payment?.utrNumber || "" : "",
      paymentDate: hasPayment ? inv.payment?.paymentDate || null : null,
      paidBy: hasPayment ? inv.payment?.paidBy?.name || inv.payment?.paidByName || "" : "",
      remarks: hasPayment ? inv.payment?.remarks || "" : "",
    };
  });

  const paidRows = rows.filter((r) => r.status === "Paid");
  const partialRows = rows.filter((r) => r.status === "Partial");
  const unpaidRows = rows.filter((r) => r.status !== "Paid"); // unpaid + part-paid
  const sum = (list, key = "amount") => round2(list.reduce((s, r) => s + r[key], 0));

  const summary = {
    count: rows.length,
    totalAmount: sum(rows),
    // paidAmount = money actually received (full payments + installments);
    // unpaidAmount = balance still due. They always add up to totalAmount.
    paidCount: paidRows.length,
    partialCount: partialRows.length,
    paidAmount: sum(rows, "received"),
    unpaidCount: unpaidRows.length,
    unpaidAmount: sum(rows, "balance"),
    taxable: sum(rows, "taxable"),
    gst: sum(rows, "gst"),
    freight: sum(rows, "freight"),
    truncated: invoices.length >= 5000,
  };

  let groups = [];
  if (groupBy !== "none") {
    const keyOf = (r) => {
      if (groupBy === "vendor") return r.vendor;
      if (groupBy === "method")
        return r.status === "Paid" ? r.method || "—" : r.status === "Partial" ? "Part-paid" : "Unpaid";
      const d = r.invoiceDate ? new Date(r.invoiceDate) : null;
      return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "—";
    };
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const g = map.get(k) || { key: k, count: 0, paidAmount: 0, unpaidAmount: 0, amount: 0 };
      g.count += 1;
      g.amount += r.amount;
      g.paidAmount += r.received;
      g.unpaidAmount += r.balance;
      map.set(k, g);
    }
    groups = [...map.values()]
      .map((g) => ({
        ...g,
        amount: round2(g.amount),
        paidAmount: round2(g.paidAmount),
        unpaidAmount: round2(g.unpaidAmount),
      }))
      .sort((a, b) => (groupBy === "month" ? b.key.localeCompare(a.key) : b.amount - a.amount));
  }

  return {
    rows,
    summary,
    groups,
    groupBy,
    partIds,
    filters: { status, dateField, groupBy, keywords: kw.terms, searchMode: kw.mode, searchIn: kw.fields },
  };
}

// GET /api/billing/report
export const getReport = asyncHandler(async (req, res) => {
  const [report, vendorIds] = await Promise.all([buildReport(req.query), TaxInvoice.distinct("vendor")]);
  // Vendors that have at least one invoice — feeds the report's vendor filter.
  const vendors = await Vendor.find({ _id: { $in: vendorIds } }, "companyName")
    .sort({ companyName: 1 })
    .lean();
  res.json({ ...report, vendors, paymentMethods: PAYMENT_METHODS });
});

// GET /api/billing/report/export  -> .xlsx download
export const exportReport = asyncHandler(async (req, res) => {
  const { rows, summary, groups, groupBy } = await buildReport(req.query);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Stock Management";
  const money = "#,##0.00";
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

  // ---- Sheet 1: invoices ----
  const ws = wb.addWorksheet("Billing report");
  ws.columns = [
    { header: "Vendor", key: "vendor", width: 32 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Invoice no.", key: "invoiceNumber", width: 18 },
    { header: "Invoice date", key: "invoiceDate", width: 13 },
    { header: "PO / PI", key: "poNumber", width: 16 },
    { header: "Status", key: "status", width: 10 },
    { header: "Taxable amount", key: "taxable", width: 15 },
    { header: "GST", key: "gst", width: 13 },
    { header: "Freight", key: "freight", width: 12 },
    { header: "Invoice amount", key: "amount", width: 16 },
    { header: "Payment method", key: "method", width: 15 },
    { header: "UTR", key: "utr", width: 22 },
    { header: "Payment date", key: "paymentDate", width: 13 },
    { header: "Paid by", key: "paidBy", width: 16 },
    { header: "Remarks", key: "remarks", width: 28 },
    { header: "Amount paid", key: "received", width: 16 },
    { header: "Balance due", key: "balance", width: 16 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = headFill;
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    ws.addRow({
      ...r,
      invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null,
      paymentDate: r.paymentDate ? new Date(r.paymentDate) : null,
    });
  }
  ["D", "M"].forEach((c) => (ws.getColumn(c).numFmt = "dd-mm-yyyy"));
  ["G", "H", "I", "J", "P", "Q"].forEach((c) => (ws.getColumn(c).numFmt = money));

  const total = ws.addRow({ vendor: "TOTAL", taxable: summary.taxable, gst: summary.gst, freight: summary.freight, amount: summary.totalAmount, received: summary.paidAmount, balance: summary.unpaidAmount });
  total.font = { bold: true };
  total.fill = headFill;

  // ---- Sheet 2: summary ----
  const ss = wb.addWorksheet("Summary");
  ss.columns = [
    { header: "", key: "a", width: 30 },
    { header: "", key: "b", width: 12 },
    { header: "", key: "c", width: 18 },
  ];
  const title = ss.addRow(["Billing report summary"]);
  title.font = { bold: true, size: 13 };
  ss.addRow([]);
  const h = ss.addRow(["", "Invoices", "Amount"]);
  h.font = { bold: true };
  h.fill = headFill;
  ss.addRow(["Balance due (unpaid + part-paid)", summary.unpaidCount, summary.unpaidAmount]);
  ss.addRow(["Amount received (incl. installments)", summary.paidCount + summary.partialCount, summary.paidAmount]);
  const t = ss.addRow(["Total", summary.count, summary.totalAmount]);
  t.font = { bold: true };

  if (groups.length) {
    ss.addRow([]);
    const label = { vendor: "Vendor", method: "Payment method", month: "Invoice month" }[groupBy];
    const gh = ss.addRow([`By ${label}`, "Invoices", "Total", "Paid", "Unpaid"]);
    gh.font = { bold: true };
    gh.fill = headFill;
    ss.getColumn("d").width = 18;
    ss.getColumn("e").width = 18;
    for (const g of groups) ss.addRow([g.key, g.count, g.amount, g.paidAmount, g.unpaidAmount]);
  }
  ss.eachRow((row) => {
    [3, 4, 5].forEach((i) => {
      if (typeof row.getCell(i).value === "number") row.getCell(i).numFmt = money;
    });
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="billing-report-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});


/*
  GET /api/billing/report/full-export  -> .xlsx download (same filters as the report)
  The complete payment trail: for every invoice, what was received against it
  (parts, qty, rate, received date, batch, IQC result) and how it was settled
  (method, UTR, payment date, who paid). Sheets:
    Payment trail   one row per received line; the invoice's amounts and payment
                    details sit on the invoice's first row only, so the money
                    columns can be summed without double counting
    Invoices        one row per invoice (same as the standard export)
    Vendor summary  total / paid / unpaid per vendor
    Report filters  what this file was generated with
  When parts are picked, the trail lists only those parts' lines.
*/
export const exportFullReport = asyncHandler(async (req, res) => {
  const { rows, summary, partIds } = await buildReport(req.query);
  const partSet = new Set(partIds.map(String));

  const invoiceIds = rows.map((r) => r._id);
  const entries = invoiceIds.length
    ? await StockEntry.find({ appliedVia: { $in: invoiceIds } })
        .populate("part", "ttUniquePartNumber itemDescription unit")
        .sort({ createdAt: 1 })
        .lean()
    : [];
  const linesByInvoice = new Map();
  for (const e of entries) {
    if (partSet.size && !partSet.has(String(e.part?._id))) continue;
    const k = String(e.appliedVia);
    if (!linesByInvoice.has(k)) linesByInvoice.set(k, []);
    linesByInvoice.get(k).push(e);
  }

  const IQC_LABEL = {
    awaiting_invoice: "Awaiting tax invoice",
    in_iqc_stock: "In IQC stock",
    accepted: "Accepted — in main stock",
    rejected: "Rejected in IQC",
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "Stock Management";
  const money = "#,##0.00";
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  const styleHead = (ws) => {
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = headFill;
    ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  // ---- Payment trail ----
  const tr = wb.addWorksheet("Payment trail");
  tr.columns = [
    { header: "Vendor", key: "vendor", width: 30 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "PO / PI", key: "po", width: 16 },
    { header: "Received on", key: "received", width: 13 },
    { header: "TT part number", key: "pn", width: 20 },
    { header: "Item description", key: "desc", width: 38 },
    { header: "Qty", key: "qty", width: 9 },
    { header: "Unit", key: "unit", width: 7 },
    { header: "Rate", key: "rate", width: 11 },
    { header: "Line value", key: "lineValue", width: 13 },
    { header: "Batch (WW/YY)", key: "batch", width: 13 },
    { header: "IQC status", key: "iqc", width: 24 },
    { header: "Invoice no.", key: "invoiceNumber", width: 18 },
    { header: "Invoice date", key: "invoiceDate", width: 13 },
    { header: "Taxable amount", key: "taxable", width: 15 },
    { header: "GST", key: "gst", width: 13 },
    { header: "Freight", key: "freight", width: 12 },
    { header: "Invoice amount", key: "amount", width: 16 },
    { header: "Payment status", key: "status", width: 13 },
    { header: "Payment method", key: "method", width: 15 },
    { header: "UTR", key: "utr", width: 22 },
    { header: "Payment date", key: "paymentDate", width: 13 },
    { header: "Paid by", key: "paidBy", width: 16 },
    { header: "Remarks", key: "remarks", width: 28 },
    { header: "Amount paid", key: "received", width: 16 },
    { header: "Balance due", key: "balance", width: 16 },
  ];
  styleHead(tr);

  let trailRows = 0;
  for (const r of rows) {
    const lines = linesByInvoice.get(r._id) || [];
    if (partSet.size && lines.length === 0) continue;
    const base = {
      vendor: r.vendor,
      gstin: r.gstin,
      po: r.poNumber,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null,
      status: r.status,
    };
    const money1 = {
      taxable: r.taxable,
      gst: r.gst,
      freight: r.freight,
      amount: r.amount,
      method: r.method,
      utr: r.utr,
      paymentDate: r.paymentDate ? new Date(r.paymentDate) : null,
      paidBy: r.paidBy,
      remarks: r.remarks,
      received: r.received,
      balance: r.balance,
    };
    if (lines.length === 0) {
      tr.addRow({ ...base, ...money1, pn: "— no received lines linked —" });
      trailRows += 1;
      continue;
    }
    lines.forEach((e, i) => {
      const rate = e.price ?? null;
      tr.addRow({
        ...base,
        ...(i === 0 ? money1 : {}),
        received: e.createdAt ? new Date(e.createdAt) : null,
        pn: e.part?.ttUniquePartNumber || "",
        desc: e.part?.itemDescription || "",
        qty: e.quantityReceived,
        unit: e.unit || e.part?.unit || "",
        rate,
        lineValue: rate != null ? round2(rate * e.quantityReceived) : null,
        batch: e.batchCode || "",
        iqc: IQC_LABEL[e.iqcStatus] || "",
      });
      trailRows += 1;
    });
  }
  ["D", "N", "V"].forEach((c) => (tr.getColumn(c).numFmt = "dd-mm-yyyy"));
  ["I", "J", "O", "P", "Q", "R", "Y", "Z"].forEach((c) => (tr.getColumn(c).numFmt = money));
  if (trailRows > 0) tr.autoFilter = { from: "A1", to: `Z${trailRows + 1}` };

  // ---- Invoices ----
  const iv = wb.addWorksheet("Invoices");
  iv.columns = [
    { header: "Vendor", key: "vendor", width: 32 },
    { header: "GSTIN", key: "gstin", width: 18 },
    { header: "Invoice no.", key: "invoiceNumber", width: 18 },
    { header: "Invoice date", key: "invoiceDate", width: 13 },
    { header: "PO / PI", key: "poNumber", width: 16 },
    { header: "Status", key: "status", width: 10 },
    { header: "Taxable amount", key: "taxable", width: 15 },
    { header: "GST", key: "gst", width: 13 },
    { header: "Freight", key: "freight", width: 12 },
    { header: "Invoice amount", key: "amount", width: 16 },
    { header: "Payment method", key: "method", width: 15 },
    { header: "UTR", key: "utr", width: 22 },
    { header: "Payment date", key: "paymentDate", width: 13 },
    { header: "Paid by", key: "paidBy", width: 16 },
    { header: "Remarks", key: "remarks", width: 28 },
    { header: "Received lines", key: "lines", width: 14 },
    { header: "Amount paid", key: "received", width: 16 },
    { header: "Balance due", key: "balance", width: 16 },
  ];
  styleHead(iv);
  for (const r of rows) {
    iv.addRow({
      ...r,
      invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null,
      paymentDate: r.paymentDate ? new Date(r.paymentDate) : null,
      lines: (linesByInvoice.get(r._id) || []).length,
    });
  }
  ["D", "M"].forEach((c) => (iv.getColumn(c).numFmt = "dd-mm-yyyy"));
  ["G", "H", "I", "J", "Q", "R"].forEach((c) => (iv.getColumn(c).numFmt = money));
  const tot = iv.addRow({
    vendor: "TOTAL",
    taxable: summary.taxable,
    gst: summary.gst,
    freight: summary.freight,
    amount: summary.totalAmount,
    received: summary.paidAmount,
    balance: summary.unpaidAmount,
  });
  tot.font = { bold: true };

  // ---- Vendor summary ----
  const vs = wb.addWorksheet("Vendor summary");
  vs.columns = [
    { header: "Vendor", key: "vendor", width: 34 },
    { header: "Invoices", key: "count", width: 10 },
    { header: "Total", key: "total", width: 16 },
    { header: "Paid (received)", key: "paid", width: 16 },
    { header: "Balance due", key: "unpaid", width: 16 },
  ];
  styleHead(vs);
  const byVendor = new Map();
  for (const r of rows) {
    const g = byVendor.get(r.vendor) || { vendor: r.vendor, count: 0, total: 0, paid: 0, unpaid: 0 };
    g.count += 1;
    g.total += r.amount;
    g.paid += r.received;
    g.unpaid += r.balance;
    byVendor.set(r.vendor, g);
  }
  [...byVendor.values()]
    .sort((a, b) => b.total - a.total)
    .forEach((g) =>
      vs.addRow({ ...g, total: round2(g.total), paid: round2(g.paid), unpaid: round2(g.unpaid) })
    );
  ["C", "D", "E"].forEach((c) => (vs.getColumn(c).numFmt = money));
  const vt = vs.addRow({
    vendor: "TOTAL",
    count: summary.count,
    total: summary.totalAmount,
    paid: summary.paidAmount,
    unpaid: summary.unpaidAmount,
  });
  vt.font = { bold: true };

  // ---- Filters ----
  const nf = wb.addWorksheet("Report filters");
  nf.columns = [{ width: 24 }, { width: 80 }];
  const q = req.query;
  const kwf = keywordOptions(q);
  let partLabel = "All parts";
  if (partSet.size) {
    const found = await Part.find({ _id: { $in: [...partSet] } }).select("ttUniquePartNumber").lean();
    partLabel = found.map((p) => p.ttUniquePartNumber).join(", ");
  }
  [
    ["Report", "Complete payment trail"],
    ["Status", q.status || "all"],
    ["Date based on", q.dateField === "payment" ? "Payment date" : "Invoice date"],
    ["From", q.from || "Beginning"],
    ["To", q.to || "Today"],
    ["Vendor filter", q.vendor ? "Selected vendor" : "All vendors"],
    ["Payment method", q.method || "Any"],
    ["Amount range", `${q.minAmount || "—"} to ${q.maxAmount || "—"}`],
    ["Keywords", kwf.terms.length ? kwf.terms.join(", ") : "—"],
    ["Keyword match", kwf.terms.length ? (kwf.mode === "any" ? "Any word" : "All words") : "—"],
    ["Keywords looked up in", kwf.terms.length ? kwf.fields.join(", ") : "—"],
    ["Parts", partLabel],
    ["Invoices", summary.count],
    ["How to read", "Payment trail has one row per received line. The invoice amounts and payment details appear on the first row of each invoice only, so the columns can be summed. With parts picked, only those parts' lines are listed (invoice amounts are still for the whole invoice)."],
    ["Generated", `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
  ].forEach((r) => nf.addRow(r));
  nf.getColumn(1).font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="payment-trail-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// POST /api/billing/backfill-amounts — "Retry now" for the PDF amount reader.
export const retryAmountBackfill = asyncHandler(async (req, res) => {
  resumeBackfill();
  res.json({ ok: true, amountsPending: await countNeedingAmount(), backfill: getBackfillStatus() });
});