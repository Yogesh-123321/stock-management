import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import TaxInvoice, { PAYMENT_METHODS, CASH_METHOD } from "../models/TaxInvoice.js";
import Vendor from "../models/Vendor.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
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

const sumAmounts = (rows) => round2(rows.reduce((s, r) => s + invoiceAmount(r), 0));

// GET /api/billing?status=unpaid|paid|all&search=
export const listInvoices = asyncHandler(async (req, res) => {
  const status = String(req.query.status || "unpaid");
  const filter = {};
  if (status === "paid") filter["payment.status"] = "paid";
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

  const [items, unpaid, paid, amountRows, amountsPending] = await Promise.all([
    TaxInvoice.find(filter)
      .select("-extractedLines")
      .populate(POPULATE)
      .sort(status === "paid" ? { "payment.paidAt": -1 } : { createdAt: -1 })
      .limit(500),
    TaxInvoice.countDocuments({ "payment.status": NOT_PAID }),
    TaxInvoice.countDocuments({ "payment.status": "paid" }),
    // Rupee totals per tab (whole collection, not just the 500 rows shown).
    TaxInvoice.aggregate([
      {
        $group: {
          _id: { $cond: [{ $eq: ["$payment.status", "paid"] }, "paid", "unpaid"] },
          total: { $sum: AMOUNT_EXPR },
        },
      },
    ]),
    countNeedingAmount(),
  ]);

  // Invoices with a 0 amount get it read once from their PDF in the background;
  // the page re-loads while amountsPending > 0.
  if (amountsPending > 0) triggerAmountBackfill();

  const amounts = { unpaid: 0, paid: 0, all: 0 };
  for (const r of amountRows) amounts[r._id] = round2(r.total);
  amounts.all = round2(amounts.unpaid + amounts.paid);

  // Total of the rows currently listed (respects the search box).
  const listedTotal = sumAmounts(items);

  res.json({
    items: items.map((i) => ({ ...i.toObject(), amount: invoiceAmount(i), gstTotal: round2(gstOf(i)) })),
    counts: { unpaid, paid, all: unpaid + paid },
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

// PATCH /api/billing/:id/pay   { paymentMethod, utrNumber, paymentDate, remarks }
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

  // Only flips an invoice that is still unpaid, so two people paying at the
  // same moment cannot overwrite each other's UTR.
  const updated = await TaxInvoice.findOneAndUpdate(
    { _id: id, "payment.status": NOT_PAID },
    {
      $set: {
        "payment.status": "paid",
        "payment.method": method,
        "payment.utrNumber": utrNumber,
        "payment.paymentDate": paymentDate,
        "payment.paidAt": new Date(),
        "payment.paidBy": req.user._id,
        "payment.paidByName": req.user.name || req.user.username || "",
        "payment.remarks": remarks,
      },
    },
    { new: true }
  )
    .select("-extractedLines")
    .populate(POPULATE);

  if (!updated) {
    const exists = await TaxInvoice.exists({ _id: id });
    return exists
      ? res.status(409).json({ message: "This invoice has already been marked as paid." })
      : res.status(404).json({ message: "Invoice not found" });
  }

  res.json(updated);
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

// Builds the report from query params:
//   status=all|paid|unpaid  dateField=invoice|payment  from=YYYY-MM-DD  to=YYYY-MM-DD
//   vendor=<id>  method=<payment method>  minAmount  maxAmount  search  groupBy=none|vendor|method|month
async function buildReport(query) {
  const status = ["paid", "unpaid"].includes(query.status) ? query.status : "all";
  const dateField = query.dateField === "payment" ? "payment" : "invoice";
  const groupBy = ["vendor", "method", "month"].includes(query.groupBy) ? query.groupBy : "none";

  const and = [];
  if (status === "paid") and.push({ "payment.status": "paid" });
  if (status === "unpaid") and.push({ "payment.status": NOT_PAID });

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

  const min = query.minAmount !== undefined && query.minAmount !== "" ? Number(query.minAmount) : null;
  const max = query.maxAmount !== undefined && query.maxAmount !== "" ? Number(query.maxAmount) : null;
  if (min !== null && !Number.isNaN(min)) and.push({ $expr: { $gte: [AMOUNT_EXPR, min] } });
  if (max !== null && !Number.isNaN(max)) and.push({ $expr: { $lte: [AMOUNT_EXPR, max] } });

  const q = String(query.search || "").trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    const [vendors, docs] = await Promise.all([
      Vendor.find({ $or: [{ companyName: rx }, { taxRegistrationNo: rx }] }, "_id").lean(),
      PurchaseOrder.find({ documentNumber: rx }, "_id").lean(),
    ]);
    and.push({
      $or: [
        { invoiceNumber: rx },
        { "payment.utrNumber": rx },
        ...(vendors.length ? [{ vendor: { $in: vendors.map((v) => v._id) } }] : []),
        ...(docs.length ? [{ purchaseOrder: { $in: docs.map((d) => d._id) } }] : []),
      ],
    });
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
    const paid = inv.payment?.status === "paid";
    return {
      _id: String(inv._id),
      vendor: inv.vendor?.companyName || "—",
      gstin: inv.vendor?.taxRegistrationNo || "",
      invoiceNumber: inv.invoiceNumber || "",
      invoiceDate: inv.invoiceDate || inv.createdAt,
      poNumber: inv.purchaseOrder?.documentNumber || "",
      status: paid ? "Paid" : "Unpaid",
      taxable: round2(inv.paymentAmount),
      gst: round2(gstOf(inv)),
      freight: round2(inv.freightCharges),
      amount: round2(invoiceAmount(inv)),
      method: paid ? inv.payment?.method || "" : "",
      utr: paid ? inv.payment?.utrNumber || "" : "",
      paymentDate: paid ? inv.payment?.paymentDate || null : null,
      paidBy: paid ? inv.payment?.paidBy?.name || inv.payment?.paidByName || "" : "",
      remarks: paid ? inv.payment?.remarks || "" : "",
    };
  });

  const paidRows = rows.filter((r) => r.status === "Paid");
  const unpaidRows = rows.filter((r) => r.status !== "Paid");
  const sum = (list, key = "amount") => round2(list.reduce((s, r) => s + r[key], 0));

  const summary = {
    count: rows.length,
    totalAmount: sum(rows),
    paidCount: paidRows.length,
    paidAmount: sum(paidRows),
    unpaidCount: unpaidRows.length,
    unpaidAmount: sum(unpaidRows),
    taxable: sum(rows, "taxable"),
    gst: sum(rows, "gst"),
    freight: sum(rows, "freight"),
    truncated: invoices.length >= 5000,
  };

  let groups = [];
  if (groupBy !== "none") {
    const keyOf = (r) => {
      if (groupBy === "vendor") return r.vendor;
      if (groupBy === "method") return r.status === "Paid" ? r.method || "—" : "Unpaid";
      const d = r.invoiceDate ? new Date(r.invoiceDate) : null;
      return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "—";
    };
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const g = map.get(k) || { key: k, count: 0, paidAmount: 0, unpaidAmount: 0, amount: 0 };
      g.count += 1;
      g.amount += r.amount;
      if (r.status === "Paid") g.paidAmount += r.amount;
      else g.unpaidAmount += r.amount;
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

  return { rows, summary, groups, groupBy, filters: { status, dateField, groupBy } };
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
  ["G", "H", "I", "J"].forEach((c) => (ws.getColumn(c).numFmt = money));

  const total = ws.addRow({ vendor: "TOTAL", taxable: summary.taxable, gst: summary.gst, freight: summary.freight, amount: summary.totalAmount });
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
  ss.addRow(["Unpaid", summary.unpaidCount, summary.unpaidAmount]);
  ss.addRow(["Paid", summary.paidCount, summary.paidAmount]);
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


// POST /api/billing/backfill-amounts — "Retry now" for the PDF amount reader.
export const retryAmountBackfill = asyncHandler(async (req, res) => {
  resumeBackfill();
  res.json({ ok: true, amountsPending: await countNeedingAmount(), backfill: getBackfillStatus() });
});