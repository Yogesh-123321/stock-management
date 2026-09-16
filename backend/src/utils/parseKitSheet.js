/*
  Parses a kit / BOM workbook — e.g. the "TMPL_XXXX_iMONICAM_BOM" style
  sheet, or a "QUANTITY ISSUE FOR ..." tracking sheet — for the Kits ->
  "Import from Excel" utility.

  Real sheets have a free-form title block in the first few rows (document
  number, author, rev, date...) and the real header a few rows down, with
  columns whose exact wording, casing and order vary sheet to sheet, e.g.:
    Sr. No | Reference | Value | PART_TYPE | TTZ Part | MFR_PART_NUMBER |
    MANUFACTURER | Footprint | Qty | DNP | ...
  or:
    S.NO | TTZ PART NO | ITEM DESCRIPTION | QTY IN 1 SET | QTY Reqd ... |
    QTY ISSUE | Shortage | ...

  Same approach as parseStockSheet.js: the header row is located by
  searching for a part-number-ish column ("TTZ Part") together with a
  quantity column ("Qty"), and every other column is looked up by name
  (with a list of likely synonyms) rather than a hard-coded column letter,
  so a differently laid out kit sheet keeps working without a code change.
  Matching is case-insensitive and whitespace-normalized, since the same
  header shows up as "TTZ Part", "TTZ PART NO", "Ttz part no." etc. across
  different sheets.

  This module only reads the workbook; nothing here touches the database
  or creates a KitTemplate — that happens once the admin reviews/edits the
  parsed rows and submits them to POST /api/kits.
*/
import xlsx from "xlsx";

const HEADER_CANDIDATES = {
  srNo: [
    "Sr. No", "Sr No", "S. No", "S No", "SNo", "Sr#", "Sl. No", "Sl No",
    "S.NO", "Sr.No", "Sl.No", "#",
  ],
  reference: [
    "Reference", "Ref Designator", "Ref. Designator", "Designator",
    "Ref Des", "Reference Designator", "RefDes",
  ],
  // "Value" sheets (BOM style) and "Item Description" sheets (issue-
  // tracking style) both describe what the part *is* — a kit template has
  // no separate free-text description field, so both map into `value`.
  value: [
    "Value", "Item Value", "Item Description", "Description",
    "Item Desc", "Desc",
  ],
  partType: [
    "PART_TYPE", "Part Type", "Type", "Component Type", "Category",
  ],
  ttPart: [
    "TTZ Part",
    "TT Part",
    "TT Unique Part Number",
    "TT Part Number",
    "TTZ Part Number",
    "Part Number",
    "TT Number",
    "TTZ Part No",
    "TT Part No",
    "TTZ No",
    "TT No",
    "TTZ Code",
    "TT Code",
    "Part No",
    "Part Code",
  ],
  mfrPart: [
    "MFR_PART_NUMBER",
    "MFR Part Number",
    "Manufacturer Part Number",
    "Mfr Part No",
    "Mfr Part Number",
    "MPN",
    "Manufacturer Part No",
  ],
  manufacturer: [
    "MANUFACTURER", "Manufacturer", "Mfr", "Make", "Brand",
  ],
  footprint: ["Footprint", "Package"],
  qty: [
    "Qty",
    "Quantity",
    "Qty per kit",
    "Qty/Unit",
    "Qty Per Unit",
    "Qty.",
    "Qty in 1 Set",
    "Qty in 1 Kit",
    "Qty Per Kit",
    "Qty/Kit",
    "Qty. Per Kit",
    "Qty Per Set",
    "Qty/Set",
  ],
  dnp: ["DNP", "Do Not Populate", "Do Not Place"],
};

const norm = (v) =>
  String(v ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Comparison-only normalization: case-insensitive on top of norm(), so
// header text is matched regardless of how a given sheet capitalized it
// ("TTZ Part" vs "TTZ PART NO" vs "ttz part"). Display/original-case text
// (header cells shown in the UI, error messages) still uses norm().
const normKey = (v) => norm(v).toLowerCase();

// Scans the first 25 rows for the row that looks like the real header (has
// both a part-number column and a Qty column) — kit sheets have a variable
// number of title/metadata rows above the header.
const findHeaderRow = (grid) => {
  const wantedTT = HEADER_CANDIDATES.ttPart.map(normKey);
  const wantedQty = HEADER_CANDIDATES.qty.map(normKey);
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const cells = (grid[r] || []).map(normKey);
    const hasTT = cells.some((c) => wantedTT.includes(c));
    const hasQty = cells.some((c) => wantedQty.includes(c));
    if (hasTT && hasQty) return r;
  }
  return -1;
};

const findCol = (headerCells, candidates) => {
  const wanted = candidates.map(normKey);
  return headerCells.findIndex((c) => wanted.includes(normKey(c)));
};

