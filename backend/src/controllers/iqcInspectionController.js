import asyncHandler from "express-async-handler";
import StockEntry from "../models/StockEntry.js";
import IqcTemplate from "../models/IqcTemplate.js";
import Part from "../models/Part.js";

const populateEntry = (query) =>
  query.populate([
    { path: "part", populate: { path: "vendors", select: "companyName" } },
    { path: "vendor" },
    { path: "purchaseOrder" },
    // The tax invoice this line arrived under — lets the IQC stock window
    // group material invoice-wise and search by invoice number.
    { path: "appliedVia", select: "invoiceNumber invoiceDate documentUrl originalFileName" },
  ]);

/*
  GET /api/stock-entries/iqc-stock?status=in_iqc_stock|rejected|accepted&receivingSession=

  Lines that have been through, or are waiting on, IQC — material that has
  cleared the tax invoice step:
    - "in_iqc_stock" (default) — awaiting an IQC report, not yet credited to
      the part's main quantityInStock
    - "rejected"     — an IQC report was filled and the stock was rejected;
      it stays here and never reaches the main stock
    - "accepted"     — an IQC report was filled and the stock was accepted
      into main stock (the latest 300, newest inspection first)

  Powers the IQC stock window on the Parts master (MISC stock -> IQC stock).
  Open to every signed-in user: IQC is done by whoever is asked to inspect
  the material, and the inspector is recorded on the line (see below).
*/
export const getIqcStockEntries = asyncHandler(async (req, res) => {
  const status = ["in_iqc_stock", "rejected", "accepted"].includes(req.query.status)
    ? req.query.status
    : "in_iqc_stock";

  const filter = { iqcStatus: status };
  if (req.query.receivingSession) filter.receivingSession = req.query.receivingSession;

  let query = populateEntry(StockEntry.find(filter));
  if (status === "in_iqc_stock") {
    query = query.sort({ appliedAt: -1, createdAt: -1 });
  } else {
    // Already-inspected lines: newest inspection first.
    query = query.sort({ "iqcReport.inspectedAt": -1, createdAt: -1 });
    if (status === "accepted") query = query.limit(300);
  }

  const entries = await query;
  res.json(entries);
});

