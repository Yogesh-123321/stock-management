import { useCallback, useMemo, useState } from "react";
import { familyKeyOf, splitVariant } from "@/lib/variantGroups";

/*
  Folds a (already sorted / filtered) list of rows into families for a table:
  one row per family — the base entry — with its variants (12-a, 12-b …)
  hidden underneath until the family is expanded.

    const fam = useFamilyRows(sortedRows, (r) => r.documentNumber, { expandAll: !!search });
    fam.rows.map(({ row, depth, count, key, isOpen }) => …)

  rows without a number are never grouped. `expandAll` (e.g. while searching)
  shows every variant so a matching "12-b" is never hidden.
  The order of families follows the order of `rows`, so column sorting still works.
*/
export function useFamilyRows(rows, numberOf, { expandAll = false, mode = "expand", prefer } = {}) {
  const [open, setOpen] = useState({});
  // mode "pick": one row per family; `picked[key]` is the member id shown in it.
  const [picked, setPicked] = useState({});
  const pick = useCallback((key, id) => setPicked((p) => ({ ...p, [key]: id })), []);

  const toggle = useCallback((key) => setOpen((o) => ({ ...o, [key]: !o[key] })), []);

  const folded = useMemo(() => {
    const order = [];
    const map = new Map();
    (rows || []).forEach((row, i) => {
      const num = String(numberOf(row) ?? "").trim();
      const key = num ? familyKeyOf(num) : `__row_${row?._id ?? i}`;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key).push(row);
    });

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const out = [];
    for (const key of order) {
      const members = map.get(key);
      members.sort((a, b) => {
        const sa = splitVariant(numberOf(a)).suffix;
        const sb = splitVariant(numberOf(b)).suffix;
        if (!sa && sb) return -1;
        if (sa && !sb) return 1;
        return collator.compare(sa, sb);
      });
      if (mode === "pick") {
        const want = picked[key];
        const shown =
          members.find((m) => String(m._id) === String(want)) ||
          (prefer && members.length > 1 ? members.find(prefer) : null) ||
          members[0];
        out.push({ row: shown, depth: 0, count: members.length, key, members, pick });
        continue;
      }
      const [head, ...rest] = members;
      const isOpen = expandAll || !!open[key];
      out.push({ row: head, depth: 0, count: members.length, key, isOpen, members });
      if (isOpen) rest.forEach((row) => out.push({ row, depth: 1, count: members.length, key, isOpen, members }));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, open, expandAll, mode, picked]);

  return { rows: folded, toggle };
}