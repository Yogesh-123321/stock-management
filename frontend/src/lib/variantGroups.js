/*
  Grouping of "family" numbers — a base number plus its lettered variants.

    document-1, document-1a, document-1-b   ->  family "document-1"
    kit 12, 12-a, 12-b                      ->  family "12"

  A single letter that directly follows a digit (optionally behind a space,
  "-" or "_") and sits at the end of the number, or just before a "/" "-" "_"
  or space section, marks a variant; the number without that letter is the
  family key.
  Anything else (no trailing letter, or a letter that isn't preceded by a
  digit, e.g. "PO-ABC") is its own base and its own family.

  Matching is case-insensitive, so "Kit-12A" and "kit-12-a" land together.
*/

// digit, optional separator, ONE letter, then end-of-number or a separator —
// so both a trailing letter ("12-a", "0142a") and a letter in the middle of a
// number ("TISPL/PO/28A/26-27") count as a variant marker.
const VARIANT_RE = /^(.*\d)[\s_-]*([a-z])(?=$|[\s/_-])(.*)$/i;

/** Splits a number into { base, suffix } — suffix is "" for a base entry. */
export function splitVariant(raw) {
  const text = String(raw ?? "").trim();
  const m = text.match(VARIANT_RE);
  if (!m) return { base: text, suffix: "" };
  // The base is the number with the variant letter taken out:
  // "TISPL/PO/28A/26-27" -> "TISPL/PO/28/26-27".
  return { base: (m[1] + m[3]).trim(), suffix: m[2].toLowerCase() };
}

/** Case-insensitive grouping key for a number. */
export const familyKeyOf = (raw) => splitVariant(raw).base.toLowerCase();

/**
  Groups items into families.

  items      array of anything
  numberOf   (item) => the document / kit number text used for grouping
  Returns    [{ key, label, members: [item, …] }] — families sorted naturally,
             members sorted base first, then a, b, c…
*/
export function groupIntoFamilies(items, numberOf) {
  const map = new Map();
  for (const item of items || []) {
    const raw = numberOf(item);
    const { base, suffix } = splitVariant(raw);
    const key = base.toLowerCase();
    if (!map.has(key)) map.set(key, { key, label: base, members: [] });
    map.get(key).members.push({ item, suffix, raw: String(raw ?? "").trim() });
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const families = [...map.values()];
  for (const f of families) {
    f.members.sort((a, b) => {
      if (!a.suffix && b.suffix) return -1;
      if (a.suffix && !b.suffix) return 1;
      return collator.compare(a.suffix, b.suffix) || collator.compare(a.raw, b.raw);
    });
    // Prefer the base member's own spelling as the family label.
    const baseMember = f.members.find((m) => !m.suffix);
    f.label = baseMember ? baseMember.raw : f.label;
    f.members = f.members.map((m) => m.item);
  }
  families.sort((a, b) => collator.compare(a.label, b.label));
  return families;
}