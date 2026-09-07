import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import StockEntry from "../models/StockEntry.js";
import Part from "../models/Part.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { generateNextPartNumber } from "../utils/generatePartNumber.js";

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

  let partDoc;
  let alternateOfPart = null;

  if (matchType === "existing_part_number") {
    if (!existingPartId) {
      res.status(400);
      throw new Error("existingPartId is required for matchType existing_part_number");
    }
    partDoc = await Part.findById(existingPartId);
    if (!partDoc) {
      res.status(404);
      throw new Error("Matched part not found");
    }
    partDoc.quantityInStock += Number(quantityReceived);
    // Same part, possibly a new vendor this time — append (deduped) rather
    // than overwrite, so the parts master shows "VendorA / VendorB".
    partDoc.vendors.addToSet(vendor);
    await partDoc.save();
  } else if (matchType === "new_part_number" || matchType === "alternate_part") {
    if (!newPart || !newPart.itemDescription || !newPart.companyCode || !newPart.category || !newPart.partTypeBatchNo) {
      res.status(400);
      throw new Error("newPart details (itemDescription, companyCode, category, partTypeBatchNo) are required");
    }

    if (matchType === "alternate_part") {
      if (!alternateOfPartId) {
        res.status(400);
        throw new Error("alternateOfPartId is required for matchType alternate_part");
      }
      alternateOfPart = await Part.findById(alternateOfPartId);
      if (!alternateOfPart) {
        res.status(404);
        throw new Error("Original part to alternate against was not found");
      }
    }

    const { ttUniquePartNumber, runningSerialNo } = await generateNextPartNumber(
      newPart.companyCode,
      newPart.category,
      newPart.partTypeBatchNo
    );

    partDoc = await Part.create({
      ttUniquePartNumber,
      runningSerialNo,
      typeOfPart: newPart.typeOfPart,
      manufacturerPartNumber: newPart.manufacturerPartNumber,
      itemDescription: newPart.itemDescription,
      companyCode: newPart.companyCode.toUpperCase(),
      category: newPart.category.toUpperCase(),
      partTypeBatchNo: newPart.partTypeBatchNo.toUpperCase(),
      quantityInStock: Number(quantityReceived),
      vendors: [vendor],
      isAlternatePart: matchType === "alternate_part",
      alternateOf: matchType === "alternate_part" ? alternateOfPart._id : null,
    });

    if (matchType === "alternate_part") {
      alternateOfPart.alternateParts.addToSet(partDoc._id);
      await alternateOfPart.save();
    }
  } else {
    res.status(400);
    throw new Error("Invalid matchType");
  }

  const entry = await StockEntry.create({
    vendor,
    purchaseOrder: poDoc ? poDoc._id : null,
    part: partDoc._id,
    quantityReceived,
    matchType,
    alternateOfPart: alternateOfPart ? alternateOfPart._id : null,
    enteredBy,
    remarks,
  });

  if (poDoc) {
    poDoc.status = "stock_entry_in_progress";
    await poDoc.save();
    if (poDoc.linkedDocument) {
      await PurchaseOrder.findByIdAndUpdate(poDoc.linkedDocument, { status: "stock_entry_in_progress" });
    }
  }

  const populated = await entry.populate([
    { path: "part", populate: { path: "vendors", select: "companyName" } },
    { path: "vendor" },
    { path: "purchaseOrder" },
    { path: "alternateOfPart" },
  ]);
  res.status(201).json(populated);
});