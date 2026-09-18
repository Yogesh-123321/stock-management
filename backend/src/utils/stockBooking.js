/*
  Shared stock-booking logic, extracted out of stockController.js so the same
  code path is used whether a line is entered by hand in Step 4 of the
  receiving wizard, or booked in bulk from the Excel-import utility. Keeping
  this in one place means the two entry points can never quietly drift apart
  on how quantity gets added, how the part-vendor list is maintained, or how
  the linked PO/PI status is updated.
*/
import StockEntry from "../models/StockEntry.js";
import Part from "../models/Part.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { buildPartNumber } from "./generatePartNumber.js";

class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export { BookingError };

const populateEntry = (entry) =>
  entry.populate([
    { path: "part", populate: { path: "vendors", select: "companyName" } },
    { path: "vendor" },
    { path: "purchaseOrder" },
    { path: "alternateOfPart" },
  ]);

// Marks the linked PO/PI (and its counterpart document, if any) as
// "stock entry in progress" once at least one line has been booked against it.
async function touchPurchaseOrder(purchaseOrderId) {
  if (!purchaseOrderId) return;
  const poDoc = await PurchaseOrder.findById(purchaseOrderId);
  if (!poDoc) return;
  poDoc.status = "stock_entry_in_progress";
  await poDoc.save();
  if (poDoc.linkedDocument) {
    await PurchaseOrder.findByIdAndUpdate(poDoc.linkedDocument, { status: "stock_entry_in_progress" });
  }
}

/**
 * Logs a received line against a part that already exists in the master
 * database. No approval is needed for this path — the part number is
 * already known.
 *
 * IMPORTANT: this does NOT credit the quantity to the part's
 * quantityInStock. Material can be entered here before its tax invoice has
 * arrived, and the parts master should only ever show quantity that has
 * actually been billed. The StockEntry line is created with
 * stockApplied: false and sits "pending" until the matching tax invoice is
 * uploaded (see applyPendingStockForInvoice in taxInvoiceController.js),
 * at which point the quantity is added to the part and the line is marked
 * applied.
 */
export async function bookExistingPart({
  vendor,
  purchaseOrder,
  receivingSession,
  quantityReceived,
  enteredBy,
  remarks,
  existingPartId,
  unit,
  price,
}) {
  const partDoc = await Part.findById(existingPartId);
  if (!partDoc) throw new BookingError("Matched part not found", 404);

  // Same part, possibly a new vendor this time — append (deduped) rather
  // than overwrite, so the parts master shows "VendorA / VendorB". This is
  // just an association and is safe to record immediately, unlike the
  // quantity itself.
  partDoc.vendors.addToSet(vendor);
  await partDoc.save();

  const entry = await StockEntry.create({
    vendor,
    purchaseOrder: purchaseOrder || null,
    receivingSession: receivingSession || null,
    part: partDoc._id,
    quantityReceived,
    matchType: "existing_part_number",
    enteredBy,
    remarks,
    unit: unit || "",
    price: price === "" || price == null ? null : Number(price),
    stockApplied: false,
  });

  await touchPurchaseOrder(purchaseOrder);
  return populateEntry(entry);
}

/**
 * Creates the Part record for a newly-approved "new part number" / "alternate
 * part" request. Called the moment an admin approves the request (see
 * approveRequest in partApprovalController.js) so the part number shows up
 * in the Parts master immediately — it no longer waits for someone to book a
 * stock entry against it. Created with quantityInStock: 0; the vendor on the
 * request (if any) is attached so the master already shows where it came
 * from. Never called for a rejected request.
 */
export async function createPartFromApprovedRequest(request) {
  const { newPart, requestType, alternateOfPart: alternateOfPartId, vendor, requestRemarks } = request;
  const isAlternate = requestType === "alternate_part";

  if (!newPart || !newPart.itemDescription || !newPart.companyCode || !newPart.category || !newPart.partTypeBatchNo) {
    throw new BookingError(
      "newPart details (itemDescription, companyCode, category, partTypeBatchNo) are required"
    );
  }

  let alternateOfPart = null;
  if (isAlternate) {
    if (!alternateOfPartId) throw new BookingError("alternateOfPart is required for an alternate part");
    alternateOfPart = await Part.findById(alternateOfPartId);
    if (!alternateOfPart) throw new BookingError("Original part to alternate against was not found", 404);
  }

  const { ttUniquePartNumber } = await buildPartNumber(
    newPart.companyCode,
    newPart.category,
    newPart.partTypeBatchNo
  );

  const partDoc = await Part.create({
    ttUniquePartNumber,
    typeOfPart: newPart.typeOfPart,
    manufacturerPartNumber: newPart.manufacturerPartNumber,
    itemDescription: newPart.itemDescription,
    companyCode: newPart.companyCode.toUpperCase(),
    category: newPart.category.toUpperCase(),
    partTypeBatchNo: newPart.partTypeBatchNo.toUpperCase(),
    unit: newPart.unit || "",
    price: newPart.price === "" || newPart.price == null ? null : Number(newPart.price),
    quantityInStock: 0,
    vendors: vendor ? [vendor] : [],
    isAlternatePart: isAlternate,
    alternateOf: isAlternate ? alternateOfPart._id : null,
    // Carried over from the request, if a photo / datasheet was attached
    // when it was raised (see partApprovalController.js createRequest).
    photoUrl: newPart.photoUrl || "",
    datasheetUrl: newPart.datasheetUrl || "",
    // Carries the "remarks for the approver" typed at registration time
    // (stock-entry step) through to the part record, so it's visible in the
    // part details popup without having to dig up the original request.
    remarks: requestRemarks || "",
  });

  if (isAlternate) {
    alternateOfPart.alternateParts.addToSet(partDoc._id);
    await alternateOfPart.save();
  }

  return partDoc;
}

