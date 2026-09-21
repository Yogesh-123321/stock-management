import asyncHandler from "express-async-handler";
import StockEntry from "../models/StockEntry.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Part from "../models/Part.js";
import PartApprovalRequest from "../models/PartApprovalRequest.js";
import { bookExistingPart, bookNewPart, BookingError } from "../utils/stockBooking.js";
import { notifyApprovers } from "../utils/notify.js";

// GET /api/stock-entries?purchaseOrder=&vendor=&part=&receivingSession=
export const getStockEntries = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
  if (req.query.vendor) filter.vendor = req.query.vendor;
  if (req.query.part) filter.part = req.query.part;
  if (req.query.receivingSession) filter.receivingSession = req.query.receivingSession;
  if (req.query.iqcStatus) filter.iqcStatus = req.query.iqcStatus;

  const entries = await StockEntry.find(filter)
    .populate([
      { path: "part", populate: { path: "vendors", select: "companyName" } },
      { path: "vendor" },
      { path: "purchaseOrder" },
      { path: "alternateOfPart" },
    ])
    .sort({ createdAt: -1 });
  res.json(entries);
});

/*
  POST /api/stock-entries
  Body:
    purchaseOrder, vendor, quantityReceived, enteredBy, remarks
    receivingSession            - optional: the "Receive material" wizard
                                  session this line belongs to, so a saved
                                  and resumed delivery can restore its
                                  already-logged lines even when there's no
                                  PO/PI to key off of.
    unit, price                - optional: unit of measure and per-unit rate
                                  for THIS delivery, as entered at receiving
                                  time (separate from the part master's own
                                  registered unit/price) — carried onto the
                                  StockEntry and read back by Part history /
                                  the AI Price Analyzer.
    scannedPartNumber          - part number as written on the material/box
    matchType                  - "existing_part_number" | "new_part_number" | "alternate_part"
    existingPartId              - required when matchType = existing_part_number
    alternateOfPartId           - required when matchType = alternate_part
    newPart: {                  - required when matchType = new_part_number or alternate_part
      typeOfPart, manufacturerPartNumber, itemDescription,
      companyCode, category, partTypeBatchNo
    }

  This single endpoint implements the three branches described in the
  receiving flow:
    1. Part number matches an existing stack -> quantity is added to it.
    2. Part number does not match anything -> a new part record is created
       (with an auto-generated TT unique part number) and stocked.
    3. New part is flagged as an alternate of an existing part -> new part
       record is created, linked via alternateOf/alternateParts, and stocked.

  The actual booking logic lives in utils/stockBooking.js so the bulk
  Excel-import endpoints (see stockImportController.js) book stock exactly
  the same way a manually-entered line does.
*/
export const createStockEntry = asyncHandler(async (req, res) => {
  const {
    purchaseOrder,
    receivingSession,
    vendor,
    quantityReceived,
    enteredBy,
    remarks,
    matchType,
    existingPartId,
    alternateOfPartId,
    newPart,
    approvedRequestId,
    unit,
    price,
  } = req.body;

  if (!vendor || !quantityReceived || !matchType) {
    res.status(400);
    throw new Error("vendor, quantityReceived and matchType are required");
  }

  // The PO/PI is optional — stock can be entered before any paperwork arrives.
  let poDoc = null;
  if (purchaseOrder) {
    poDoc = await PurchaseOrder.findById(purchaseOrder);
    if (!poDoc) {
      res.status(404);
      throw new Error("Purchase order / invoice not found");
    }
  }

  let populated;
  try {
    if (matchType === "existing_part_number") {
      if (!existingPartId) {
        res.status(400);
        throw new Error("existingPartId is required for matchType existing_part_number");
      }
      populated = await bookExistingPart({
        vendor,
        purchaseOrder: poDoc ? poDoc._id : null,
        receivingSession: receivingSession || null,
        quantityReceived,
        enteredBy,
        remarks,
        existingPartId,
        unit,
        price,
      });
    } else if (matchType === "new_part_number" || matchType === "alternate_part") {
      // The part itself was already created in the master when the request
      // was approved — look it up so bookNewPart reuses it instead of
      // minting a second TT number for the same approval.
      const approvedRequest = approvedRequestId
        ? await PartApprovalRequest.findById(approvedRequestId)
        : null;

      populated = await bookNewPart({
        vendor,
        purchaseOrder: poDoc ? poDoc._id : null,
        receivingSession: receivingSession || null,
        quantityReceived,
        enteredBy,
        remarks,
        newPart,
        isAlternate: matchType === "alternate_part",
        alternateOfPartId,
        approvedRequest,
        unit,
        price,
      });
    } else {
      res.status(400);
      throw new Error("Invalid matchType");
    }
  } catch (err) {
    if (err instanceof BookingError || err.status) {
      res.status(err.status || 400);
      throw new Error(err.message);
    }
    throw err;
  }

  res.status(201).json(populated);
});

/*
  DELETE /api/stock-entries/:id
  Removes one line from a part's history (used from the "Part history"
  ledger in the Parts master). If the line had already been credited to
  stock (its tax invoice had arrived), that quantity is deducted back off
  the part first so the parts master stays correct; a still-pending line
  (invoice not yet uploaded) is simply removed since it was never added to
  stock in the first place.
*/
export const deleteStockEntry = asyncHandler(async (req, res) => {
  const entry = await StockEntry.findById(req.params.id);
  if (!entry) {
    res.status(404);
    throw new Error("Stock entry not found");
  }

  if (entry.stockApplied && entry.part) {
    const partDoc = await Part.findById(entry.part);
    if (partDoc) {
      partDoc.quantityInStock = Math.max(0, partDoc.quantityInStock - Number(entry.quantityReceived || 0));
      await partDoc.save();
    }
  }

  await entry.deleteOne();
  res.json({ message: "History entry deleted", _id: entry._id, partId: entry.part });
});

