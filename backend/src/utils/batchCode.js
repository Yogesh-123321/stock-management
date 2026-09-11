/*
  Generates the "batch code" stamped onto a StockEntry once its tax
  invoice arrives — format WW/YY (2-digit ISO week number / 2-digit year),
  e.g. "37/26" for ISO week 37 of 2026. This is entirely separate from a
  part's own PART TYPE/BATCH NO. (the 3rd segment of its TT unique part
  number, see Part.js / generatePartNumber.js) — that identifies a part
  *type*; this identifies *which delivery* a given quantity of stock came
  in on, for lot tracking / FIFO-style issuing later.

  Deliberately keyed off the tax invoice's own invoiceDate, never off
  "today" or the stock entry's createdAt — material can be entered days
  or weeks before its invoice arrives, and the batch is meant to reflect
  when the vendor billed it, not when it was keyed into the system.
*/

// ISO 8601 week number + week-year for a given date, computed in UTC so
// the local timezone of the server can never shift a date across the
// week boundary.
function isoWeekAndYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Mon=0 .. Sun=6, then jump to the Thursday of this ISO week — the ISO
  // week-year is defined as whichever calendar year that Thursday falls in.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return { week, isoYear };
}

/*
  generateBatchCode(date) -> "WW/YY", or null if date isn't a valid date.
  Callers should pass the tax invoice's invoiceDate — see the comment at
  the top of this file for why.
*/
export const generateBatchCode = (date) => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const { week, isoYear } = isoWeekAndYear(d);
  const ww = String(week).padStart(2, "0");
  const yy = String(isoYear % 100).padStart(2, "0");
  return `${ww}/${yy}`;
};