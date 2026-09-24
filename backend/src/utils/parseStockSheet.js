/*
  Parses a vendor "inward stock" tracking workbook — e.g. the KKTRON monthly
  sheet — for the Stock Entry -> "Import from vendor sheet" utility.

  The sheet this was built against has its header on row 6 with columns
  including:
    TTZ Item Code | Item Description | DATE | Rate per Unit (INR) |
    Ordered Quantity | Received Quantity
  ...followed by many weekly issue/receipt-tracking columns that this parser
  ignores.

  Rather than hard-coding column letters, the header row is located by
  searching for the "Item Description" + "DATE" columns, and every other
  column is looked up by name (with a couple of likely synonyms). That way a
  different vendor's sheet — or next month's version of the same one — keeps
  working as long as the header names are recognisable, without needing a
  code change for every sheet.

  This module only reads the workbook; nothing here touches the database.
*/
import xlsx from "xlsx";

// Sentinel `dates[].value` / row `dateKey` for rows that HAD something typed
// in the DATE cell but it couldn't be turned into a real date. Exported so
// callers (e.g. stockImportController.js) can tell this bucket apart from a
// genuinely parsed calendar date without duplicating the magic string.
export const UNDATED_DATE_KEY = "__undated__";

const HEADER_CANDIDATES = {
  code: ["TTZ Item Code", "Part Number", "TT Unique Part Number", "Item Code"],
  description: ["Item Description", "Description"],
  date: ["DATE", "Date"],
  rate: [
    "Rate per Unit (INR)", "Rate per Unit", "Rate", "Unit Price", "Price", "Unit Rate", "Rate/Unit",
    "Price per Unit", "Rate (INR)", "Price (INR)", "Unit Price (INR)", "Basic Rate", "Rate Per Piece",
  ],
  unit: ["Unit", "UOM", "UoM", "Unit of Measure", "Units"],
  ordered: [
    "Ordered \nQuantity", "Ordered Quantity", "Order Qty", "Order Quantity", "Ordered Qty", "PO Qty",
    "Qty Ordered", "Quantity Ordered",
  ],
  received: [
    "Received \nQuantity", "Received Quantity", "Receipt Qty", "Received Qty", "Qty Received",
    "Quantity Received", "Rcvd Qty", "Qty Rcvd", "Recd Qty", "Inward Qty", "Received",
  ],
  // A plain "Qty" / "Quantity" column, used for the received quantity only
  // when the sheet has no column that says "received" anywhere in it.
  qty: ["Quantity", "Qty", "Qty.", "Nos", "Quantity (Nos)"],
};

// Looser second-chance matching for the columns that vendors label in many
// different ways. Only tried when none of the exact names above matched, and
// always left-to-right, so the main table's column wins over the weekly
// tracking columns further along the row. `k` is a lower-cased header with
// everything but letters/digits stripped out.
const FUZZY = {
  received: (k) =>
    /^(received|rcvd|recd)$/.test(k) ||
    (/(receiv|rcvd|recd|inward)/.test(k) && /(qty|quant|nos|pcs)/.test(k)),
  ordered: (k) => /^(ordered|po)$/.test(k) || (/(order|^po)/.test(k) && /(qty|quant|nos|pcs)/.test(k)),
  rate: (k) => /(rate|price)/.test(k) && !/(total|amount|value|gst|tax|hsn|discount)/.test(k),
};

const norm = (v) =>
  String(v ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Case-, spacing- and punctuation-insensitive form of a header, so "Received
// Qty.", "received qty" and "RECEIVED\nQTY" all compare equal.
const keyOf = (v) => norm(v).toLowerCase().replace(/[^a-z0-9]/g, "");

// Scans the first 20 rows for the one that looks like the real header (has
// both an "Item Description" and a "DATE" column) — the sheet has several
// blank / title rows above it that vary in count from workbook to workbook.
const findHeaderRow = (grid) => {
  const wantedDescription = HEADER_CANDIDATES.description.map(keyOf);
  const wantedDate = HEADER_CANDIDATES.date.map(keyOf);
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const cells = (grid[r] || []).map(keyOf);
    const hasDescription = cells.some((c) => wantedDescription.includes(c));
    const hasDate = cells.some((c) => wantedDate.includes(c));
    if (hasDescription && hasDate) return r;
  }
  return -1;
};

const findCol = (headerCells, candidates, fuzzy) => {
  const wanted = candidates.map(keyOf);
  const keys = headerCells.map(keyOf);
  let i = keys.findIndex((k) => k && wanted.includes(k));
  if (i === -1 && fuzzy) i = keys.findIndex((k) => k && fuzzy(k));
  return i;
};

const isoFromParts = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// A sheet-plausible year. Anything outside this window is almost certainly a
// typo (e.g. a 2-digit-year slip, or a stray number that isn't a date at
// all) rather than a real delivery date, so it's treated as unparseable
// instead of being turned into a garbage far-future/far-past date.
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// Confirms (y, m, d) is a real calendar date — e.g. rejects "31/04/2026"
// (April has 30 days) or "30/02/2026" instead of silently rolling them over
// into the next month the way `new Date(...)` would.
const isRealCalendarDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const tryIso = (y, m, d) => {
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (!isRealCalendarDate(y, m, d)) return null;
  return isoFromParts(y, m, d);
};

