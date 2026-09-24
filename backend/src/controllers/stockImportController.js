/*
  Bulk "import from vendor sheet" utility for Step 4 of the receiving wizard.

  Flow:
    1. POST /import/parse  - upload the vendor's own inward-stock workbook
       (e.g. the KKTRON sheet). Read-only: returns every usable row plus the
       unique dates found on the sheet, each row annotated with whatever
       existing part it matches (by TT unique part number), if any. Nothing
       is written to the database.

       The sheet must cover a single date: if it contains more than one
       distinct calendar date, the whole upload is rejected with a 400
       before any matching happens (rows with an unparseable/unrecognized
       date don't count toward this — see UNDATED_DATE_KEY).
    2. The operator picks a date on the frontend, reviews/edits the
       resulting rows (filling in anything missing), and submits them.
    3. POST /import/commit  - vendor is the one already chosen for this
       receiving session, and is the same for every row. Rows matched to an
       existing part number are booked into stock immediately, exactly like
       a manual "existing part" line. Rows with no match go through the very
       same part-approval pipeline as manual entry: a PartApprovalRequest is
       raised per row and nothing is added to stock until the Parts section
       approves it and someone books the quantity from the
       "Approved — ready to book" list already built into Step 4.

  Nothing here bypasses requirePartApproval — a brand-new part number can
  never reach quantityInStock through this endpoint without first going
  through PartApprovalRequest, same as the manual flow.
*/
import asyncHandler from "express-async-handler";
import xlsx from "xlsx";
import Part from "../models/Part.js";
import PartApprovalRequest from "../models/PartApprovalRequest.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { parseStockWorkbook, UNDATED_DATE_KEY } from "../utils/parseStockSheet.js";
import { bookExistingPart, BookingError } from "../utils/stockBooking.js";
import { notifyApprovers } from "../utils/notify.js";

const partLabel = (doc) =>
  [doc.newPart?.itemDescription, doc.newPart?.manufacturerPartNumber].filter(Boolean).join(" · ") ||
  "part number";

// POST /api/stock-entries/import/parse  (multipart, field name "file")
export const parseStockImport = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Attach the vendor stock sheet (.xlsx or .xls)");
  }

  let parsed;
  try {
    // Deliberately NOT using cellDates:true here. SheetJS's own serial->Date
    // conversion builds the Date using the server process's local time
    // zone internally, and on top of that has a rounding quirk for some
    // serial values — on a server running in IST (UTC+5:30) this was
    // landing a full calendar day early (e.g. 25 Dec read back as 24 Dec).
    // Reading the raw numeric serial instead and converting it ourselves
    // (see isoFromExcelSerial in parseStockSheet.js, which does the
    // conversion with pure UTC arithmetic) is not sensitive to the
    // server's time zone at all — verified identical output across UTC,
    // IST and US Eastern.
    const wb = xlsx.read(req.file.buffer, { type: "buffer" });
    parsed = parseStockWorkbook(wb, { sheetName: req.body.sheetName || undefined });
  } catch (err) {
    res.status(400);
    throw new Error(`Could not read that spreadsheet: ${err.message}`);
  }

  // Only a single-date sheet is accepted here — each import is meant to
  // represent one delivery/date. Rows with an unrecognized (unparseable)
  // date don't count toward this — that's a separate "needs review" bucket
  // — but two or more genuinely different calendar dates on the same sheet
  // means it should be split and uploaded one date at a time instead.
  const uniqueRealDates = parsed.dates.filter((d) => d.value !== UNDATED_DATE_KEY);
  if (uniqueRealDates.length > 1) {
    res.status(400);
    throw new Error(
      `This sheet has ${uniqueRealDates.length} different dates (${uniqueRealDates
        .map((d) => d.label)
        .join(", ")}) — only a sheet with a single date can be imported at a time. Split it by date and upload each date separately.`
    );
  }

  // Batch-match every code on the sheet against the parts master in one go.
  const codes = [...new Set(parsed.rows.map((r) => r.ttUniquePartNumber).filter(Boolean))];
  const existingParts = codes.length
    ? await Part.find({ ttUniquePartNumber: { $in: codes } }).select(
        "ttUniquePartNumber itemDescription quantityInStock manufacturerPartNumber unit price"
      )
    : [];
  const byCode = new Map(existingParts.map((p) => [p.ttUniquePartNumber, p]));

  const rows = parsed.rows.map((r) => ({
    ...r,
    matchedPart: r.ttUniquePartNumber ? byCode.get(r.ttUniquePartNumber) || null : null,
  }));

  res.json({
    sheetName: parsed.sheetName,
    availableSheets: parsed.availableSheets,
    dates: parsed.dates,
    rows,
  });
});

