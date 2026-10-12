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
import { extractInvoiceLineItems, AiExtractionError } from "../utils/aiDocumentExtract.js";

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
    // Optional manual column overrides (JSON string, since this is a
    // multipart form): { received, ordered, rate, unit } -> column index.
    let columnMap;
    if (req.body.columnMap) {
      try {
        columnMap = JSON.parse(req.body.columnMap);
      } catch {
        columnMap = undefined;
      }
    }
    parsed = parseStockWorkbook(wb, { sheetName: req.body.sheetName || undefined, columnMap });
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
    headers: parsed.headers,
    columns: parsed.columns,
    dates: parsed.dates,
    rows,
  });
});

/*
  POST /api/stock-entries/import/parse-pdf  (multipart, field name "file")

  Same idea as parseStockImport, but the source is the vendor's invoice as a
  PDF (or a clear photo/scan of one) instead of their own workbook. The AI
  line-item reader (extractInvoiceLineItems — the same one the tax-invoice
  line-match screen uses) turns the item table into rows, and each row is
  then matched against the parts master:

    1. the invoice's item code equals a TT unique part number  -> matched
    2. the invoice's item code equals a manufacturer part number
       (only when exactly one part has it)                       -> matched
    3. anything else -> left unmatched, but shipped with `suggestions`:
       parts whose description shares keywords with the line (same keyword
       scoring as GET /parts/suggest), best first. Suggestions are only
       shown to the operator — they are never applied automatically.

  Read-only: nothing is written to the database. The rows come back in the
  same shape as the sheet parser's (rowIndex, itemDescription,
  ttUniquePartNumber, suggestedQuantity, ratePerUnit, matchedPart, ...), so
  the same review screen and the same POST /import/commit handle both.
*/
const SUGGEST_STOPWORDS = new Set([
  "the", "and", "for", "with", "per", "nos", "pcs", "set", "item", "type", "make", "size", "new",
]);
const keywordsOf = (text) => [
  ...new Set(
    String(text || "")
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((w) => w.length >= 3 && !SUGGEST_STOPWORDS.has(w.toLowerCase()))
  ),
];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PART_FIELDS = "ttUniquePartNumber itemDescription quantityInStock manufacturerPartNumber unit price";

export const parseInvoicePdfImport = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("Attach the vendor's invoice (PDF, JPG or PNG)");
  }
  const lower = (req.file.originalname || "").toLowerCase();
  if (!/\.(pdf|jpe?g|png)$/.test(lower)) {
    res.status(400);
    throw new Error("Only a PDF or an image of the invoice can be read here — use the sheet import for Excel files");
  }

  let extracted;
  try {
    extracted = await extractInvoiceLineItems({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
    });
  } catch (err) {
    res.status(err instanceof AiExtractionError ? 502 : 500);
    throw new Error(err.message || "Could not read line items from this invoice");
  }

  // The reader sometimes puts the whole description in the item-code field.
  // A real code is short and has no spaces: keep a leading "[CODE]" if there
  // is one, otherwise treat it as "no code" so it isn't shown / matched /
  // pre-filled as a (very long) manufacturer part number.
  const cleanCode = (raw) => {
    const c = String(raw || "").trim();
    if (!c) return "";
    if (c.length <= 30 && !/\s/.test(c)) return c;
    const bracket = c.match(/^\[([^\]\s]{2,30})\]/);
    return bracket ? bracket[1] : "";
  };
  const lines = extracted.lineItems.map((l) => ({ ...l, partNumber: cleanCode(l.partNumber) }));

  // Batch-match every item code against both the TT number and the
  // manufacturer part number in one query.
  const codes = [
    ...new Set(lines.map((l) => String(l.partNumber || "").trim()).filter(Boolean)),
  ];
  const upperCodes = codes.map((c) => c.toUpperCase());
  const candidates = codes.length
    ? await Part.find({
        $or: [
          { ttUniquePartNumber: { $in: upperCodes } },
          { manufacturerPartNumber: { $in: codes.map((c) => new RegExp(`^${escapeRegex(c)}$`, "i")) } },
        ],
      })
        .select(PART_FIELDS)
        .lean()
    : [];
  const byTt = new Map(candidates.map((p) => [p.ttUniquePartNumber, p]));
  const byMfr = new Map();
  for (const p of candidates) {
    const key = String(p.manufacturerPartNumber || "").trim().toUpperCase();
    if (!key) continue;
    byMfr.set(key, [...(byMfr.get(key) || []), p]);
  }

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const code = String(l.partNumber || "").trim();
    let matchedPart = null;
    let matchedBy = null;
    let ambiguous = [];
    if (code) {
      const tt = byTt.get(code.toUpperCase());
      const mfr = byMfr.get(code.toUpperCase()) || [];
      if (tt) {
        matchedPart = tt;
        matchedBy = "tt_part_number";
      } else if (mfr.length === 1) {
        matchedPart = mfr[0];
        matchedBy = "manufacturer_part_number";
      } else if (mfr.length > 1) {
        ambiguous = mfr; // several parts share this mfr number — let the operator choose
      }
    }

    // Suggestions only for lines that didn't match on their own.
    let suggestions = [];
    if (!matchedPart) {
      const kws = keywordsOf(l.description);
      if (kws.length) {
        const found = await Part.find({
          $or: kws.map((kw) => ({ itemDescription: { $regex: escapeRegex(kw), $options: "i" } })),
        })
          .select(PART_FIELDS)
          .limit(50)
          .lean();
        suggestions = found
          .map((p) => {
            const hay = String(p.itemDescription || "").toUpperCase();
            return { ...p, matchedKeywords: kws.reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0) };
          })
          .filter((p) => p.matchedKeywords > 0)
          .sort((a, b) => b.matchedKeywords - a.matchedKeywords)
          .slice(0, 5);
      }
      // Parts that share the invoice's mfr number go first.
      const seen = new Set(ambiguous.map((p) => String(p._id)));
      suggestions = [...ambiguous, ...suggestions.filter((p) => !seen.has(String(p._id)))].slice(0, 6);
    }

    rows.push({
      rowIndex: i + 1,
      page: l.page,
      itemDescription: l.description || code || "(no description)",
      // The code printed on the invoice. Named like the sheet parser's field
      // so the review screen treats both sources the same way; for a new part
      // it is pre-filled as the manufacturer part number.
      ttUniquePartNumber: code || null,
      suggestedQuantity: l.quantity,
      ratePerUnit: l.unitPrice,
      amount: l.amount,
      matchedBy,
      matchedPart,
      suggestions,
    });
  }

  res.json({
    source: "invoice_pdf",
    fileName: req.file.originalname,
    modelUsed: extracted.modelUsed,
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
                       audit trail / approval notification only; not sent for
                       an invoice-PDF import)
    source          - "invoice_pdf" when the rows came from an invoice PDF
                       instead of a vendor sheet; only changes the wording of
                       the default remarks / approval notification
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
  const { vendor, purchaseOrder, receivingSession, enteredBy, remarks: batchRemarks, date, rows, source } = req.body;
  const fromPdf = source === "invoice_pdf";
  const sourceLabel = fromPdf ? "vendor invoice PDF" : "vendor sheet";

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
          (date ? `Imported from ${sourceLabel} — sheet date ${date}` : `Imported from ${sourceLabel}`),
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
          imported ${sourceLabel}${date ? ` (${date})` : ""} are waiting for your approval.`.replace(/\s+/g, " "),
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