/*
  POST /api/stock-entries/:id/iqc-report
  Body:
    templateId       - optional IqcTemplate id the checklist was copied from
    items            - [{ name, specification, unit, checked }], the checklist
                       as filled in — every item must be checked
    acceptedQuantity - how much of the received quantity the inspector
                       approves (0 .. quantityReceived). Everything not
                       approved is rejected.
    rejectionReason  - required whenever any quantity is rejected
    corrections      - optional { partId, quantityReceived, unit, price,
                       remarks }: the inspector's corrections to the stock
                       entry itself. Only the keys sent are changed. They are
                       applied BEFORE anything is credited, so the final
                       stock entry (part, quantity, unit, rate) is what the
                       IQC decided; the original values are kept on
                       iqcReport.corrections.original
    decision         - legacy: "accepted" (= approve all) | "rejected"
                       (= approve none), used only if acceptedQuantity is
                       not sent

  Who ran the inspection is not sent by the client — it is recorded from the
  signed-in user (name + user id + time) on the line's iqcReport, so every
  line shows which person did its IQC.

  Resolves one line currently sitting in IQC stock (iqcStatus:
  "in_iqc_stock"):
    - approve everything  -> the line is accepted; its quantity is credited
                             to Part.quantityInStock
    - approve nothing     -> the line moves to rejected stock
    - approve part of it  -> the line is split: the existing line keeps the
                             approved quantity (accepted, credited to
                             Part.quantityInStock) and a new line holding the
                             rejected remainder goes to rejected stock. The
                             two quantities always add back up to what was
                             received, so PO / tax invoice totals still tally.
*/
export const submitIqcReport = asyncHandler(async (req, res) => {
  const { templateId, items, decision, acceptedQuantity, rejectionReason } = req.body;

  const entry = await StockEntry.findById(req.params.id).populate("part");
  if (!entry) {
    res.status(404);
    throw new Error("Stock entry not found");
  }
  if (entry.iqcStatus !== "in_iqc_stock") {
    res.status(400);
    throw new Error("This line isn't waiting on an IQC report");
  }

  const cleanItems = (Array.isArray(items) ? items : [])
    .map((it) => ({
      name: String(it?.name || "").trim(),
      specification: String(it?.specification || "").trim(),
      unit: String(it?.unit || "").trim(),
      checked: !!it?.checked,
    }))
    .filter((it) => it.name);

  if (cleanItems.length === 0) {
    res.status(400);
    throw new Error("At least one IQC point is required");
  }
  if (!cleanItems.every((it) => it.checked)) {
    res.status(400);
    throw new Error("Every point on the IQC report must be checked before it can be submitted");
  }
  // How much of the delivered quantity is approved. Quantities can be
  // decimal (metres, kg), so work to 3 places like the StockEntry model.
  const round3 = (n) => Math.round(n * 1000) / 1000;

  // ---- Inspector's corrections to the stock entry itself ----------------
  // Applied in memory first; nothing is saved until the decision below goes
  // through, so a failed submit leaves the line exactly as it was.
  const corr = req.body.corrections && typeof req.body.corrections === "object" ? req.body.corrections : null;
  const has = (k) => !!corr && Object.prototype.hasOwnProperty.call(corr, k);
  const originalValues = {
    part: entry.part?._id || entry.part || null,
    partNumber: entry.part?.ttUniquePartNumber || "",
    quantityReceived: entry.quantityReceived,
    unit: entry.unit || "",
    price: entry.price ?? null,
    remarks: entry.remarks || "",
  };
  const changedFields = [];
  let correctedPartId = null;

  if (has("partId") && corr.partId && String(corr.partId) !== String(originalValues.part)) {
    const newPart = await Part.findById(corr.partId);
    if (!newPart) {
      res.status(400);
      throw new Error("The part you chose isn't in the part master");
    }
    entry.part = newPart._id;
    // The inspector has confirmed this existing part, so the line is no
    // longer a new / alternate part booking.
    entry.matchType = "existing_part_number";
    entry.alternateOfPart = null;
    correctedPartId = newPart._id;
    changedFields.push("part");
  }
  if (has("quantityReceived")) {
    const q = round3(Number(corr.quantityReceived));
    if (!Number.isFinite(q) || q <= 0) {
      res.status(400);
      throw new Error("Received quantity must be greater than 0");
    }
    if (q !== round3(Number(entry.quantityReceived) || 0)) {
      entry.quantityReceived = q;
      changedFields.push("quantity");
    }
  }
  if (has("unit")) {
    const u = String(corr.unit || "").trim();
    if (u !== (entry.unit || "")) {
      entry.unit = u;
      changedFields.push("unit");
    }
  }
  if (has("price")) {
    let pr = null;
    if (corr.price !== null && corr.price !== undefined && corr.price !== "") {
      pr = Number(corr.price);
      if (!Number.isFinite(pr) || pr < 0) {
        res.status(400);
        throw new Error("Rate must be a number, 0 or more");
      }
    }
    if (pr !== (entry.price ?? null)) {
      entry.price = pr;
      changedFields.push("price");
    }
  }
  if (has("remarks")) {
    const r = String(corr.remarks || "").trim();
    if (r !== (entry.remarks || "")) {
      entry.remarks = r;
      changedFields.push("remarks");
    }
  }

  // From here on `total` is the quantity AFTER any correction.
  const total = round3(Number(entry.quantityReceived) || 0);

  let acceptedQty;
  if (acceptedQuantity !== undefined && acceptedQuantity !== null && acceptedQuantity !== "") {
    acceptedQty = round3(Number(acceptedQuantity));
    if (!Number.isFinite(acceptedQty) || acceptedQty < 0 || acceptedQty > total) {
      res.status(400);
      throw new Error(`Approved quantity must be between 0 and ${total}`);
    }
  } else if (decision === "accepted") {
    acceptedQty = total;
  } else if (decision === "rejected") {
    acceptedQty = 0;
  } else {
    res.status(400);
    throw new Error("Enter the quantity being approved");
  }

  const rejectedQty = round3(total - acceptedQty);
  const reason = String(rejectionReason || "").trim();
  if (rejectedQty > 0 && !reason) {
    res.status(400);
    throw new Error("Give a reason for rejecting the quantity that isn't approved");
  }

  let template = null;
  if (templateId) {
    template = await IqcTemplate.findById(templateId);
  }

  const report = {
    template: template ? template._id : null,
    materialName: template ? template.materialName : "",
    items: cleanItems,
    inspectedBy: req.user?.name || "",
    inspectedByUser: req.user?._id || null,
    inspectedAt: new Date(),
    originalQuantity: total,
    acceptedQuantity: acceptedQty,
    rejectedQuantity: rejectedQty,
    rejectionReason: rejectedQty > 0 ? reason : "",
    corrections: { changed: changedFields, original: changedFields.length > 0 ? originalValues : {} },
  };

  const partId = correctedPartId || entry.part?._id || entry.part;

  if (acceptedQty === 0) {
    // Nothing approved -> the whole line is rejected stock.
    entry.iqcReport = { ...report, decision: "rejected" };
    entry.iqcStatus = "rejected";
    entry.stockApplied = false;
    await entry.save();
  } else {
    // Some or all approved. For a partial approval, first park the
    // rejected remainder as its own line so nothing is lost if a later
    // step fails.
    let rejectedLine = null;
    if (rejectedQty > 0) {
      const clone = entry.toObject();
      delete clone._id;
      delete clone.__v;
      delete clone.updatedAt;
      clone.part = partId;
      clone.quantityReceived = rejectedQty;
      clone.iqcReport = { ...report, decision: "rejected" };
      clone.iqcStatus = "rejected";
      clone.stockApplied = false;
      clone.appliedAt = null;
      rejectedLine = await StockEntry.create(clone);
    }

    try {
      if (partId) {
        await Part.findByIdAndUpdate(partId, { $inc: { quantityInStock: acceptedQty } });
      }
      entry.quantityReceived = acceptedQty;
      entry.iqcReport = { ...report, decision: "accepted" };
      entry.iqcStatus = "accepted";
      entry.stockApplied = true;
      entry.appliedAt = new Date();
      await entry.save();
    } catch (err) {
      // Undo the side effects so the line stays in IQC stock, untouched.
      if (partId) {
        await Part.findByIdAndUpdate(partId, { $inc: { quantityInStock: -acceptedQty } }).catch(() => {});
      }
      if (rejectedLine) await StockEntry.findByIdAndDelete(rejectedLine._id).catch(() => {});
      throw err;
    }
  }

  const populated = await populateEntry(StockEntry.findById(entry._id));
  res.json(populated);
});

