import asyncHandler from "express-async-handler";
import StockEntry from "../models/StockEntry.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Part from "../models/Part.js";
import PartApprovalRequest from "../models/PartApprovalRequest.js";
import { bookExistingPart, bookNewPart, BookingError } from "../utils/stockBooking.js";

// GET /api/stock-entries?purchaseOrder=&vendor=&part=
export const getStockEntries = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
  if (req.query.vendor) filter.vendor = req.query.vendor;
  if (req.query.part) filter.part = req.query.part;

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
    vendor,
    quantityReceived,
    enteredBy,
    remarks,
    matchType,
    existingPartId,
    alternateOfPartId,
    newPart,
    approvedRequestId,
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
        quantityReceived,
        enteredBy,
        remarks,
        existingPartId,
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
        quantityReceived,
        enteredBy,
        remarks,
        newPart,
        isAlternate: matchType === "alternate_part",
        alternateOfPartId,
        approvedRequest,
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