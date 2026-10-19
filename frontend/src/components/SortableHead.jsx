import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";

/*
  Click-to-sort table headers.

    const { sort, toggle, apply } = useSort();
    const rows = apply(items, { vendor: (r) => r.vendor?.companyName, amount: (r) => r.amount });
    <SortableHead label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} />

  Each click cycles ascending -> descending -> back to the original order.
  Empty values always sink to the bottom, whichever way it is sorted.
*/

export function useSort() {
  const [sort, setSort] = useState(null); // { key, dir: "asc" | "desc" } | null

  const toggle = useCallback((key) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }, []);

  const apply = useCallback(
    (rows, getters) => {
      const get = sort && getters[sort.key];
      if (!get) return rows;
      const factor = sort.dir === "asc" ? 1 : -1;
      const isEmpty = (v) => v === null || v === undefined || v === "" || Number.isNaN(v);
      return [...rows].sort((a, b) => {
        const x = get(a);
        const y = get(b);
        if (isEmpty(x) && isEmpty(y)) return 0;
        if (isEmpty(x)) return 1;
        if (isEmpty(y)) return -1;
        if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
        return (
          String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * factor
        );
      });
    },
    [sort]
  );

  return { sort, toggle, apply };
}

export function SortableHead({ label, sortKey, sort, onSort, className, align = "left" }) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead
      className={cn(align === "right" && "text-right", className)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label.toLowerCase()}`}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active && "text-foreground"
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} />
      </button>
    </TableHead>
  );
}