// Excel's own date serial numbers (days since 1899-12-30, with the
// well-known Excel bug that treats 1900 as a leap year). This is now the
// path every genuinely date-formatted cell goes through — the workbook is
// deliberately read without cellDates:true (see stockImportController.js)
// because SheetJS's own serial->Date conversion is sensitive to the
// server's local time zone and was found to land a day early on a server
// running in IST. Pure UTC arithmetic here has no such dependency.
const isoFromExcelSerial = (n) => {
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  const utcMs = Math.round((n - 25569) * 86400 * 1000); // 25569 = days between 1899-12-30 and 1970-01-01
  const dt = new Date(utcMs);
  if (Number.isNaN(dt.getTime())) return null;
  return tryIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

// The DATE column on real-world copies of this sheet is a mix of genuine
// Excel dates and hand-typed text — dd/mm/yyyy (the sheet's own convention),
// occasionally mm/dd/yyyy where someone's Excel was in a US locale, dotted
// or dashed separators, 2-digit years, and typos like a doubled slash
// ("9//5/2026") or stray spaces. This tries every format actually seen on
// vendor copies of this sheet before giving up and leaving the row dateless
// (still importable, just not grouped under a pickable date) — a genuinely
// unparseable value is never guessed into a wrong date.
const toIsoDate = (raw) => {
  if (raw == null || raw === "") return null;
  // Defensive fallback only — the workbook is read without cellDates:true
  // (see the wb jsdoc above) specifically so date cells arrive as plain
  // numeric serials instead, but this keeps things working if that ever
  // changes or another caller passes a real Date in directly.
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return tryIso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === "number") return isoFromExcelSerial(raw);

  const s = String(raw).trim();
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number);
    return tryIso(y, m, d);
  }

  // dd/mm/yyyy (or dd.mm.yyyy / dd-mm-yyyy), tolerant of doubled separators
  // ("9//5/2026"), stray spaces, and a 2-digit year.
  const parts = s
    .split(/[/.\-]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    let [a, b, yyyy] = parts.map((p) => parseInt(p, 10));
    if (yyyy < 100) yyyy += 2000;
    // Sheet convention is day-first; try that first.
    const dayFirst = tryIso(yyyy, b, a);
    if (dayFirst) return dayFirst;
    // Fall back to month-first for values a day-first reading can't
    // possibly satisfy (e.g. "12/25/2025" — 25 isn't a valid month), which
    // covers rows typed on a US-locale copy of Excel.
    return tryIso(yyyy, a, b);
  }
  return null;
};

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Formats without going through toLocaleDateString: locale/ICU behaviour
// varies by deployment (a Node build without full ICU data can silently
// mis-render a non-"en-US" locale), which is a real way for dates that
// parsed perfectly fine to still show up looking wrong. A fixed table has
// no such surprises.
const labelFromIso = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTH_ABBR[m - 1]} ${y}`;
};

// Accepts real numbers as well as text a person typed into the cell — "1,250",
// "₹ 12.50", "12.50/-", "10 pcs" — by pulling out the first number in it.
const toNumber = (v) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {import("xlsx").WorkBook} wb  Already-parsed workbook — read WITHOUT
 *   cellDates:true (see stockImportController.js for why: SheetJS's own
 *   date conversion is server-time-zone-sensitive). Date-formatted cells
 *   arrive here as plain numeric serials and are converted with our own
 *   time-zone-independent isoFromExcelSerial.
 * @param {{ sheetName?: string, columnMap?: { received?: number, ordered?: number, rate?: number, unit?: number } }} opts
 *   columnMap lets the caller override the auto-detected columns: each value
 *   is a 0-based column index on the header row, or -1 for "not on this sheet".
 * @returns {{
 *   sheetName: string,
 *   availableSheets: string[],
 *   headerRowIndex: number,
 *   rows: Array<{
 *     rowIndex: number,
 *     ttUniquePartNumber: string|null,
 *     itemDescription: string,
 *     dateKey: string|null,
 *     dateLabel: string|null,
 *     dateRaw: string|null,
 *     ratePerUnit: number|null,
 *     unit: string,
 *     orderedQuantity: number|null,
 *     receivedQuantity: number|null,
 *     suggestedQuantity: number|null,
 *   }>,
 *   dates: Array<{ value: string, label: string, rowCount: number }>,
 * }}
 */
export function parseStockWorkbook(wb, { sheetName, columnMap } = {}) {
  const availableSheets = wb.SheetNames;
  const name = sheetName && wb.Sheets[sheetName] ? sheetName : availableSheets[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Available: ${availableSheets.join(", ")}`);

  const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const headerRowIdx = findHeaderRow(grid);
  if (headerRowIdx === -1) {
    throw new Error('Could not find a header row with "Item Description" and "DATE" columns on this sheet.');
  }
  const header = (grid[headerRowIdx] || []).map(norm);

  const idx = {
    code: findCol(header, HEADER_CANDIDATES.code),
    description: findCol(header, HEADER_CANDIDATES.description),
    date: findCol(header, HEADER_CANDIDATES.date),
    rate: findCol(header, HEADER_CANDIDATES.rate, FUZZY.rate),
    unit: findCol(header, HEADER_CANDIDATES.unit),
    ordered: findCol(header, HEADER_CANDIDATES.ordered, FUZZY.ordered),
    received: findCol(header, HEADER_CANDIDATES.received, FUZZY.received),
  };
  if (idx.received === -1) idx.received = findCol(header, HEADER_CANDIDATES.qty);

  // Manual override from the UI ("read quantity from column H instead").
  for (const field of ["received", "ordered", "rate", "unit"]) {
    const v = columnMap ? columnMap[field] : undefined;
    if (Number.isInteger(v)) idx[field] = v >= 0 && v < 1000 ? v : -1;
  }
  if (idx.description === -1 || idx.date === -1) {
    throw new Error('Could not locate the "Item Description" / "DATE" columns on this sheet.');
  }

  const rows = [];
  const dateMap = new Map(); // iso -> { value, label, rowCount }
  // Rows that DID have something in the DATE cell but it couldn't be turned
  // into a real date (a typo, an unfamiliar format, a stray note in the
  // column, ...). These used to just vanish — never shown under any date,
  // so the row was silently unimportable. They're now grouped into their
  // own pickable bucket instead, with the original cell value kept in
  // `dateRaw` so the person can see exactly what was on the sheet and fix
  // it there (or edit the row's date manually before committing).
  const UNDATED = UNDATED_DATE_KEY;
  let undatedCount = 0;

  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const line = grid[r] || [];
    const itemDescription = idx.description > -1 ? norm(line[idx.description]) : "";
    const rawCode = idx.code > -1 ? line[idx.code] : null;
    if (!itemDescription && !rawCode) continue; // fully blank row

    // A couple of cells on real sheets contain two codes separated by a
    // newline/slash (a merged-cell artifact) — only the first is authoritative.
    const ttUniquePartNumber = rawCode
      ? String(rawCode).split(/[\n/]/)[0].trim().toUpperCase() || null
      : null;

    const dateRaw = idx.date > -1 ? line[idx.date] : null;
    const dateKey = toIsoDate(dateRaw);
    const dateCellHadContent = dateRaw != null && String(dateRaw).trim() !== "";

    const receivedQuantity = idx.received > -1 ? toNumber(line[idx.received]) : null;
    const orderedQuantity = idx.ordered > -1 ? toNumber(line[idx.ordered]) : null;
    const ratePerUnit = idx.rate > -1 ? toNumber(line[idx.rate]) : null;
    const unit = idx.unit > -1 ? norm(line[idx.unit]) : "";

    if (dateKey) {
      const existing = dateMap.get(dateKey);
      if (existing) existing.rowCount += 1;
      else dateMap.set(dateKey, { value: dateKey, label: labelFromIso(dateKey), rowCount: 1 });
    } else if (dateCellHadContent) {
      // Something was typed/pasted in the DATE cell but none of the known
      // formats could make sense of it — flag it rather than drop it.
      undatedCount += 1;
    }

    rows.push({
      rowIndex: r + 1, // 1-indexed spreadsheet row, kept for traceability in the UI
      ttUniquePartNumber,
      itemDescription: itemDescription || ttUniquePartNumber || "(no description)",
      dateKey: dateKey || (dateCellHadContent ? UNDATED : null),
      dateLabel: dateKey ? labelFromIso(dateKey) : null,
      dateRaw: dateRaw != null ? String(dateRaw) : null,
      dateUnrecognized: !dateKey && dateCellHadContent,
      ratePerUnit,
      unit,
      orderedQuantity,
      receivedQuantity,
      // What to default the "quantity received" box to when this row is
      // previewed — the sheet's own received figure, falling back to what
      // was ordered. Always editable before commit.
      suggestedQuantity: receivedQuantity || orderedQuantity || null,
    });
  }

  const dates = [...dateMap.values()].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  if (undatedCount > 0) {
    dates.push({
      value: UNDATED,
      label: "Unrecognized date — needs review",
      rowCount: undatedCount,
    });
  }

  // Non-empty header cells, so the UI can offer them in a "read this field
  // from column ..." picker, plus which column each field ended up using.
  const headers = (grid[headerRowIdx] || [])
    .map((cell, i) => ({ index: i, text: norm(cell) }))
    .filter((h) => h.text)
    .map((h) => ({ index: h.index, label: `${xlsx.utils.encode_col(h.index)} · ${h.text}` }));
  const columns = {
    received: idx.received,
    ordered: idx.ordered,
    rate: idx.rate,
    unit: idx.unit,
  };

  return { sheetName: name, availableSheets, headerRowIndex: headerRowIdx, headers, columns, rows, dates };
}