/*
  POST /api/stock-entries/iqc-report/bulk
  Body:
    entryIds   - [stockEntryId, ...] lines currently in IQC stock
    templateId - the IqcTemplate every selected line is being checked against
    items      - [{ name, specification, unit, checked }], the checklist as
                 filled in — every item must be checked

  Bulk approval: the same checklist is recorded on each selected line and
  the FULL received quantity of each is approved (credited to
  Part.quantityInStock). Partial approvals / rejections need a reason and a
  quantity per line, so they stay on the single-line IQC report.

  Each line is handled on its own, so one that can't be approved (already
  inspected, deleted meanwhile) doesn't stop the rest. Response:
    { approved: [entryId, ...], failed: [{ id, message }] }
  The inspector is recorded from the signed-in user, same as a single report.
*/
export const submitBulkIqcReport = asyncHandler(async (req, res) => {
  const { entryIds, templateId, items } = req.body;

  const ids = [...new Set((Array.isArray(entryIds) ? entryIds : []).map(String))];
  if (ids.length === 0) {
    res.status(400);
    throw new Error("Select at least one stock entry");
  }

  const cleanItems = (Array.isArray(items) ? items : [])
    .map((it) => ({
      name: String(it?.name || "").trim(),
      specification: String(it?.specification || "").trim(),
      unit: String(it?.unit || "").trim(),
      checked: !!it?.checked,
    }))
    .filter((it) => it.name);

  if (cleanItems.length === 0) {
    res.status(400);
    throw new Error("At least one IQC point is required");
  }
  if (!cleanItems.every((it) => it.checked)) {
    res.status(400);
    throw new Error("Every point on the IQC report must be checked before it can be submitted");
  }

  const template = templateId ? await IqcTemplate.findById(templateId) : null;
  const round3 = (n) => Math.round(n * 1000) / 1000;

  const approved = [];
  const failed = [];

  for (const id of ids) {
    try {
      const entry = await StockEntry.findById(id);
      if (!entry) {
        failed.push({ id, message: "Stock entry not found" });
        continue;
      }
      if (entry.iqcStatus !== "in_iqc_stock") {
        failed.push({ id, message: "Not waiting on an IQC report any more" });
        continue;
      }

      const total = round3(Number(entry.quantityReceived) || 0);
      const partId = entry.part?._id || entry.part;

      if (partId) {
        await Part.findByIdAndUpdate(partId, { $inc: { quantityInStock: total } });
      }
      try {
        entry.iqcReport = {
          template: template ? template._id : null,
          materialName: template ? template.materialName : "",
          items: cleanItems.map((it) => ({ ...it })),
          inspectedBy: req.user?.name || "",
          inspectedByUser: req.user?._id || null,
          inspectedAt: new Date(),
          originalQuantity: total,
          acceptedQuantity: total,
          rejectedQuantity: 0,
          rejectionReason: "",
          decision: "accepted",
        };
        entry.iqcStatus = "accepted";
        entry.stockApplied = true;
        entry.appliedAt = new Date();
        await entry.save();
      } catch (err) {
        // Undo the stock credit so this line stays in IQC stock, untouched.
        if (partId) {
          await Part.findByIdAndUpdate(partId, { $inc: { quantityInStock: -total } }).catch(() => {});
        }
        throw err;
      }
      approved.push(id);
    } catch (err) {
      failed.push({ id, message: err.message || "Could not approve this line" });
    }
  }

  res.json({ approved, failed });
});