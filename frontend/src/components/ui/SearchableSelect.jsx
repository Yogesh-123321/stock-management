import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  Dropdown for picking one option out of a list that's already loaded on the
  client (no API call) — a drop-in replacement for the Radix <Select> when
  the list is long enough that scanning it by eye isn't practical. Radix's
  Select has no filter box built in; this adds a search field at the top of
  the list instead, filtering as you type.

  options            [{ value, label, sublabel? }] — sublabel is optional,
                      smaller, muted text under the label (both are matched
                      against the search term)
  value               the selected option's value ("" for none)
  onChange            (value) => void
  placeholder         shown on the closed trigger when nothing is picked
  searchPlaceholder   shown in the search box
  emptyText           shown when nothing matches the search term
  disabled
*/
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No match.",
  className,
  contentClassName,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const list = options || [];
  const selected = list.find((o) => o.value === value) || null;

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setTerm("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Focus the search box the moment the list opens, so typing works right away.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) => `${o.label} ${o.sublabel || ""}`.toLowerCase().includes(q));
  }, [list, term]);

  const pick = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
    setTerm("");
  };

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => !o);
  };

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-[200] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl",
            contentClassName
          )}
        >
          <div className="relative border-b border-border p-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8 text-sm"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setTerm("");
                } else if (e.key === "Enter" && filtered.length === 1) {
                  pick(filtered[0]);
                }
              }}
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted-foreground">{emptyText}</li>
            )}
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  onClick={() => pick(opt)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm hover:bg-secondary",
                    opt.value === value ? "font-semibold text-foreground" : "text-foreground/90"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="block truncate text-xs text-muted-foreground">{opt.sublabel}</span>
                    )}
                  </span>
                  {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}