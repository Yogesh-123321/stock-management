import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SampleIssue, { nextSampleIssueCode } from "../models/SampleIssue.js";
import Part from "../models/Part.js";
import Buyer from "../models/Buyer.js";
import { uploadFileToCloudinary } from "../config/cloudinary.js";
import { sampleHoldersByPart } from "../utils/sampleHolders.js";

/*
  Issued samples
  --------------
  Issuing samples to a buyer moves quantity from Part.quantityInStock (main
  stock) into Part.sampleStock. Kits only ever draw on quantityInStock, so
  sample stock can never be issued in a kit. Receiving samples back moves it
  the other way. Every unit is always in exactly one of the two buckets, so
  total stock is unchanged by either action.

  Stock is moved with atomic conditional updates (never read-modify-write), and
  anything already moved is rolled back if a later step fails — so a half-done
  issue can't leave stock stranded in sampleStock.
*/

const EPS = 0.0005;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const validId = (id) => mongoose.isValidObjectId(id);
const actor = (req) => req.user?.name || req.user?.username || "";

const parseJson = (value, fallback) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const populateIssue = (q) =>
  q.populate("buyer", "companyName contactPersonName phone email").populate("lines.part", "photoUrl");

const statusFor = (lines) => {
  const outstanding = lines.reduce((s, l) => s + (l.qtyOutstanding || 0), 0);
  const returned = lines.reduce((s, l) => s + (l.qtyReturned || 0), 0);
  if (outstanding <= EPS) return "returned";
  return returned > EPS ? "partially_returned" : "issued";
};

const uploadDocs = async (files, uploader, party, category) => {
  const out = [];
  for (const file of files || []) {
    const url = await uploadFileToCloudinary(file, { party, kind: "buyer", category });
    out.push({ url, fileName: file.originalname || "", uploadedBy: uploader });
  }
  return out;
};

/* Moves qty main -> sample for one part; false when main stock is too low. */
const takeFromMain = async (partId, qty) => {
  const res = await Part.updateOne(
    { _id: partId, quantityInStock: { $gte: qty - EPS } },
    { $inc: { quantityInStock: -qty, sampleStock: qty } }
  );
  if (res.modifiedCount !== 1) return false;
  // Float dust guard: never leave main stock a hair below zero.
  await Part.updateOne({ _id: partId, quantityInStock: { $lt: 0 } }, { $set: { quantityInStock: 0 } });
  return true;
};

/* Moves qty sample -> main for one part; false when sampleStock is too low. */
const giveBackToMain = async (partId, qty) => {
  const res = await Part.updateOne(
    { _id: partId, sampleStock: { $gte: qty - EPS } },
    { $inc: { sampleStock: -qty, quantityInStock: qty } }
  );
  if (res.modifiedCount !== 1) return false;
  await Part.updateOne({ _id: partId, sampleStock: { $lt: 0 } }, { $set: { sampleStock: 0 } });
  return true;
};

