import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X } from "lucide-react";

/*
  A small, self-contained "search an existing part and pick one" box.
  Used wherever a new/alternate part needs to be linked to a part already
  in the master (e.g. "this is an accepted substitute for TT0402...").

  Deliberately shows a real dropdown of matches (not just "take the first
  result") since part descriptions are often similar enough that picking
  the wrong one silently would be worse than the extra click.
*/
export default function AlternatePartPicker({ value, onChange, placeholder }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: q } });
        setResults(Array.isArray(data) ? data.slice(0, 8) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [term]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-xs">
        <span className="font-mono bg-white rounded px-1.5 py-0.5 break-all">{value.ttUniquePartNumber}</span>
        <span className="flex-1 min-w-0 break-words">{value.itemDescription}</span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTerm("");
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Clear selected part"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || "Search part number or description"}
          className="h-8 pl-7 text-xs"
        />
        {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate max-h-56 overflow-y-auto">
          {results.map((p) => (
            <button
              key={p._id}
              type="button"
              className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left text-xs bg-card hover:bg-accent"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              <span className="font-mono bg-muted rounded px-1.5 py-0.5 shrink-0 break-all">
                {p.ttUniquePartNumber}
              </span>
              <span className="min-w-0 break-words">{p.itemDescription}</span>
            </button>
          ))}
        </div>
      )}
      {open && !searching && term.trim() && results.length === 0 && (
        <div className="absolute z-[100] mt-1 w-full rounded-md border border-border bg-card shadow-xl isolate px-2.5 py-1.5 text-xs text-muted-foreground">
          No parts match "{term.trim()}"
        </div>
      )}
    </div>
  );
}