/*
  GET /api/stock-entries/suggest-warnings?part=&quantity=&vendor=&purchaseOrder=

  Lightweight, in-app "AI suggestion" pass for the stock-entry step — no
  external model call, just heuristics over data we already have, so it's
  instant and free to run on every keystroke-settle. Flags things worth a
  second look before the entry is saved:
    - a quantity far outside this part's usual receiving pattern
    - a vendor this part has never been received from before
    - a quantity that would push the PO/PI's cumulative received total past
      what the document says should arrive
  Never blocks saving — these are suggestions the operator can dismiss.
*/
export const getStockEntrySuggestions = asyncHandler(async (req, res) => {
  const { part: partId, quantity, vendor, purchaseOrder } = req.query;
  const warnings = [];

  const qty = Number(quantity);
  if (!partId || !qty || Number.isNaN(qty) || qty <= 0) {
    return res.json({ warnings });
  }

  const partDoc = await Part.findById(partId).select("vendors ttUniquePartNumber");
  if (!partDoc) return res.json({ warnings });

  // Unusual quantity vs this part's own receiving history.
  const history = await StockEntry.find({ part: partId })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("quantityReceived");
  if (history.length >= 3) {
    const avg = history.reduce((s, h) => s + Number(h.quantityReceived || 0), 0) / history.length;
    if (avg > 0) {
      if (qty >= avg * 3) {
        warnings.push({
          message: `That's about ${Math.round(qty / avg)}x this part's usual receiving quantity (avg ${Math.round(
            avg
          )}). Worth double-checking the count.`,
          level: "warning",
        });
      } else if (qty <= avg * 0.3) {
        warnings.push({
          message: `That's well below this part's usual receiving quantity (avg ${Math.round(
            avg
          )}). Make sure nothing was left uncounted.`,
          level: "info",
        });
      }
    }
  }

  // Vendor this part has never come from before.
  if (vendor && Array.isArray(partDoc.vendors) && partDoc.vendors.length > 0) {
    const known = partDoc.vendors.map((v) => String(v));
    if (!known.includes(String(vendor))) {
      warnings.push({
        message: `${partDoc.ttUniquePartNumber} hasn't been received from this vendor before — confirm the vendor is correct.`,
        level: "info",
      });
    }
  }

  // Would this push the document total over what's expected?
  if (purchaseOrder) {
    const poDoc = await PurchaseOrder.findById(purchaseOrder).select("totalQuantity linkedDocument");
    if (poDoc?.totalQuantity != null) {
      const docIds = [poDoc._id, poDoc.linkedDocument].filter(Boolean);
      const priorEntries = await StockEntry.find({ purchaseOrder: { $in: docIds } }).select(
        "quantityReceived"
      );
      const priorTotal = priorEntries.reduce((s, e) => s + Number(e.quantityReceived || 0), 0);
      const projected = priorTotal + qty;
      if (projected > poDoc.totalQuantity) {
        warnings.push({
          message: `This would bring the total received to ${projected}, ${
            projected - poDoc.totalQuantity
          } more than the ${poDoc.totalQuantity} shown on the document.`,
          level: "warning",
        });
      }
    }
  }

  res.json({ warnings });
});

/*
  POST /api/stock-entries/report-mismatch
  Body: { purchaseOrder, poQty, piQty, previouslyReceived, enteredNow, totalReceived, reportedBy }

  Called from the "Finish stock entry" step when the operator chooses to
  proceed despite the PO/PI quantity not matching what's been entered into
  stock. Fires a notification to every admin so the discrepancy doesn't sit
  unnoticed until someone happens to open the document later — the PO/PI
  itself is left "open" either way (see ReceiveMaterial.jsx), this just
  makes sure someone gets told about it.
*/
export const reportQuantityMismatch = asyncHandler(async (req, res) => {
  const {
    purchaseOrder,
    poQty = null,
    piQty = null,
    previouslyReceived = 0,
    enteredNow = 0,
    totalReceived = 0,
    reportedBy = "",
  } = req.body;

  let poDoc = null;
  if (purchaseOrder) {
    poDoc = await PurchaseOrder.findById(purchaseOrder).populate("vendor", "companyName");
  }

  const docParts = [];
  if (poQty != null) docParts.push(`PO: ${poQty}`);
  if (piQty != null) docParts.push(`PI: ${piQty}`);
  const docLabel = docParts.length ? docParts.join(", ") : "no document quantity on record";
  const diff = poQty != null || piQty != null ? totalReceived - (poQty ?? piQty) : null;

  try {
    await notifyApprovers({
      actorId: req.user?._id,
      title: "Stock quantity mismatch",
      message: `${reportedBy || "An operator"} logged ${enteredNow} unit(s)${
        poDoc?.vendor?.companyName ? ` from ${poDoc.vendor.companyName}` : ""
      }${
        poDoc?.documentNumber ? ` against ${poDoc.documentNumber}` : ""
      } — total received so far is ${totalReceived}, which does not match the document (${docLabel})${
        diff != null ? ` (${diff > 0 ? `+${diff} over` : `${diff} short`})` : ""
      }. The PO/PI was left open.`,
      link: "/receive",
      entityType: "po",
      entityId: poDoc?._id || null,
    });
  } catch (e) {
    console.error("stock mismatch notification failed:", e.message);
  }

  res.json({ notified: true });
});