// POST /api/samples   (multipart/form-data)
// Fields: buyer, challanNumber?, remarks?, lines (JSON: [{ part, quantity }]),
//         challans (1..10 files — required)
export const issueSamples = asyncHandler(async (req, res) => {
  const { buyer: buyerId, challanNumber, remarks } = req.body;
  const files = req.files || [];

  if (!validId(buyerId)) {
    res.status(400);
    throw new Error("Select the buyer these samples are being issued to");
  }
  const buyer = await Buyer.findById(buyerId);
  if (!buyer) {
    res.status(404);
    throw new Error("Buyer not found");
  }
  if (buyer.status !== "approved") {
    res.status(400);
    throw new Error("Samples can only be issued to an approved buyer");
  }
  if (!files.length) {
    res.status(400);
    throw new Error("Upload the challan for these samples");
  }

  // Merge duplicate parts so the same part twice becomes one line.
  const merged = new Map();
  for (const row of parseJson(req.body.lines, [])) {
    const qty = r3(row?.quantity);
    if (!validId(row?.part)) {
      res.status(400);
      throw new Error("Every line needs a valid part");
    }
    if (!(qty > 0)) {
      res.status(400);
      throw new Error("Every line needs a quantity greater than zero");
    }
    merged.set(String(row.part), r3((merged.get(String(row.part)) || 0) + qty));
  }
  if (!merged.size) {
    res.status(400);
    throw new Error("Add at least one part to issue as a sample");
  }

  const parts = await Part.find({ _id: { $in: [...merged.keys()] } });
  const partById = new Map(parts.map((p) => [String(p._id), p]));
  const shortages = [];
  for (const [id, qty] of merged) {
    const p = partById.get(id);
    if (!p) {
      res.status(404);
      throw new Error("One of the selected parts was not found");
    }
    if (qty > (p.quantityInStock || 0) + EPS) {
      shortages.push(`${p.ttUniquePartNumber}: need ${qty}, only ${r3(p.quantityInStock || 0)} in main stock`);
    }
  }
  if (shortages.length) {
    res.status(400);
    throw new Error(`Not enough main stock — ${shortages.join("; ")}`);
  }

  // Upload the challans BEFORE touching stock, so a failed upload costs nothing.
  const by = actor(req);
  let challans;
  try {
    challans = await uploadDocs(files, by, buyer, "sample-challans");
  } catch (err) {
    res.status(502);
    throw new Error(`Could not upload the challan: ${err.message}`);
  }

  // Move stock, remembering what moved so it can be undone.
  const moved = [];
  try {
    for (const [id, qty] of merged) {
      const ok = await takeFromMain(id, qty);
      if (!ok) {
        const p = await Part.findById(id).select("ttUniquePartNumber quantityInStock");
        throw Object.assign(
          new Error(
            `Not enough main stock for ${p?.ttUniquePartNumber || "a part"} (only ${r3(p?.quantityInStock || 0)} left)`
          ),
          { status: 400 }
        );
      }
      moved.push([id, qty]);
    }

    const issue = await SampleIssue.create({
      issueCode: await nextSampleIssueCode(),
      buyer: buyer._id,
      buyerName: buyer.companyName,
      challanNumber: String(challanNumber || "").trim(),
      challans,
      remarks: String(remarks || "").trim(),
      issuedBy: by,
      issuedByUser: req.user?._id || null,
      lines: [...merged].map(([id, qty]) => {
        const p = partById.get(id);
        return {
          part: p._id,
          ttUniquePartNumber: p.ttUniquePartNumber,
          itemDescription: p.itemDescription,
          unit: p.unit || "",
          qtyIssued: qty,
          qtyReturned: 0,
          qtyOutstanding: qty,
        };
      }),
    });

    res.status(201).json(await populateIssue(SampleIssue.findById(issue._id)).lean());
  } catch (err) {
    for (const [id, qty] of moved) await giveBackToMain(id, qty).catch(() => {});
    res.status(err.status || 500);
    throw err;
  }
});

// GET /api/samples?status=outstanding|returned|all&buyer=&search=
export const getSampleIssues = asyncHandler(async (req, res) => {
  const { status = "all", buyer, search } = req.query;
  const filter = {};
  if (status === "outstanding") filter.status = { $in: ["issued", "partially_returned"] };
  else if (["issued", "partially_returned", "returned"].includes(status)) filter.status = status;
  if (buyer && validId(buyer)) filter.buyer = buyer;
  if (search && String(search).trim()) {
    const rx = { $regex: String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [
      { issueCode: rx },
      { buyerName: rx },
      { challanNumber: rx },
      { "lines.ttUniquePartNumber": rx },
      { "lines.itemDescription": rx },
    ];
  }
  const issues = await SampleIssue.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.json(
    issues.map((i) => ({
      ...i,
      totalIssued: r3(i.lines.reduce((s, l) => s + l.qtyIssued, 0)),
      totalOutstanding: r3(i.lines.reduce((s, l) => s + l.qtyOutstanding, 0)),
    }))
  );
});

// GET /api/samples/:id
export const getSampleIssueById = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) {
    res.status(404);
    throw new Error("Sample issue not found");
  }
  const issue = await populateIssue(SampleIssue.findById(req.params.id)).lean();
  if (!issue) {
    res.status(404);
    throw new Error("Sample issue not found");
  }
  res.json(issue);
});

// GET /api/samples/stock?search=
// Part-wise sample stock: how much of each part is out as samples, and with whom.
export const getSampleStock = asyncHandler(async (req, res) => {
  const holders = await sampleHoldersByPart();
  const partIds = [...holders.keys()];
  const parts = partIds.length
    ? await Part.find({ _id: { $in: partIds } })
        .select("ttUniquePartNumber itemDescription unit quantityInStock sampleStock photoUrl")
        .sort({ ttUniquePartNumber: 1 })
        .lean()
    : [];
  const term = String(req.query.search || "").trim().toLowerCase();
  const rows = parts
    .map((p) => {
      const list = holders.get(String(p._id)) || [];
      return {
        part: p,
        mainStock: p.quantityInStock || 0,
        sampleStock: r3(list.reduce((s, h) => s + h.quantity, 0)),
        holders: list,
      };
    })
    .filter(
      (r) =>
        !term ||
        `${r.part.ttUniquePartNumber} ${r.part.itemDescription}`.toLowerCase().includes(term) ||
        r.holders.some((h) => (h.buyerName || "").toLowerCase().includes(term))
    );
  res.json(rows);
});

