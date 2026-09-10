import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AlertTriangle, PackageSearch, ShieldCheck } from "lucide-react";

/*
  Sits inside the "new part" entry forms (manual Step 4 entry and the
  vendor-sheet import row editor) wherever a manufacturer part number +
  item description are being typed for a part that supposedly isn't in the
  master yet. Two checks run against the parts master as the person types:

  1. Exact check — does this manufacturer part number already exist?
       - description matches (or nothing typed yet) -> quiet "matches"
         confirmation, with a one-click "Use this part" that hands the
         existing part back to the caller instead of creating a duplicate.
       - description differs -> loud warning showing BOTH descriptions side
         by side, and the caller is told the pre-existing description so it
         can be locked in instead of a second, conflicting one being saved
         under the same part number.
  2. Fuzzy check (only runs when #1 found nothing) — keyword search across
     the master's descriptions, so a part that's already there under a
     different manufacturer part number / spelling still gets caught before
     a duplicate is created.

  Fully self-contained: does its own debounced fetching, renders its own
  banner, and only talks to the parent via onUseExisting.
*/
export default function PartDuplicateCheck({ manufacturerPartNumber, itemDescription, onUseExisting }) {
  const [exactMatch, setExactMatch] = useState(null); // part object | null
  const [checkingExact, setCheckingExact] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [checkingSuggestions, setCheckingSuggestions] = useState(false);

  const mfrTerm = (manufacturerPartNumber || "").trim();
  const descTerm = (itemDescription || "").trim();

  // 1. Exact manufacturer-part-number check.
  useEffect(() => {
    if (!mfrTerm) {
      setExactMatch(null);
      return undefined;
    }
    setCheckingExact(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts/lookup", { params: { partNumber: mfrTerm } });
        setExactMatch(data?.matched ? data.part : null);
      } catch {
        setExactMatch(null);
      } finally {
        setCheckingExact(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [mfrTerm]);

  // 2. Keyword/description suggestions — only worth running once we know the
  // manufacturer part number itself isn't an exact hit.
  useEffect(() => {
    if (exactMatch || !descTerm || descTerm.length < 3) {
      setSuggestions([]);
      return undefined;
    }
    setCheckingSuggestions(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts/suggest", {
          params: { description: descTerm, excludePartNumber: mfrTerm || undefined },
        });
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      } finally {
        setCheckingSuggestions(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [exactMatch, descTerm, mfrTerm]);

  const normalize = (s) => String(s || "").trim().toLowerCase();
  const descriptionMatches = exactMatch ? normalize(exactMatch.itemDescription) === normalize(descTerm) : true;

  if (mfrTerm && exactMatch) {
    return descriptionMatches ? (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-900 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p>
            <span className="font-mono bg-white/70 rounded px-1.5 py-0.5">{exactMatch.ttUniquePartNumber}</span>{" "}
            already exists in the master with this manufacturer part number and the same description.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onUseExisting?.(exactMatch)}>
            <PackageSearch className="h-3.5 w-3.5 mr-1.5" />
            Use this part instead of creating a new one
          </Button>
        </div>
      </div>
    ) : (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p>
            Manufacturer part number <span className="font-mono bg-white/70 rounded px-1.5 py-0.5">{mfrTerm}</span>{" "}
            is already used by{" "}
            <span className="font-mono bg-white/70 rounded px-1.5 py-0.5">{exactMatch.ttUniquePartNumber}</span> —
            but with a different description:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded border border-amber-200 bg-white/60 p-1.5">
              <p className="font-medium">Existing description</p>
              <p>{exactMatch.itemDescription}</p>
            </div>
            <div className="rounded border border-amber-200 bg-white/60 p-1.5">
              <p className="font-medium">You entered</p>
              <p>{descTerm || "—"}</p>
            </div>
          </div>
          <p>
            The same part number can't carry two descriptions. Use the existing part (with its existing
            description) below, or clear the manufacturer part number if this is genuinely a different part.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onUseExisting?.(exactMatch)}>
            <PackageSearch className="h-3.5 w-3.5 mr-1.5" />
            Use {exactMatch.ttUniquePartNumber} with its existing description
          </Button>
        </div>
      </div>
    );
  }

  if (!exactMatch && suggestions.length > 0) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-2">
        <p className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          This part number isn't in the master, but the description matches keywords on{" "}
          {suggestions.length === 1 ? "an existing part" : "existing parts"} already there — check it isn't a
          duplicate before sending this for approval:
        </p>
        <ul className="space-y-1">
          {suggestions.map((p) => (
            <li key={p._id} className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white/60 p-1.5">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono bg-muted rounded px-1.5 py-0.5">{p.ttUniquePartNumber}</span>
                  {p.manufacturerPartNumber && (
                    <span className="text-[11px] text-muted-foreground">Mfr: {p.manufacturerPartNumber}</span>
                  )}
                </span>
                <span className="block truncate">{p.itemDescription}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => onUseExisting?.(p)}
              >
                Use this
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (checkingExact || checkingSuggestions) {
    return <p className="text-xs text-muted-foreground">Checking against the parts master…</p>;
  }

  return null;
}