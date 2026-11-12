/*
  Suggests parts-master matches for rows of an imported kit / BOM sheet that
  carry no usable TTZ part number — e.g. a BOM exported straight from a PCB
  tool, which only has Value / Part type / Manufacturer part number /
  Footprint.

  Matching, strongest first (score is 0-100, shown to the admin):
    100  same manufacturer part number (ignoring case, spaces, punctuation;
         "PDTC114ET,215" and "TS4148/IN4148" are also tried piece by piece)
     85  one manufacturer part number starts with the other
     75  the sheet's manufacturer part number appears in the part's description
   <=60  the row's value / part type / package size appear in the part's
         description (e.g. "10k" + "Resistor" + "1206")

  A row is auto-matched ONLY when it had no TTZ code on the sheet and exactly
  one part in the master has the same manufacturer part number. Everything
  else is returned as a ranked suggestion list for the admin to confirm.

  Read-only: nothing here writes to the database.
*/
import Part from "../models/Part.js";

const alnum = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Whole MPN (alphanumerics only) plus each piece when several are packed
// into one cell ("A/B", "A,B"). Pieces shorter than 4 chars are ignored —
// too generic to identify anything ("215" in "PDTC114ET,215").
const mpnTokens = (s) => {
  const whole = alnum(s);
  const pieces = String(s ?? "")
    .toUpperCase()
    .split(/[\n,/;|]+/)
    .map(alnum)
    .filter((t) => t.length >= 4);
  return [...new Set([whole, ...pieces].filter((t) => t.length >= 4))];
};

const SIZE_RE = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[^0-9]|$)/;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const descriptionTokens = (row) => {
  const valueToks = String(row.value ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9.µ]+/)
    .filter((w) => w.length >= 2);
  const typeToks = String(row.partType ?? "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 3);
  const size = String(row.footprint ?? "").match(SIZE_RE);
  return {
    value: [...new Set(valueToks)],
    other: [...new Set([...typeToks, ...(size ? [size[1]] : [])])],
  };
};

// Token must start on a boundary and not run into more digits, so "10K"
// matches "10K OHM" / "10KOHM" but not "100K" or "210K".
// A bare number ("100") must not match a scaled value ("100K", "100M", "100U")
// — 100 ohm and 100 kilohm are different parts.
const hasToken = (hay, tok) => {
  const after = /[0-9.]$/.test(tok) ? "(?![0-9KMGUNPµ])" : "(?![0-9])";
  return new RegExp(`(?<![A-Z0-9.])${escapeRx(tok)}${after}`).test(hay);
};

const publicPart = (p, score, reason) => ({
  _id: p._id,
  ttUniquePartNumber: p.ttUniquePartNumber,
  itemDescription: p.itemDescription,
  manufacturerPartNumber: p.manufacturerPartNumber || "",
  quantityInStock: p.quantityInStock ?? 0,
  unit: p.unit || "",
  score,
  reason,
});

/**
 * Mutates `rows` (the parsed sheet rows): for every row without a matchedPart
 * it either auto-matches (see header) or attaches `suggestions`.
 */
export async function attachPartSuggestions(rows) {
  const open = rows.filter((r) => !r.matchedPart);
  if (!open.length) return rows;

  const parts = await Part.find({})
    .select("ttUniquePartNumber manufacturerPartNumber itemDescription typeOfPart quantityInStock unit")
    .lean();

  const index = parts.map((p) => ({
    p,
    tokens: mpnTokens(p.manufacturerPartNumber),
    whole: alnum(p.manufacturerPartNumber),
    descAlnum: alnum(p.itemDescription),
    hay: `${p.itemDescription || ""} ${p.typeOfPart || ""} ${p.manufacturerPartNumber || ""}`.toUpperCase(),
  }));

  for (const row of open) {
    const rowTokens = mpnTokens(row.manufacturerPartNumber);
    const rowWhole = alnum(row.manufacturerPartNumber);
    const dt = descriptionTokens(row);
    const hits = new Map(); // part _id -> { part, score, reason }
    const exactIds = [];

    const offer = (p, score, reason) => {
      const key = String(p._id);
      const cur = hits.get(key);
      if (!cur || score > cur.score) hits.set(key, { p, score, reason });
    };

    for (const e of index) {
      if (rowTokens.length && e.tokens.some((t) => rowTokens.includes(t))) {
        offer(e.p, 100, "Same manufacturer part number");
        exactIds.push(String(e.p._id));
        continue;
      }
      if (rowWhole.length >= 6 && e.whole.length >= 6 && (rowWhole.startsWith(e.whole) || e.whole.startsWith(rowWhole))) {
        offer(e.p, 85, "Similar manufacturer part number");
        continue;
      }
      if (rowWhole.length >= 6 && e.descAlnum.includes(rowWhole)) {
        offer(e.p, 75, "Mfr part number appears in the description");
        continue;
      }
      if (dt.value.length) {
        const valueHit = dt.value.filter((t) => hasToken(e.hay, t)).length;
        if (valueHit > 0) {
          const otherHit = dt.other.filter((t) => hasToken(e.hay, t)).length;
          const total = dt.value.length + dt.other.length;
          const score = Math.round((60 * (valueHit + otherHit)) / total);
          if (score >= 30) offer(e.p, score, "Description matches value / type / size");
        }
      }
    }

    // Unique exact MPN hit on a row with no TTZ code on the sheet -> auto-match.
    if (!row.ttUniquePartNumber && exactIds.length === 1) {
      const p = hits.get(exactIds[0]).p;
      row.matchedPart = {
        ttUniquePartNumber: p.ttUniquePartNumber,
        itemDescription: p.itemDescription,
        quantityInStock: p.quantityInStock ?? 0,
        unit: p.unit || "",
      };
      row.ttUniquePartNumber = p.ttUniquePartNumber;
      row.matchSource = "mfr-part-number";
      continue;
    }

    row.suggestions = [...hits.values()]
      .sort((a, b) => b.score - a.score || (b.p.quantityInStock || 0) - (a.p.quantityInStock || 0))
      .slice(0, 5)
      .map(({ p, score, reason }) => publicPart(p, score, reason));
  }
  return rows;
}