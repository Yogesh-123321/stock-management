import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";

// Searchable multi-part picker used by the custom stock report: type a part
// number or any keyword from the description, click a match to add it, click
// the x on a chip to drop it. Searches the same /parts endpoint as the rest of
// the page, debounced.
export default function ReportPartPicker({ selected, onChange }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: q, limit: 30 } });
        if (alive) setResults(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [term]);

  const add = (part) => {
    if (!selected.some((p) => p._id === part._id)) {
      onChange([
        ...selected,
        { _id: part._id, ttUniquePartNumber: part.ttUniquePartNumber, itemDescription: part.itemDescription },
      ]);
    }
    setTerm("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span
              key={p._id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
              title={p.itemDescription}
            >
              <span className="font-mono">{p.ttUniquePartNumber}</span>
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x._id !== p._id))}
                className="text-muted-foreground hover:text-foreground"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search part no. or description…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
      </div>
      {open && term.trim() && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border bg-card">
          {searching && <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>}
          {!searching && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">No part matches “{term.trim()}”.</li>
          )}
          {results.map((p) => {
            const already = selected.some((x) => x._id === p._id);
            return (
              <li key={p._id}>
                <button
                  type="button"
                  disabled={already}
                  onClick={() => add(p)}
                  className="flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{p.ttUniquePartNumber}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.itemDescription}</span>
                  </span>
                  {already && <span className="shrink-0 text-[11px] text-muted-foreground">Added</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}