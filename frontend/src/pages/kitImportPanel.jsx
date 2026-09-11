import { useState } from "react";
import toast from "react-hot-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import PartSheetMatchResolver from "@/components/PartSheetMatchResolver";
import {
  FileSpreadsheet,
  UploadCloud,
  ArrowLeft,
  PackageCheck,
  ShieldAlert,
  PackagePlus,
  X,
} from "lucide-react";

/*
  Kits -> "Import from Excel". Upload a kit / BOM workbook (e.g. the
  iMoniCAM BOM template), it's parsed read-only on the server — nothing is
  saved yet.

  Every row the sheet's ttUniquePartNumber column didn't match to a part
  already in the master needs a decision before it's handed off: search the
  master (part number or description/value) and pick the part it should
  actually be, glance at auto-suggested parts whose description overlaps
  this row, or explicitly confirm it as a new part number that isn't in the
  master yet. Only once every row is resolved one way or the other does it
  get handed back to the caller (KitEditor, in Kits.jsx), which drops the
  rows straight into its editable item table for review before the template
  is actually saved. There is no separate "commit" step here on purpose: the
  same POST /api/kits the manual "New kit" flow uses is reused once the
  admin is happy with the rows.
*/
export default function KitImportPanel({ onImported, onClose }) {
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { sheetName, kitName, kitCode, rows: [...] } — raw server response
  const [rows, setRows] = useState([]); // editable copy of parsed.rows for the resolver UI

  const handleParse = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Choose the kit / BOM workbook (.xlsx or .xls) first");
      return;
    }
    setParsing(true);
    setParsed(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/kits/import/parse", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (!data.rows || data.rows.length === 0) {
        toast.error("No usable item rows were found on that sheet");
        return;
      }
      setParsed(data);
      setRows(
        data.rows.map((r) => ({
          ...r,
          // Whether this row should be imported at all — unchecking it
          // means "I don't want to pick a part for this sheet row", and it
          // won't need resolving or be handed off to the kit's item table.
          included: true,
          // Only unmatched rows need this — a row that already matched
          // straight from the sheet is resolved from the start.
          showCreateForm: false,
        }))
      );
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not read that spreadsheet");
    } finally {
      setParsing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setFileInputKey((k) => k + 1);
    setParsed(null);
    setRows([]);
  };

  const updateRow = (rowIndex, patch) => {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  };

  const isResolved = (r) => !r.included || !!r.matchedPart || r.showCreateForm;

  const includedRows = rows.filter((r) => r.included);
  const excludedCount = rows.length - includedRows.length;
  const matchedCount = includedRows.filter((r) => r.matchedPart).length;
  const unresolvedCount = rows.filter((r) => !isResolved(r)).length;
  const newCount = includedRows.filter((r) => !r.matchedPart && r.showCreateForm).length;

  const canUseRows = includedRows.length > 0 && unresolvedCount === 0;

  const handleUseRows = () => {
    if (includedRows.length === 0) {
      toast.error("At least one row needs to stay checked to import anything");
      return;
    }
    if (!canUseRows) {
      toast.error("Resolve every unmatched row first — search for the real part or confirm it as new");
      return;
    }
    onImported({
      ...parsed,
      rows: includedRows.map(({ showCreateForm, included, ...r }) => r),
    });
  };

  return (
    // min-h-0 + flex-1 (not h-full) so this actually shrinks to fit the
    // dialog's max-h-[90vh] wrapper in Kits.jsx — h-full is a percentage
    // and can't resolve against an ancestor that only sets max-height, so
    // without this the panel grows past the cap and the overflow-y-auto
    // sections below never get a bounded height to scroll within (the
    // extra rows just get clipped by the wrapper's overflow-hidden
    // instead of scrolling).
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <FileSpreadsheet className="h-4 w-4 shrink-0" /> Import kit from Excel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is saved here — the rows load into the item table on the previous screen so you can review
            and edit them before saving.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!parsed && (
        <form onSubmit={handleParse} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Kit / BOM workbook (.xlsx / .xls)</Label>
            <Input
              key={fileInputKey}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <p className="text-xs text-muted-foreground">
              Column headers like "TTZ Part" / "Qty" (or common variants) are auto-detected wherever they sit on
              the sheet — the header row itself doesn't need to be in a fixed spot.
            </p>
          </div>
          <div className="flex justify-between pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={parsing}>
              <UploadCloud className="h-4 w-4 mr-2" />
              {parsing ? "Reading sheet…" : "Read sheet"}
            </Button>
          </div>
        </form>
      )}

      {parsed && (
        <>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="success" className="gap-1">
                <PackageCheck className="h-3 w-3" />
                {matchedCount} matched to an existing part
              </Badge>
              {newCount > 0 && (
                <Badge variant="warning" className="gap-1">
                  <PackagePlus className="h-3 w-3" />
                  {newCount} confirmed as new
                </Badge>
              )}
              {unresolvedCount > 0 && (
                <Badge variant="warning" className="gap-1">
                  <ShieldAlert className="h-3 w-3" />
                  {unresolvedCount} still need resolving
                </Badge>
              )}
              {excludedCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  {excludedCount} excluded (unchecked)
                </Badge>
              )}
              <span className="text-muted-foreground">from &ldquo;{parsed.sheetName}&rdquo;</span>
            </div>

            {(parsed.kitName || parsed.kitCode) && (
              <p className="text-xs text-muted-foreground">
                Detected {parsed.kitName ? <>name &ldquo;<strong>{parsed.kitName}</strong>&rdquo;</> : null}
                {parsed.kitName && parsed.kitCode ? " and " : null}
                {parsed.kitCode ? <>code &ldquo;<strong>{parsed.kitCode}</strong>&rdquo;</> : null} — both stay
                editable on the next screen.
              </p>
            )}

            {unresolvedCount > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                {unresolvedCount} row(s) below didn't match anything in the master — search for the part each one
                should be, or confirm it as a new part number, before these rows can be used.
              </p>
            )}

            <div className="space-y-2">
              {rows.map((r) => (
                <KitImportRow key={r.rowIndex} row={r} updateRow={updateRow} />
              ))}
            </div>
          </div>

          <div className="shrink-0 flex justify-between border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Choose a different file
            </Button>
            <Button type="button" onClick={handleUseRows} disabled={!canUseRows}>
              Use these {includedRows.length} row(s)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function KitImportRow({ row, updateRow }) {
  const resolved = !row.included || !!row.matchedPart || row.showCreateForm;
  // Kit sheets don't carry a free-text "description" column the way stock
  // sheets do — "value" (e.g. "10K", "100nF") plus part type is the closest
  // analog, and is what /parts/suggest is given to search on.
  const descriptionTerm = [row.value, row.partType].filter(Boolean).join(" ");

  return (
    <div
      className={
        "rounded-md border border-border p-2.5 space-y-2" +
        (resolved ? "" : " border-amber-300") +
        (row.included ? "" : " opacity-60")
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label className="flex shrink-0 items-center gap-1.5" title="Include this row when importing">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={row.included}
            onChange={(e) => updateRow(row.rowIndex, { included: e.target.checked })}
          />
        </label>
        <span className="text-muted-foreground w-16 shrink-0">{row.referenceDesignator || "—"}</span>
        <span className="min-w-0 flex-1 break-words">{row.value || "—"}</span>
        <span className="font-mono-tech shrink-0">
          {row.ttUniquePartNumber || <span className="text-amber-700 font-sans">no code on sheet</span>}
        </span>
        <span className="shrink-0">
          {!row.included ? (
            <Badge variant="secondary">Excluded</Badge>
          ) : row.matchedPart ? (
            <Badge variant="success">Matched</Badge>
          ) : row.showCreateForm ? (
            <Badge variant="warning" className="gap-1">
              <PackagePlus className="h-3 w-3" />
              New
            </Badge>
          ) : (
            <Badge variant="warning">Unresolved</Badge>
          )}
        </span>
      </div>

      {row.included && !row.matchedPart && !row.showCreateForm && (
        <PartSheetMatchResolver
          itemDescription={descriptionTerm}
          onSelectExisting={(part) =>
            updateRow(row.rowIndex, {
              matchedPart: part,
              ttUniquePartNumber: part.ttUniquePartNumber,
              showCreateForm: false,
            })
          }
          onCreateNew={() => updateRow(row.rowIndex, { showCreateForm: true })}
        />
      )}

      {row.included && !row.matchedPart && row.showCreateForm && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => updateRow(row.rowIndex, { showCreateForm: false })}
          >
            ← Back to search / suggestions
          </Button>
          <div className="space-y-1 max-w-xs">
            <Label className="text-[11px]">TT unique part number</Label>
            <Input
              value={row.ttUniquePartNumber}
              onChange={(e) => updateRow(row.rowIndex, { ttUniquePartNumber: e.target.value.toUpperCase() })}
              className="h-8 text-xs font-mono-tech"
              placeholder="required"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            This part number isn't in the master yet — it'll still show as "Not in master" on the kit's item
            table until it's created there (via Parts or a stock receipt).
          </p>
        </div>
      )}
    </div>
  );
}