/*
  POST /api/stock-entries/import/commit
  Body:
    vendor          - required; the vendor already chosen for this delivery,
                       applied to every row in the batch
    purchaseOrder   - optional, same as the manual stock-entry endpoint
    enteredBy       - who is doing the entry
    receivingSession - optional; the "Receive material" wizard session. Stamped
                       on every booked line so it reappears under "Logged this
                       session" after a Save & exit / Resume, exactly like a
                       hand-entered line. The frontend also uses this endpoint
                       to save a single row on its own (a one-row batch).
    remarks         - default remarks applied to every row (a row can override it)
    date            - the sheet date this batch was picked for (kept for the
                       audit trail / approval notification only)
    rows: [{
      rowIndex, itemDescription, quantityReceived, remarks,
      unit, price,        - optional; unit of measure and rate per unit for this
                            delivery. Stored on the stock entry for an existing
                            part, or on the new-part request (newPart.unit /
                            newPart.price) so the approved part starts with them.
      matchType: "existing_part_number" | "new_part_number" | "alternate_part",
      existingPartId,     - required for existing_part_number
      alternateOfPartId,  - required for alternate_part
      newPart: {          - required for new_part_number / alternate_part
        typeOfPart, manufacturerPartNumber, itemDescription,
        companyCode, category, partTypeBatchNo
      },
    }]
*/
export const commitStockImport = asyncHandler(async (req, res) => {
  const { vendor, purchaseOrder, receivingSession, enteredBy, remarks: batchRemarks, date, rows } = req.body;

  if (!vendor) {
    res.status(400);
    throw new Error("vendor is required");
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400);
    throw new Error("No rows were selected to import");
  }

  let poDoc = null;
  if (purchaseOrder) {
    poDoc = await PurchaseOrder.findById(purchaseOrder);
    if (!poDoc) {
      res.status(404);
      throw new Error("Purchase order / invoice not found");
    }
  }

  const createdEntries = [];
  const createdApprovalIds = [];
  const failedRows = [];

  for (const row of rows) {
    try {
      const quantityReceived = Number(row.quantityReceived);
      // Decimal quantities are allowed (e.g. metres, kilograms) — just
      // reject missing/zero/negative values, not anything under 1.
      if (!quantityReceived || quantityReceived <= 0) {
        throw new Error("Quantity received is required");
      }

      // Optional unit + per-unit rate for this delivery.
      const rowUnit = String(row.unit ?? "").trim();
      let rowPrice = null;
      if (row.price !== undefined && row.price !== null && row.price !== "") {
        rowPrice = Number(row.price);
        if (!Number.isFinite(rowPrice) || rowPrice < 0) {
          throw new Error("Price per unit must be a number, 0 or more");
        }
      }

      if (row.matchType === "existing_part_number") {
        if (!row.existingPartId) throw new Error("No matching part selected");
        const entry = await bookExistingPart({
          vendor,
          purchaseOrder: poDoc ? poDoc._id : null,
          receivingSession: receivingSession || null,
          quantityReceived,
          enteredBy,
          remarks: row.remarks || batchRemarks,
          existingPartId: row.existingPartId,
          unit: rowUnit,
          price: rowPrice,
        });
        createdEntries.push(entry);
        continue;
      }

      if (row.matchType !== "new_part_number" && row.matchType !== "alternate_part") {
        throw new Error("Each row must be matched to an existing part or sent for approval");
      }

      if (row.matchType === "alternate_part" && !row.alternateOfPartId) {
        throw new Error("Select the part this is an alternate of");
      }

      // No part number on the sheet (or the code didn't match anything) —
      // route it through the exact same approval pipeline a manual "new
      // part" (or "alternate part") line would use. No stock is booked here.
      const newPart = row.newPart || {};
      if (!newPart.itemDescription || !newPart.companyCode || !newPart.category || !newPart.partTypeBatchNo) {
        throw new Error("Item description, company code, category and part type/batch no. are required");
      }

      const duplicate = await PartApprovalRequest.findOne({
        status: { $in: ["pending", "approved"] },
        "newPart.itemDescription": String(newPart.itemDescription).trim(),
        "newPart.companyCode": String(newPart.companyCode).trim(),
        "newPart.category": String(newPart.category).trim(),
        "newPart.partTypeBatchNo": String(newPart.partTypeBatchNo).trim(),
      });
      if (duplicate) {
        throw new Error(
          duplicate.status === "pending"
            ? "Already waiting for approval — skipped"
            : "Already approved — pick it from the approved list instead of importing it again"
        );
      }

      const doc = await PartApprovalRequest.create({
        requestType: row.matchType, // "new_part_number" | "alternate_part"
        newPart: {
          typeOfPart: newPart.typeOfPart || "",
          manufacturerPartNumber: newPart.manufacturerPartNumber || "",
          itemDescription: newPart.itemDescription,
          companyCode: newPart.companyCode,
          category: newPart.category,
          partTypeBatchNo: newPart.partTypeBatchNo,
          unit: rowUnit,
          price: rowPrice,
        },
        alternateOfPart: row.matchType === "alternate_part" ? row.alternateOfPartId : null,
        vendor,
        purchaseOrder: poDoc ? poDoc._id : null,
        searchTerm: row.itemDescription || newPart.itemDescription,
        proposedQuantity: quantityReceived,
        requestedBy: enteredBy || req.user?.name || req.user?.username || "",
        requestedByUser: req.user?._id || null,
        requestRemarks:
          row.remarks ||
          batchRemarks ||
          (date ? `Imported from vendor sheet — sheet date ${date}` : "Imported from vendor sheet"),
      });
      createdApprovalIds.push(doc._id);
    } catch (err) {
      const message = err instanceof BookingError ? err.message : err.message || "Could not import this row";
      failedRows.push({ rowIndex: row.rowIndex, itemDescription: row.itemDescription, message });
    }
  }

  if (createdApprovalIds.length) {
    try {
      await notifyApprovers({
        permission: "part.approve",
        actorId: req.user?._id,
        title: "New part numbers need approval",
        message: `${createdApprovalIds.length} part number(s) (some possibly marked as alternates) from an
          imported vendor sheet${date ? ` (${date})` : ""} are waiting for your approval.`.replace(/\s+/g, " "),
        link: "/parts",
        entityType: "part",
        entityId: createdApprovalIds[0],
      });
    } catch (e) {
      console.error("bulk part approval notification failed:", e.message);
    }
  }

  const createdApprovals = createdApprovalIds.length
    ? await PartApprovalRequest.find({ _id: { $in: createdApprovalIds } })
        .populate("alternateOfPart", "ttUniquePartNumber itemDescription")
        .populate("vendor", "companyName")
    : [];

  const anyCreated = createdEntries.length > 0 || createdApprovals.length > 0;
  res.status(anyCreated ? 201 : 400).json({
    createdEntries,
    createdApprovals,
    failedRows,
    // When nothing at all was created (e.g. a single row saved on its own
    // that failed), surface the reason as a normal `message` too so the
    // client doesn't have to dig into failedRows to show something useful.
    ...(anyCreated ? {} : { message: failedRows[0]?.message || "Nothing could be imported" }),
  });
});

// Exported for readability in error messages elsewhere, if ever needed.
export { partLabel };