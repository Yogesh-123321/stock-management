import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import PaymentBill, { PAYMENT_MODES } from "../models/PaymentBill.js";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import { notifyApprovers, notifyRequester, notifyUsers } from "../utils/notify.js";

/**
 * Segregation of duties.
 * When ON (default) nobody can approve a bill they uploaded, and the cashier
 * cannot pay a bill they uploaded or approved — the money always passes
 * through at least two different people.
 * Running a one-person setup while testing? Set PAYMENT_SEPARATE_DUTIES=false
 * in backend/.env.
 */
const SEPARATE_DUTIES = process.env.PAYMENT_SEPARATE_DUTIES !== "false";

const LINK = "/payments";
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameUser = (a, b) => Boolean(a && b) && String(a._id || a) === String(b._id || b);
const money = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const STATUS_LABEL = {
  pending_approval: "waiting for approval",
  approved: "approved",
  rejected: "rejected",
  paid: "paid",
};

const POPULATE = [
  { path: "submittedBy", select: "name username" },
  { path: "reviewedBy", select: "name username" },
  { path: "paidBy", select: "name username" },
];

/** Never let a failed notification break the business action. */
const safely = (promise) => Promise.resolve(promise).catch((e) => console.error("notify:", e.message));

/** Active cashiers; falls back to the admins if nobody holds the right yet. */
async function findCashiers() {
  const cashiers = await User.find({
    isActive: true,
    role: "user",
    permissions: "payment.pay",
  }).select("_id");
  if (cashiers.length) return cashiers;
  return User.find({ isActive: true, role: "admin" }).select("_id");
}

/** What the signed-in user may do with a bill — the server is the single source of truth. */
function withFlags(bill, req) {
  const held = req.permissions || [];
  const me = req.user._id;
  const o = bill.toObject ? bill.toObject() : bill;
  o.canApprove =
    o.status === "pending_approval" &&
    held.includes("payment.approve") &&
    !(SEPARATE_DUTIES && sameUser(o.submittedBy, me));
  o.canPay =
    o.status === "approved" &&
    held.includes("payment.pay") &&
    !(SEPARATE_DUTIES && (sameUser(o.submittedBy, me) || sameUser(o.reviewedBy, me)));
  o.canResubmit =
    o.status === "rejected" && held.includes("payment.submit") && sameUser(o.submittedBy, me);
  return o;
}

/**
 * Validates + normalises the bill fields shared by create and resubmit.
 * The payee must be a registered vendor: approved and not marked inactive.
 */
