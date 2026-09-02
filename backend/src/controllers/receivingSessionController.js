import asyncHandler from "express-async-handler";
import ReceivingSession from "../models/ReceivingSession.js";
import Vendor from "../models/Vendor.js";

const populateAll = (query) =>
  query.populate("vendor").populate("purchaseOrderDoc").populate("proformaInvoiceDoc");

// GET /api/receiving-sessions?status=in_progress&vendor=
export const getReceivingSessions = asyncHandler(async (req, res) => {
  const filter = {};
  filter.status = req.query.status || "in_progress";
  if (req.query.status === "all") delete filter.status;
  if (req.query.vendor) filter.vendor = req.query.vendor;

  const sessions = await populateAll(ReceivingSession.find(filter)).sort({ lastSavedAt: -1 });
  res.json(sessions);
});

// GET /api/receiving-sessions/:id
export const getReceivingSessionById = asyncHandler(async (req, res) => {
  const session = await populateAll(ReceivingSession.findById(req.params.id));
  if (!session) {
    res.status(404);
    throw new Error("Receiving session not found");
  }
  res.json(session);
});

// POST /api/receiving-sessions  (started as soon as a vendor is picked)
export const createReceivingSession = asyncHandler(async (req, res) => {
  const { vendor, currentStep, notes } = req.body;
  if (!vendor) {
    res.status(400);
    throw new Error("vendor is required");
  }

  const vendorDoc = await Vendor.findById(vendor);
  if (!vendorDoc) {
    res.status(400);
    throw new Error("Vendor not found");
  }

  const session = await ReceivingSession.create({
    vendor,
    currentStep: currentStep || 2,
    notes,
    lastSavedAt: new Date(),
  });

  res.status(201).json(await populateAll(ReceivingSession.findById(session._id)));
});

// PUT /api/receiving-sessions/:id  (called after every step, and on "Save & exit")
export const updateReceivingSession = asyncHandler(async (req, res) => {
  const session = await ReceivingSession.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error("Receiving session not found");
  }

  const fields = [
    "purchaseOrderDoc",
    "proformaInvoiceDoc",
    "currentStep",
    "poSkipped",
    "piSkipped",
    "stockEntryDone",
    "taxInvoiceDone",
    "notes",
    "status",
  ];

  fields.forEach((f) => {
    if (req.body[f] !== undefined) session[f] = req.body[f];
  });

  if (session.status === "completed" && !session.completedAt) session.completedAt = new Date();
  if (session.status !== "completed") session.completedAt = null;

  session.lastSavedAt = new Date();
  await session.save();

  res.json(await populateAll(ReceivingSession.findById(session._id)));
});

// DELETE /api/receiving-sessions/:id  (discard a saved, unfinished delivery)
export const deleteReceivingSession = asyncHandler(async (req, res) => {
  const session = await ReceivingSession.findById(req.params.id);
  if (!session) {
    res.status(404);
    throw new Error("Receiving session not found");
  }
  await session.deleteOne();
  res.json({ message: "Receiving session discarded" });
});
