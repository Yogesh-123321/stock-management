import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import TaxInvoice, { PAYMENT_METHODS, CASH_METHOD } from "../models/TaxInvoice.js";
import Vendor from "../models/Vendor.js";
import PurchaseOrder from "../models/PurchaseOrder.js";

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

  const [items, unpaid, paid] = await Promise.all([
    TaxInvoice.find(filter)
      .select("-extractedLines")
      .populate(POPULATE)
      .sort(status === "paid" ? { "payment.paidAt": -1 } : { createdAt: -1 })
      .limit(500),
    TaxInvoice.countDocuments({ "payment.status": NOT_PAID }),
    TaxInvoice.countDocuments({ "payment.status": "paid" }),
  ]);

  res.json({ items, counts: { unpaid, paid, all: unpaid + paid }, paymentMethods: PAYMENT_METHODS });
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