async function readBillFields(input = {}) {
  const vendorId = String(input.vendor || "").trim();
  const billNo = String(input.billNo || "").trim();
  const amount = Number(input.amount);
  const billDate = new Date(input.billDate);

  if (!vendorId || !validId(vendorId)) return { error: "Choose the vendor from the list" };
  const vendor = await Vendor.findById(vendorId).select("companyName status activeStatus");
  if (!vendor) return { error: "That vendor is not registered" };
  if (vendor.status !== "approved")
    return { error: `${vendor.companyName} is not an approved vendor yet, so it cannot be paid.` };
  if (vendor.activeStatus === "inactive")
    return { error: `${vendor.companyName} is marked inactive, so it cannot be paid.` };

  if (!billNo) return { error: "Bill number is required" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a bill amount greater than 0" };
  if (!input.billDate || Number.isNaN(billDate.getTime())) return { error: "Enter a valid bill date" };

  return {
    data: {
      vendor: vendor._id,
      payeeName: vendor.companyName,
      billNo,
      amount: Math.round(amount * 100) / 100,
      billDate,
      category: String(input.category || "").trim(),
      description: String(input.description || "").trim(),
    },
  };
}

/** Same vendor + same bill number (ignoring case/spacing) that is still alive. */
async function findDuplicate({ vendor, payeeName, billNo }, excludeId = null) {
  const q = {
    billNo: new RegExp(`^\\s*${escapeRegex(billNo)}\\s*$`, "i"),
    status: { $ne: "rejected" },
    $or: [
      { vendor },
      // bills saved before vendors were linked are matched by name
      {
        vendor: { $exists: false },
        payeeName: new RegExp(`^\\s*${escapeRegex(payeeName)}\\s*$`, "i"),
      },
    ],
  };
  if (excludeId) q._id = { $ne: excludeId };
  return PaymentBill.findOne(q).select("refNo status");
}

const validId = (id) => mongoose.isValidObjectId(id);

/* ------------------------------------------------------------------ */

// POST /api/payment-bills   (multipart: document + fields)
export const createBill = asyncHandler(async (req, res) => {
  const { data, error } = await readBillFields(req.body);
  if (error) return res.status(400).json({ message: error });
  if (!req.file) return res.status(400).json({ message: "Attach the bill (PDF or image)" });

  const dup = await findDuplicate(data);
  if (dup)
    return res.status(409).json({
      message: `Bill ${data.billNo} from ${data.payeeName} is already on file (${dup.refNo}, ${
        STATUS_LABEL[dup.status]
      }).`,
    });

  const documentUrl = await uploadFileToCloudinary(req.file, { category: "payment-bills" });
  const refNo = await PaymentBill.nextRefNo();

  const bill = await PaymentBill.create({
    ...data,
    refNo,
    documentUrl,
    documentName: req.file.originalname || "",
    submittedBy: req.user._id,
    history: [{ action: "submitted", by: req.user._id, byName: req.user.name }],
  });

  await safely(
    notifyApprovers({
      actorId: req.user._id,
      title: "Payment bill awaiting approval",
      message: `${req.user.name} uploaded bill ${bill.billNo} from ${bill.payeeName} for ₹${money(
        bill.amount
      )}.`,
      link: LINK,
      entityType: "other",
      entityId: bill._id,
    })
  );

  await bill.populate(POPULATE);
  res.status(201).json(withFlags(bill, req));
});

// GET /api/payment-bills?status=approved,paid&search=
export const listBills = asyncHandler(async (req, res) => {
  const held = req.permissions || [];
  // Admins and cashiers work the whole queue; everyone else sees only their own uploads.
  const seeAll = req.user.role === "admin" || held.includes("payment.pay");
  const base = seeAll ? {} : { submittedBy: req.user._id };

  const filter = { ...base };
  const status = String(req.query.status || "all");
  if (status !== "all") {
    const list = status.split(",").map((s) => s.trim()).filter(Boolean);
    filter.status = list.length > 1 ? { $in: list } : list[0];
  }
  const q = String(req.query.search || "").trim();
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ refNo: rx }, { payeeName: rx }, { billNo: rx }, { transactionId: rx }];
  }

  const [items, grouped] = await Promise.all([
    PaymentBill.find(filter).sort({ createdAt: -1 }).limit(300).populate(POPULATE),
    PaymentBill.aggregate([
      { $match: base },
      { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
  ]);

  const counts = { pending_approval: 0, approved: 0, rejected: 0, paid: 0, all: 0 };
  const amounts = { pending_approval: 0, approved: 0, rejected: 0, paid: 0 };
  grouped.forEach((g) => {
    counts[g._id] = g.count;
    amounts[g._id] = g.amount;
    counts.all += g.count;
  });

  res.json({ items: items.map((b) => withFlags(b, req)), counts, amounts });
});

// GET /api/payment-bills/pending-count — what is waiting on *me* (sidebar badge)
export const pendingCount = asyncHandler(async (req, res) => {
  const held = req.permissions || [];
  let count = 0;
  if (req.user.role === "admin") count = await PaymentBill.countDocuments({ status: "pending_approval" });
  else if (held.includes("payment.pay")) count = await PaymentBill.countDocuments({ status: "approved" });
  res.json({ count });
});

// PATCH /api/payment-bills/:id/approve   { remarks }
export const approveBill = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid bill id" });
  const bill = await PaymentBill.findById(req.params.id);
  if (!bill) return res.status(404).json({ message: "Bill not found" });
  if (bill.status !== "pending_approval")
    return res.status(409).json({ message: `This bill is already ${STATUS_LABEL[bill.status]}.` });
  if (SEPARATE_DUTIES && sameUser(bill.submittedBy, req.user._id))
    return res
      .status(403)
      .json({ message: "You uploaded this bill, so another admin has to approve it." });

  const remarks = String(req.body?.remarks || "").trim();
  const updated = await PaymentBill.findOneAndUpdate(
    { _id: bill._id, status: "pending_approval" },
    {
      $set: {
        status: "approved",
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        reviewRemarks: remarks,
      },
      $push: { history: { action: "approved", by: req.user._id, byName: req.user.name, remarks } },
    },
    { new: true }
  ).populate(POPULATE);
  if (!updated) return res.status(409).json({ message: "Someone else just decided on this bill." });

  const payload = { link: LINK, entityType: "other", entityId: updated._id, actor: req.user._id };
  if (!sameUser(updated.submittedBy, req.user._id)) {
    await safely(
      notifyRequester({
        recipientId: updated.submittedBy._id,
        approved: true,
        actorId: req.user._id,
        title: "Payment bill approved",
        message: `${updated.refNo} (${updated.payeeName}, ₹${money(updated.amount)}) was approved and sent to the cashier.`,
        link: LINK,
        entityType: "other",
        entityId: updated._id,
      })
    );
  }
  const cashiers = (await findCashiers()).filter((c) => !sameUser(c._id, req.user._id));
  await safely(
    notifyUsers(cashiers, {
      ...payload,
      type: "info",
      title: "Bill ready for payment",
      message: `${updated.refNo}: pay ₹${money(updated.amount)} to ${updated.payeeName}, then enter the transaction ID.`,
    })
  );

  res.json(withFlags(updated, req));
});

