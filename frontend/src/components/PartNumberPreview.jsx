import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Hash, PackageSearch } from "lucide-react";

/*
  Sits right under the company code / category / part type-batch no. fields
  on every "new part" entry form (manual Step 4 entry and the vendor-sheet
  import row editor). TT UNIQUE PART NUMBER = COMPANY CODE + CATEGORY +
  PART TYPE/BATCH NO. (see Part.js) — as soon as all three are typed, this
  builds that number the same way the backend will and shows it live, so
  the person can see exactly what they're about to create instead of only
  finding out the code once the part is saved.

  It's also checked against the parts master as it's typed (debounced,
  same pattern as PartDuplicateCheck), so a genuine clash — this exact
  combination already belongs to a part — surfaces immediately with an
  option to use the existing part, instead of only surfacing later as a
  "Part number already exists" error from buildPartNumber() when the
  request is approved/committed.
*/
export default function PartNumberPreview({ companyCode, category, partTypeBatchNo, onUseExisting }) {
  const [existingPart, setExistingPart] = useState(null);
  const [checking, setChecking] = useState(false);

  const parts = [companyCode, category, partTypeBatchNo].map((s) => String(s || "").trim());
  const suggested = parts.every(Boolean) ? parts.join("").toUpperCase() : null;

  useEffect(() => {
    if (!suggested) {
      setExistingPart(null);
      return undefined;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts/lookup", { params: { partNumber: suggested } });
        // /parts/lookup also matches on manufacturer part number, but a
        // coincidental hit there doesn't mean THIS number is taken — only a
        // match on the TT number itself is a real clash for this check.
        setExistingPart(data?.matched && data.part?.ttUniquePartNumber === suggested ? data.part : null);
      } catch {
        setExistingPart(null);
      } finally {
        setChecking(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [suggested]);

  if (!suggested) return null;

  if (existingPart) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p>
            <span className="font-mono bg-white/70 rounded px-1.5 py-0.5">{suggested}</span> is already in the
            master — <span className="break-words">{existingPart.itemDescription}</span>. Change the company code,
            category or part type/batch no. so this doesn't clash, or use the existing part instead.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onUseExisting?.(existingPart)}>
            <PackageSearch className="h-3.5 w-3.5 mr-1.5" />
            Use {existingPart.ttUniquePartNumber} instead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Hash className="h-3 w-3 shrink-0" />
      Suggested part number:{" "}
      <span className="font-mono bg-muted rounded px-1.5 py-0.5">{suggested}</span>
      {checking && <span className="italic">checking…</span>}
    </p>
  );
}
