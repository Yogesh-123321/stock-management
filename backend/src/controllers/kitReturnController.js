import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import KitIssue from "../models/KitIssue.js";
import ReceivingSession from "../models/ReceivingSession.js";
import Part from "../models/Part.js";
import StockEntry from "../models/StockEntry.js";
import { bookExistingPart, BookingError } from "../utils/stockBooking.js";
import { allocateReturn, returnedMap, issuedQty, round3 } from "../utils/kitReturn.js";

/*
  Receive material -> "Is this inward stock against an issued kit?"

  The vendor was issued a kit; what comes back is (a) unused parts of that kit
  and (b) new parts that were made from it. Both are booked here as ordinary
  inward lines under the delivery's receiving session, so they show up in the
  Stock entry step, wait for the tax invoice, and go through IQC exactly like
  any other received material. The only extra is the kit link (kitLink on the
  StockEntry), which is what stops a part being returned more than was issued.
*/

const validId = (id) => mongoose.isValidObjectId(id);

// GET /api/kits/returnable?vendor=<id>
// Every issued kit entry for this vendor, with — per part — how much went out,
// how much has already come back, and how much can still be returned.
export const getReturnableKits = asyncHandler(async (req, res) => {
  const vendor = String(req.query.vendor || "");
  if (!validId(vendor)) {
    res.status(400);
    throw new Error("vendor is required");
  }

  const kits = await KitIssue.find({ status: "issued", vendor })
    .populate("lines.part", "ttUniquePartNumber itemDescription unit photoUrl")
    .sort({ createdAt: -1 })
    .lean();

  const returned = await returnedMap(kits.map((k) => k._id));

  const out = kits.map((k) => {
    // A part can appear on more than one line of the same issue — fold them.
    const byPart = new Map();
    for (const l of k.lines || []) {
      if (!l.part || !(l.qtyIssued > 0)) continue;
      const id = String(l.part._id);
      const row =
        byPart.get(id) ||
        {
          part: { _id: l.part._id, ttUniquePartNumber: l.part.ttUniquePartNumber, itemDescription: l.part.itemDescription, unit: l.part.unit, photoUrl: l.part.photoUrl },
          issued: 0,
        };
      row.issued += l.qtyIssued;
      byPart.set(id, row);
    }
    const lines = [...byPart.values()].map((r) => {
      const back = round3(returned.get(`${k._id}|${r.part._id}`) || 0);
      return { ...r, issued: round3(r.issued), returned: back, returnable: Math.max(0, round3(r.issued - back)) };
    });
    return {
      _id: k._id,
      issueCode: k.issueCode,
      kitName: k.kitName,
      kitCode: k.kitCode,
      quantity: k.quantity,
      createdAt: k.createdAt,
      remarks: k.remarks || "",
      lines,
      returnableTotal: round3(lines.reduce((s, l) => s + l.returnable, 0)),
    };
  });

  res.json(out);
});

