import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import { Loader2, PackagePlus, PackageSearch, Sparkles } from "lucide-react";

/*
  Shown for a sheet row whose part number wasn't found in the master ("not
  found" / "No code on sheet"). Before letting the operator fall through to
  creating a brand new part number, this makes them either:

    1. actively search the master themselves (part number or description), or
    2. glance at auto-suggested parts whose description overlaps this row's
       description (same /parts/suggest keyword search PartDuplicateCheck
       uses), and pick one if it's actually the same part, or
    3. explicitly choose "Create new part number" if neither turns up
       anything — only then does the new-part form (and eventually the
       admin-approval request) appear.

  A row can't silently become "new" just because nothing was typed — either
  an existing part is picked here, or the operator has to actively click
  through to create one.
*/
export default function PartSheetMatchResolver({ itemDescription, onSelectExisting, onCreateNew }) {
  const [suggestions, setSuggestions] = useState([]);
  const [checking, setChecking] = useState(false);

  const descTerm = String(itemDescription || "").trim();

  useEffect(() => {
    if (!descTerm || descTerm.length < 3) {
      setSuggestions([]);
      return undefined;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts/suggest", { params: { description: descTerm } });
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        setSuggestions([]);
      } finally {
        setChecking(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [descTerm]);

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 space-y-2.5">
      <p className="text-xs text-amber-900">
        This row's part number isn't in the master yet. Search for the part it should match, or pick one of the
        suggestions below before creating a new part number.
      </p>

      <div className="space-y-1">
        <p className="text-[11px] font-medium text-amber-900">Search the parts master</p>
        <AlternatePartPicker
          value={null}
          onChange={(part) => onSelectExisting?.(part)}
          placeholder="Search part number or description"
        />
      </div>

      {checking && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-800">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking the master for similar descriptions…
        </p>
      )}

      {!checking && suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-900">
            <Sparkles className="h-3 w-3" />
            Suggested matches by description
          </p>
          <ul className="space-y-1">
            {suggestions.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white/60 p-1.5 text-xs"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono bg-muted rounded px-1.5 py-0.5 break-all">
                      {p.ttUniquePartNumber}
                    </span>
                    {p.manufacturerPartNumber && (
                      <span className="text-[11px] text-muted-foreground">Mfr: {p.manufacturerPartNumber}</span>
                    )}
                  </span>
                  <span className="block break-words">{p.itemDescription}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => onSelectExisting?.(p)}
                >
                  <PackageSearch className="h-3.5 w-3.5 mr-1.5" />
                  Use this
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button type="button" size="sm" variant="secondary" onClick={() => onCreateNew?.()}>
        <PackagePlus className="h-3.5 w-3.5 mr-1.5" />
        None of these — create a new part number
      </Button>
    </div>
  );
}