// POST /api/samples/:id/return   (multipart/form-data)
// Fields: lines (JSON: [{ line, quantity }]), remarks?, documents? (0..10 files)
// Puts the returned units back into main stock.
export const receiveSamplesBack = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) {
    res.status(404);
    throw new Error("Sample issue not found");
  }
  const issue = await SampleIssue.findById(id);
  if (!issue) {
    res.status(404);
    throw new Error("Sample issue not found");
  }

  const requested = new Map(); // lineId -> qty
  for (const row of parseJson(req.body.lines, [])) {
    const qty = r3(row?.quantity);
    if (!(qty > 0)) continue; // a blank / zero line just means "not returned"
    if (!validId(row?.line)) {
      res.status(400);
      throw new Error("Invalid line in the return");
    }
    requested.set(String(row.line), r3((requested.get(String(row.line)) || 0) + qty));
  }
  if (!requested.size) {
    res.status(400);
    throw new Error("Enter the quantity received back for at least one part");
  }

  const toApply = [];
  for (const [lineId, qty] of requested) {
    const line = issue.lines.id(lineId);
    if (!line) {
      res.status(400);
      throw new Error("A selected line does not belong to this sample issue");
    }
    if (qty > line.qtyOutstanding + EPS) {
      res.status(400);
      throw new Error(
        `${line.ttUniquePartNumber}: only ${r3(line.qtyOutstanding)} still out with the buyer — cannot take back ${qty}`
      );
    }
    toApply.push({ line, qty });
  }

  const by = actor(req);
  let documents = [];
  try {
    const buyer = await Buyer.findById(issue.buyer).select("companyName taxRegistrationNo");
    documents = await uploadDocs(req.files || [], by, buyer || { companyName: issue.buyerName }, "sample-returns");
  } catch (err) {
    res.status(502);
    throw new Error(`Could not upload the return document: ${err.message}`);
  }

  // Each step: (1) claim the units on the issue line atomically, (2) move them
  // sample -> main. If (2) fails, release the claim again. Anything already
  // completed in this request is undone if a later line fails.
  const done = [];
  try {
    for (const { line, qty } of toApply) {
      const claimed = await SampleIssue.updateOne(
        { _id: issue._id, lines: { $elemMatch: { _id: line._id, qtyOutstanding: { $gte: qty - EPS } } } },
        { $inc: { "lines.$.qtyOutstanding": -qty, "lines.$.qtyReturned": qty } }
      );
      if (claimed.modifiedCount !== 1) {
        throw Object.assign(
          new Error(`${line.ttUniquePartNumber}: these samples were already received back — refresh and try again`),
          { status: 409 }
        );
      }
      const moved = await giveBackToMain(line.part, qty);
      if (!moved) {
        await SampleIssue.updateOne(
          { _id: issue._id, "lines._id": line._id },
          { $inc: { "lines.$.qtyOutstanding": qty, "lines.$.qtyReturned": -qty } }
        );
        throw Object.assign(
          new Error(`${line.ttUniquePartNumber}: sample stock is lower than expected — contact an admin`),
          { status: 409 }
        );
      }
      done.push({ line, qty });
    }
  } catch (err) {
    for (const { line, qty } of done) {
      await takeFromMain(line.part, qty).catch(() => {});
      await SampleIssue.updateOne(
        { _id: issue._id, "lines._id": line._id },
        { $inc: { "lines.$.qtyOutstanding": qty, "lines.$.qtyReturned": -qty } }
      ).catch(() => {});
    }
    res.status(err.status || 500);
    throw err;
  }

  // Record the return event, tidy rounding and refresh the status.
  const fresh = await SampleIssue.findById(issue._id);
  for (const l of fresh.lines) {
    l.qtyOutstanding = Math.max(0, r3(l.qtyOutstanding));
    l.qtyReturned = r3(l.qtyReturned);
  }
  fresh.returns.push({
    at: new Date(),
    by,
    byUser: req.user?._id || null,
    remarks: String(req.body.remarks || "").trim(),
    documents,
    lines: done.map(({ line, qty }) => ({
      line: line._id,
      part: line.part,
      ttUniquePartNumber: line.ttUniquePartNumber,
      quantity: qty,
    })),
  });
  fresh.status = statusFor(fresh.lines);
  fresh.returnedAt = fresh.status === "returned" ? new Date() : null;
  await fresh.save();

  res.json(await populateIssue(SampleIssue.findById(fresh._id)).lean());
});