/**
 * Logs the received line for a new / alternate part number that has already
 * cleared approval — either a manual line booking an "approved-request", or
 * a bulk-import line whose approval request an admin approved beforehand.
 *
 * The Part record itself is normally already sitting in the master by the
 * time this runs, because it was created the moment the request was
 * approved (see createPartFromApprovedRequest above / approveRequest in
 * partApprovalController.js) — this just reuses it via
 * approvedRequest.createdPart instead of minting a second TT number for the
 * same request. `newPart`/`isAlternate`/`alternateOfPartId` are kept as a
 * fallback so this still works for a request approved before this change
 * (one with no createdPart yet).
 *
 * Either way, the received quantity is only credited to quantityInStock once
 * the tax invoice for this delivery is uploaded (same as bookExistingPart).
 */
export async function bookNewPart({
  vendor,
  purchaseOrder,
  receivingSession,
  quantityReceived,
  enteredBy,
  remarks,
  newPart,
  isAlternate = false,
  alternateOfPartId = null,
  approvedRequest = null,
  unit,
  price,
}) {
  let partDoc = approvedRequest?.createdPart ? await Part.findById(approvedRequest.createdPart) : null;
  let alternateOfPart = null;

  if (partDoc) {
    if (isAlternate && alternateOfPartId) {
      alternateOfPart = await Part.findById(alternateOfPartId);
    }
    partDoc.vendors.addToSet(vendor);
    await partDoc.save();
  } else {
    // Fallback: no part created for this request yet (e.g. it was approved
    // before this behaviour existed). Create it here, same as before.
    if (!newPart || !newPart.itemDescription || !newPart.companyCode || !newPart.category || !newPart.partTypeBatchNo) {
      throw new BookingError(
        "newPart details (itemDescription, companyCode, category, partTypeBatchNo) are required"
      );
    }

    if (isAlternate) {
      if (!alternateOfPartId) throw new BookingError("alternateOfPartId is required for an alternate part");
      alternateOfPart = await Part.findById(alternateOfPartId);
      if (!alternateOfPart) throw new BookingError("Original part to alternate against was not found", 404);
    }

    const { ttUniquePartNumber } = await buildPartNumber(
      newPart.companyCode,
      newPart.category,
      newPart.partTypeBatchNo
    );

    partDoc = await Part.create({
      ttUniquePartNumber,
      typeOfPart: newPart.typeOfPart,
      manufacturerPartNumber: newPart.manufacturerPartNumber,
      itemDescription: newPart.itemDescription,
      companyCode: newPart.companyCode.toUpperCase(),
      category: newPart.category.toUpperCase(),
      partTypeBatchNo: newPart.partTypeBatchNo.toUpperCase(),
      unit: newPart.unit || "",
      price: newPart.price === "" || newPart.price == null ? null : Number(newPart.price),
      quantityInStock: 0,
      vendors: [vendor],
      isAlternatePart: isAlternate,
      alternateOf: isAlternate ? alternateOfPart._id : null,
      remarks: approvedRequest?.requestRemarks || "",
    });

    if (isAlternate) {
      alternateOfPart.alternateParts.addToSet(partDoc._id);
      await alternateOfPart.save();
    }
  }

  const entry = await StockEntry.create({
    vendor,
    purchaseOrder: purchaseOrder || null,
    receivingSession: receivingSession || null,
    part: partDoc._id,
    quantityReceived,
    matchType: isAlternate ? "alternate_part" : "new_part_number",
    alternateOfPart: alternateOfPart ? alternateOfPart._id : null,
    enteredBy,
    remarks,
    // Falls back to the rate registered on the part itself (set from the
    // "new part" form's own Unit/Price fields) so a first-time delivery
    // still carries a price even if the per-entry field is left blank.
    unit: unit || partDoc.unit || "",
    price: price === "" || price == null ? partDoc.price ?? null : Number(price),
    stockApplied: false,
  });

  await touchPurchaseOrder(purchaseOrder);
  return populateEntry(entry);
}