// PATCH /api/payment-bills/:id/reject   { remarks }  — a reason is mandatory
export const rejectBill = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid bill id" });
  const remarks = String(req.body?.remarks || "").trim();
  if (!remarks) return res.status(400).json({ message: "Write a reason for rejecting this bill." });

  const bill = await PaymentBill.findById(req.params.id);
  if (!bill) return res.status(404).json({ message: "Bill not found" });
  if (bill.status !== "pending_approval")
    return res.status(409).json({ message: `This bill is already ${STATUS_LABEL[bill.status]}.` });

  const updated = await PaymentBill.findOneAndUpdate(
    { _id: bill._id, status: "pending_approval" },
    {
      $set: {
        status: "rejected",
        reviewedBy: req.user._id,
        reviewedAt: new Date(),
        reviewRemarks: remarks,
      },
      $push: { history: { action: "rejected", by: req.user._id, byName: req.user.name, remarks } },
    },
    { new: true }
  ).populate(POPULATE);
  if (!updated) return res.status(409).json({ message: "Someone else just decided on this bill." });

  if (!sameUser(updated.submittedBy, req.user._id)) {
    await safely(
      notifyRequester({
        recipientId: updated.submittedBy._id,
        approved: false,
        actorId: req.user._id,
        title: "Payment bill rejected",
        message: `${updated.refNo} (${updated.payeeName}) was rejected: ${remarks}`,
        link: LINK,
        entityType: "other",
        entityId: updated._id,
      })
    );
  }

  res.json(withFlags(updated, req));
});