const toNumber = (v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Values real sheets use in place of a real part number when one hasn't
// been assigned / found yet (the sample template itself has a row reading
// "not Found") — treated as "no code" rather than a literal, useless code.
const NOT_FOUND = new Set(["", "-", "--", "NA", "N/A", "TBD", "NOT FOUND", "NONE", "?", "UNKNOWN"]);

const cleanCode = (raw) => {
  if (raw == null) return null;
  // A couple of cells on real sheets carry two codes separated by a
  // newline/slash (a merged-cell artifact) — only the first is authoritative.
  const s = String(raw).split(/[\n/]/)[0].trim().toUpperCase();
  if (!s || NOT_FOUND.has(s)) return null;
  return s;
};

const toBool = (v) => {
  if (v == null || v === "") return false;
  const s = String(v).trim().toUpperCase();
  return s === "Y" || s === "YES" || s === "TRUE" || s === "1" || s === "DNP" || s === "X";
};

// Best-effort scan of the metadata rows above the header for a kit name /
// document number — real sheets put these in a free-form title block, not
// a fixed cell, so this is only a starting suggestion; both stay editable
// in the UI before the template is ever saved.
const guessMeta = (grid, headerRowIdx) => {
  let kitCode = null;
  let kitName = null;
  const scanRows = grid.slice(0, headerRowIdx > -1 ? headerRowIdx : Math.min(grid.length, 10));
  for (const row of scanRows) {
    for (const cell of row || []) {
      const s = norm(cell);
      if (!s) continue;
      if (!kitCode) {
        const docMatch = s.match(/document\s*number\s*:?\s*(\S+)/i);
        if (docMatch) kitCode = docMatch[1].replace(/[,;]+$/, "");
      }
      // A title-ish line mentions "Rev" alongside a version number but
      // isn't itself the "Rev: PA1" metadata line.
      if (!kitName && /rev[\s.]*[\d.]/i.test(s) && !/^rev\s*:/i.test(s)) {
        kitName = s;
      }
    }
  }
  return { kitCode, kitName };
};

/**
 * @param {import("xlsx").WorkBook} wb  Already-parsed workbook.
 * @param {{ sheetName?: string }} opts
 * @returns {{
 *   sheetName: string,
 *   availableSheets: string[],
 *   headerRowIndex: number,
 *   kitCode: string|null,
 *   kitName: string|null,
 *   rows: Array<{
 *     rowIndex: number,
 *     srNo: number|null,
 *     referenceDesignator: string,
 *     value: string,
 *     partType: string,
 *     ttUniquePartNumber: string|null,
 *     manufacturerPartNumber: string,
 *     manufacturer: string,
 *     footprint: string,
 *     qtyPerKit: number,
 *     dnp: boolean,
 *   }>,
 * }}
 */
export function parseKitWorkbook(wb, { sheetName } = {}) {
  const availableSheets = wb.SheetNames;
  const name = sheetName && wb.Sheets[sheetName] ? sheetName : availableSheets[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Available: ${availableSheets.join(", ")}`);

  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const headerRowIdx = findHeaderRow(grid);
  if (headerRowIdx === -1) {
    throw new Error(
      'Could not find a header row with a part-number column ("TTZ Part" or similar) and a "Qty" column on this sheet.'
    );
  }
  const header = (grid[headerRowIdx] || []).map(norm);

  const idx = {
    srNo: findCol(header, HEADER_CANDIDATES.srNo),
    reference: findCol(header, HEADER_CANDIDATES.reference),
    value: findCol(header, HEADER_CANDIDATES.value),
    partType: findCol(header, HEADER_CANDIDATES.partType),
    ttPart: findCol(header, HEADER_CANDIDATES.ttPart),
    mfrPart: findCol(header, HEADER_CANDIDATES.mfrPart),
    manufacturer: findCol(header, HEADER_CANDIDATES.manufacturer),
    footprint: findCol(header, HEADER_CANDIDATES.footprint),
    qty: findCol(header, HEADER_CANDIDATES.qty),
    dnp: findCol(header, HEADER_CANDIDATES.dnp),
  };
  if (idx.ttPart === -1 || idx.qty === -1) {
    throw new Error('Could not locate the "TTZ Part" / "Qty" columns on this sheet.');
  }

  const rows = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const line = grid[r] || [];
    const ttUniquePartNumber = cleanCode(line[idx.ttPart]);
    const reference = idx.reference > -1 ? norm(line[idx.reference]) : "";
    const value = idx.value > -1 ? norm(line[idx.value]) : "";
    const qtyPerKit = toNumber(line[idx.qty]);

    // Fully blank row (nothing usable at all) — end-of-table filler, skip.
    if (!ttUniquePartNumber && !reference && !value && qtyPerKit == null) continue;

    rows.push({
      rowIndex: r + 1, // 1-indexed spreadsheet row, kept for traceability in the UI
      srNo: idx.srNo > -1 ? toNumber(line[idx.srNo]) : null,
      referenceDesignator: reference,
      value,
      partType: idx.partType > -1 ? norm(line[idx.partType]) : "",
      ttUniquePartNumber,
      manufacturerPartNumber: idx.mfrPart > -1 ? norm(line[idx.mfrPart]) : "",
      manufacturer: idx.manufacturer > -1 ? norm(line[idx.manufacturer]) : "",
      footprint: idx.footprint > -1 ? norm(line[idx.footprint]) : "",
      qtyPerKit: qtyPerKit ?? 0,
      dnp: idx.dnp > -1 ? toBool(line[idx.dnp]) : false,
    });
  }

  const { kitCode, kitName } = guessMeta(grid, headerRowIdx);

  return { sheetName: name, availableSheets, headerRowIndex: headerRowIdx, kitCode, kitName, rows };
}