// POST /api/kits/return-lines
// Body: {
//   receivingSession, kitIssues: [id, ...],
//   returned: [{ part, quantity }],          // unused kit parts coming back
//   produced: [{ part, quantity, unit?, price?, remarks? }]   // new parts made from the kit
// }
// All lines are checked first; nothing is booked if any of them is invalid.
export const bookKitReturn = asyncHandler(async (req, res) => {
  const { receivingSession, kitIssues: kitIds = [], returned = [], produced = [] } = req.body || {};

  if (!validId(receivingSession)) {
    res.status(400);
    throw new Error("receivingSession is required");
  }
  const session = await ReceivingSession.findById(receivingSession);
  if (!session) {
    res.status(404);
    throw new Error("Receiving session not found");
  }
  if (session.status !== "in_progress") {
    res.status(409);
    throw new Error("This delivery is already closed");
  }

  const ids = [...new Set((Array.isArray(kitIds) ? kitIds : []).map(String))];
  if (!ids.length || !ids.every(validId)) {
    res.status(400);
    throw new Error("Select at least one issued kit");
  }
  const kits = await KitIssue.find({ _id: { $in: ids }, status: "issued" }).sort({ createdAt: 1 }).lean();
  if (kits.length !== ids.length) {
    res.status(404);
    throw new Error("One of the selected kits could not be found");
  }
  if (kits.some((k) => String(k.vendor) !== String(session.vendor))) {
    res.status(400);
    throw new Error("The selected kits were not issued to this delivery's vendor");
  }

  const retRows = (Array.isArray(returned) ? returned : []).filter((r) => Number(r?.quantity) > 0);
  const prodRows = (Array.isArray(produced) ? produced : []).filter((r) => Number(r?.quantity) > 0);
  if (!retRows.length && !prodRows.length) {
    res.status(400);
    throw new Error("Enter a returned quantity or add a new part");
  }

  // ---- validate everything before booking anything ----
  const plannedReturns = [];
  const seen = new Set();
  for (const r of retRows) {
    if (!validId(r.part)) {
      res.status(400);
      throw new Error("A returned line has no part");
    }
    if (seen.has(String(r.part))) {
      res.status(400);
      throw new Error("Each returned part can only be listed once — combine the quantities");
    }
    seen.add(String(r.part));
    const qty = round3(r.quantity);
    if (!(qty > 0)) {
      res.status(400);
      throw new Error("Returned quantities must be greater than 0");
    }
    const everIssued = kits.some((k) => issuedQty(k, r.part) > 0);
    if (!everIssued) {
      res.status(400);
      throw new Error("A returned part was not issued in the selected kit(s)");
    }
    let allocations;
    try {
      allocations = await allocateReturn({ partId: r.part, kitIssues: kits, qty });
    } catch (err) {
      const p = await Part.findById(r.part).select("ttUniquePartNumber");
      res.status(err.status || 400);
      throw new Error(`${p?.ttUniquePartNumber || "A part"}: ${err.message}`);
    }
    plannedReturns.push({ part: r.part, quantity: qty, allocations });
  }

  const plannedProduced = [];
  for (const r of prodRows) {
    if (!validId(r.part)) {
      res.status(400);
      throw new Error("A new-part line has no part selected");
    }
    const part = await Part.findById(r.part).select("_id");
    if (!part) {
      res.status(404);
      throw new Error("A new part was not found in the Parts master");
    }
    plannedProduced.push({
      part: r.part,
      quantity: round3(r.quantity),
      unit: String(r.unit || "").trim(),
      price: r.price === "" || r.price == null ? null : Number(r.price),
      remarks: String(r.remarks || "").trim(),
    });
  }

  // ---- book ----
  const label = kits.map((k) => k.issueCode || k.kitName).join(", ");
  const enteredBy = req.user?.name || req.user?.username || "";
  const base = { vendor: session.vendor, purchaseOrder: null, receivingSession: session._id, enteredBy };
  const created = [];

  try {
    for (const r of plannedReturns) {
      const entry = await bookExistingPart({
        ...base,
        quantityReceived: r.quantity,
        remarks: `Returned from ${label}`,
        existingPartId: r.part,
        unit: "",
        price: null,
      });
      entry.kitLink = { kind: "returned", kitIssues: ids, allocations: r.allocations };
      await entry.save();
      created.push(entry);
    }
    for (const r of plannedProduced) {
      const entry = await bookExistingPart({
        ...base,
        quantityReceived: r.quantity,
        remarks: r.remarks ? `New part from ${label} — ${r.remarks}` : `New part from ${label}`,
        existingPartId: r.part,
        unit: r.unit,
        price: r.price,
      });
      entry.kitLink = { kind: "produced", kitIssues: ids, allocations: [] };
      await entry.save();
      created.push(entry);
    }
  } catch (err) {
    // Don't leave half a return booked: undo what this request created.
    await StockEntry.deleteMany({ _id: { $in: created.map((e) => e._id) } }).catch(() => {});
    if (err instanceof BookingError) {
      res.status(err.status || 400);
    }
    throw err;
  }

  session.againstKit = true;
  for (const id of ids) if (!session.kitIssues.some((k) => String(k) === id)) session.kitIssues.push(id);
  session.lastSavedAt = new Date();
  await session.save();

  res.status(201).json({ entries: created, returnedCount: plannedReturns.length, producedCount: plannedProduced.length });
});