// PATCH /api/payment-bills/:id/pay   { transactionId, paymentDate, paymentMode, paymentRemarks }
export const payBill = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid bill id" });

  const transactionId = String(req.body?.transactionId || "").trim();
  if (!transactionId) return res.status(400).json({ message: "Enter the transaction ID." });

  const paymentMode = String(req.body?.paymentMode || "Other").trim();
  if (!PAYMENT_MODES.includes(paymentMode))
    return res.status(400).json({ message: "Choose a valid payment mode." });

  const paymentDate = req.body?.paymentDate ? new Date(req.body.paymentDate) : new Date();
  if (Number.isNaN(paymentDate.getTime()))
    return res.status(400).json({ message: "Enter a valid payment date." });
  if (paymentDate.getTime() > Date.now() + 24 * 60 * 60 * 1000)
    return res.status(400).json({ message: "Payment date cannot be in the future." });

  const bill = await PaymentBill.findById(req.params.id);
  if (!bill) return res.status(404).json({ message: "Bill not found" });
  if (bill.status !== "approved")
    return res.status(409).json({
      message:
        bill.status === "paid"
          ? "This bill has already been paid and closed."
          : "This bill has not been approved yet.",
    });
  if (SEPARATE_DUTIES && (sameUser(bill.submittedBy, req.user._id) || sameUser(bill.reviewedBy, req.user._id)))
    return res
      .status(403)
      .json({ message: "You uploaded or approved this bill, so another cashier has to pay it." });

  const paymentRemarks = String(req.body?.paymentRemarks || "").trim();
  const updated = await PaymentBill.findOneAndUpdate(
    { _id: bill._id, status: "approved" },
    {
      $set: {
        status: "paid",
        paidBy: req.user._id,
        paidAt: new Date(),
        paymentDate,
        transactionId,
        paymentMode,
        paymentRemarks,
      },
      $push: {
        history: {
          action: "paid",
          by: req.user._id,
          byName: req.user.name,
          remarks: `${paymentMode} · ${transactionId}${paymentRemarks ? ` — ${paymentRemarks}` : ""}`,
        },
      },
    },
    { new: true }
  ).populate(POPULATE);
  if (!updated) return res.status(409).json({ message: "Someone else just paid this bill." });

  // Tell the uploader and the approving admin that the entry is closed.
  const recipients = [updated.submittedBy?._id, updated.reviewedBy?._id].filter(
    (id) => id && !sameUser(id, req.user._id)
  );
  await safely(
    notifyUsers(recipients, {
      type: "info",
      title: "Payment made",
      message: `${updated.refNo} (${updated.payeeName}, ₹${money(updated.amount)}) was paid — transaction ID ${transactionId}.`,
      link: LINK,
      entityType: "other",
      entityId: updated._id,
      actor: req.user._id,
    })
  );

  res.json(withFlags(updated, req));
});

// PATCH /api/payment-bills/:id/resubmit   (multipart; every field optional)
// The uploader fixes a rejected bill and sends it back for approval.
export const resubmitBill = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid bill id" });
  const bill = await PaymentBill.findById(req.params.id);
  if (!bill) return res.status(404).json({ message: "Bill not found" });
  if (!sameUser(bill.submittedBy, req.user._id))
    return res.status(403).json({ message: "Only the person who uploaded this bill can resubmit it." });
  if (bill.status !== "rejected")
    return res.status(409).json({ message: "Only a rejected bill can be resubmitted." });

  const body = req.body || {};
  const { data, error } = await readBillFields({
    vendor: body.vendor ?? bill.vendor,
    billNo: body.billNo ?? bill.billNo,
    amount: body.amount ?? bill.amount,
    billDate: body.billDate ?? bill.billDate,
    category: body.category ?? bill.category,
    description: body.description ?? bill.description,
  });
  if (error) return res.status(400).json({ message: error });

  const dup = await findDuplicate(data, bill._id);
  if (dup)
    return res.status(409).json({
      message: `Bill ${data.billNo} from ${data.payeeName} is already on file (${dup.refNo}, ${
        STATUS_LABEL[dup.status]
      }).`,
    });

  Object.assign(bill, data);
  if (req.file) {
    bill.documentUrl = await uploadFileToCloudinary(req.file, { category: "payment-bills" });
    bill.documentName = req.file.originalname || "";
  }
  bill.status = "pending_approval";
  bill.reviewedBy = null;
  bill.reviewedAt = null;
  bill.reviewRemarks = "";
  bill.history.push({
    action: "resubmitted",
    by: req.user._id,
    byName: req.user.name,
    remarks: String(body.resubmitRemarks || "").trim(),
  });
  await bill.save();

  await safely(
    notifyApprovers({
      actorId: req.user._id,
      title: "Payment bill resubmitted",
      message: `${req.user.name} corrected and resubmitted ${bill.refNo} (${bill.payeeName}, ₹${money(bill.amount)}).`,
      link: LINK,
      entityType: "other",
      entityId: bill._id,
    })
  );

  await bill.populate(POPULATE);
  res.json(withFlags(bill, req));
});