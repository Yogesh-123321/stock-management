import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import PartDuplicateCheck from "@/components/PartDuplicateCheck";
import PartNumberPreview from "@/components/PartNumberPreview";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import {
  FileSpreadsheet,
  UploadCloud,
  CalendarDays,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  ShieldAlert,
  GitBranchPlus,
  X,
} from "lucide-react";

/*
  Step 4 -> "Import from vendor sheet".

  1. upload   - operator attaches the vendor's own inward-stock workbook
                (e.g. the KKTRON sheet). It's parsed read-only on the server;
                nothing is booked yet.
  2. pick-date - every unique date found in the sheet's DATE column is shown;
                picking one filters the sheet down to that day's rows.
  3. preview  - every row for that date is listed. A row whose part number
                matched something already in the master database is ready to
                book immediately; everything else needs the missing details
                (company code / category / part type) filled in before it can
                be sent for admin approval, exactly like a manual "new part"
                line. Nothing reaches stock here — matched rows are booked
                straight away, unmatched rows raise a PartApprovalRequest and
                wait for the Parts section to approve them, same as always.
  4. done     - summary of what was booked vs. sent for approval.

  Vendor (and PO/PI, if any) come from the receiving wizard itself — the
  same vendor applies to every row in the sheet, matching how a single
  delivery is entered.
*/

const emptyNewPart = () => ({
  typeOfPart: "",
  manufacturerPartNumber: "",
  itemDescription: "",
  companyCode: "TT",
  category: "",
  partTypeBatchNo: "",
});

export default function ExcelImportPanel({ vendor, purchaseOrder, enteredBy, onImported, onClose }) {
  const [phase, setPhase] = useState("upload"); // upload -> pick-date -> preview -> done
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0); // bump to force-remount the <input type=file>
  const [parsing, setParsing] = useState(false);

  const [parsed, setParsed] = useState(null); // { sheetName, dates, rows }
  const [selectedDate, setSelectedDate] = useState(null);

  const [rows, setRows] = useState([]); // editable preview rows for the selected date
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null); // { createdEntries, createdApprovals, failedRows }

  // Wipes every trace of whatever was previously uploaded/parsed. Used both
  // when the operator explicitly asks to pick a different file, and right
  // before every parse request — so there's no code path where an old
  // file's dates/rows can still be showing after a new one is read. The
  // file input is remounted (via fileInputKey) rather than just cleared,
  // because some browsers don't fire a change event when the exact same
  // file is re-selected, which otherwise could silently resubmit stale data.
  const resetImport = () => {
    setFile(null);
    setFileInputKey((k) => k + 1);
    setParsed(null);
    setSelectedDate(null);
    setRows([]);
    setResult(null);
    setPhase("upload");
  };

  const handleParse = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Choose the vendor's stock sheet (.xlsx or .xls) first");
      return;
    }
    setParsing(true);
    setParsed(null); // never show a stale parse while a new one is in flight
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/stock-entries/import/parse", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setParsed(data);
      if (!data.dates || data.dates.length === 0) {
        toast.error("No usable dates were found on that sheet");
        return;
      }
      setPhase("pick-date");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not read that spreadsheet");
    } finally {
      setParsing(false);
    }
  };

  const pickDate = (dateValue) => {
    setSelectedDate(dateValue);
    const dayRows = parsed.rows
      .filter((r) => r.dateKey === dateValue)
      .map((r) => ({
        rowIndex: r.rowIndex,
        itemDescription: r.itemDescription,
        ttUniquePartNumber: r.ttUniquePartNumber,
        matchedPart: r.matchedPart,
        dateRaw: r.dateRaw,
        dateUnrecognized: r.dateUnrecognized,
        included: true,
        matchType: r.matchedPart ? "existing_part_number" : "new_part_number",
        isAlternate: false,
        alternateOfPart: null,
        quantityReceived: r.suggestedQuantity != null ? String(r.suggestedQuantity) : "",
        newPart: r.matchedPart
          ? emptyNewPart()
          : {
              ...emptyNewPart(),
              itemDescription: r.itemDescription,
              manufacturerPartNumber: r.ttUniquePartNumber || "",
            },
      }));
    setRows(dayRows);
    setPhase("preview");
  };

  const updateRow = (rowIndex, patch) => {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  };

  const updateNewPart = (rowIndex, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, newPart: { ...r.newPart, [field]: value } } : r))
    );
  };

  const includedRows = useMemo(() => rows.filter((r) => r.included), [rows]);
  const existingCount = includedRows.filter((r) => r.matchType === "existing_part_number").length;
  const newCount = includedRows.filter((r) => r.matchType === "new_part_number").length;

  const rowIsValid = (r) => {
    if (!r.included) return true; // skipped rows don't block submission
    const qty = Number(r.quantityReceived);
    if (!qty || qty < 1) return false;
    if (r.matchType === "existing_part_number") return !!r.matchedPart;
    if (r.isAlternate && !r.alternateOfPart) return false;
    return !!(r.newPart.itemDescription && r.newPart.companyCode && r.newPart.category && r.newPart.partTypeBatchNo);
  };

  const canCommit = includedRows.length > 0 && rows.every(rowIsValid);

  const handleCommit = async () => {
    if (!canCommit) {
      toast.error("Every included row needs a quantity, and new parts need company code / category / part type");
      return;
    }
    setCommitting(true);
    try {
      const payload = {
        vendor: vendor._id,
        purchaseOrder: purchaseOrder?._id ?? null,
        enteredBy,
        date: selectedDate,
        rows: includedRows.map((r) => ({
          rowIndex: r.rowIndex,
          itemDescription: r.itemDescription,
          quantityReceived: Number(r.quantityReceived),
          matchType: r.isAlternate && r.matchType === "new_part_number" ? "alternate_part" : r.matchType,
          existingPartId: r.matchType === "existing_part_number" ? r.matchedPart?._id : undefined,
          alternateOfPartId: r.isAlternate ? r.alternateOfPart?._id : undefined,
          newPart: r.matchType === "new_part_number" ? r.newPart : undefined,
        })),
      };
      const { data } = await api.post("/stock-entries/import/commit", payload);
      setResult(data);
      setPhase("done");
      if (data.createdEntries?.length) {
        toast.success(`${data.createdEntries.length} line(s) added to stock`);
      }
      if (data.createdApprovals?.length) {
        toast.success(`${data.createdApprovals.length} new part number(s) sent for admin approval`);
      }
      if (data.failedRows?.length) {
        toast.error(`${data.failedRows.length} row(s) could not be imported — see details below`);
      }
      onImported?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not import this batch");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Import from vendor sheet
          </CardTitle>
          <CardDescription>
            Upload {vendor?.companyName ? `${vendor.companyName}'s` : "the vendor's"} own inward-stock workbook,
            pick a date, then review before anything is booked. Vendor is fixed to{" "}
            <strong>{vendor?.companyName}</strong> for every row.
          </CardDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>

      {phase === "upload" && (
        <form onSubmit={handleParse}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Vendor stock sheet (.xlsx / .xls)</Label>
              <Input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                The sheet is only read to build a preview — nothing is saved until you approve it on the next
                screen. Every time you pick a file here it's re-read fresh from disk; nothing from an earlier
                upload carries over.
              </p>
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={parsing}>
              <UploadCloud className="h-4 w-4 mr-2" />
              {parsing ? "Reading sheet…" : "Read sheet"}
            </Button>
          </CardFooter>
        </form>
      )}

      {phase === "pick-date" && parsed && (
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Just read {file?.name ? <><strong>{file.name}</strong> — </> : null}found {parsed.rows.length} row(s)
            across {parsed.dates.length} date(s) on “{parsed.sheetName}”. Pick the date this delivery arrived on.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {parsed.dates.map((d) => {
              const isUndated = d.value === "__undated__";
              return (
                <Button
                  key={d.value}
                  type="button"
                  variant="outline"
                  className={
                    "justify-between" + (isUndated ? " border-amber-300 bg-amber-50 hover:bg-amber-100" : "")
                  }
                  onClick={() => pickDate(d.value)}
                >
                  <span className="flex items-center gap-1.5">
                    {isUndated && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                    {d.label}
                  </span>
                  <Badge variant={isUndated ? "warning" : "secondary"}>{d.rowCount}</Badge>
                </Button>
              );
            })}
          </div>
          {parsed.dates.some((d) => d.value === "__undated__") && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
              Some rows have a value in the sheet's DATE column that couldn't be read as a date (a typo or an
              unfamiliar format). They're grouped under "Unrecognized date" below — open that group to see the
              original text from the sheet for each row.
            </p>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={resetImport}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Choose a different file
          </Button>
        </CardContent>
      )}

      {phase === "preview" && (
        <>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="success" className="gap-1">
                <PackageCheck className="h-3 w-3" />
                {existingCount} ready to book now
              </Badge>
              <Badge variant="warning" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                {newCount} will need admin approval
              </Badge>
              {rows.length - includedRows.length > 0 && (
                <Badge variant="secondary">{rows.length - includedRows.length} skipped</Badge>
              )}
            </div>

            <div className="space-y-2">
              {rows.map((r) => (
                <RowEditor key={r.rowIndex} row={r} updateRow={updateRow} updateNewPart={updateNewPart} />
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={() => setPhase("pick-date")}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to dates
            </Button>
            <Button type="button" onClick={handleCommit} disabled={committing || !canCommit}>
              {committing ? "Importing…" : `Import ${includedRows.length} row(s)`}
            </Button>
          </CardFooter>
        </>
      )}

      {phase === "done" && result && (
        <CardContent className="space-y-4">
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">
                {result.createdEntries?.length || 0} line(s) added to stock, {result.createdApprovals?.length || 0}{" "}
                new part number(s) sent for admin approval.
              </p>
              <p className="text-xs mt-1">
                Approved part numbers will show up under “Approved — ready to book” at the top of this step once the
                Parts section signs off on them.
              </p>
            </div>
          </div>

          {result.failedRows?.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                {result.failedRows.length} row(s) could not be imported
              </p>
              <ul className="mt-2 space-y-1 text-xs">
                {result.failedRows.map((f) => (
                  <li key={f.rowIndex}>
                    Row {f.rowIndex} · {f.itemDescription}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPhase("pick-date")}>
              Import another date from this sheet
            </Button>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function RowEditor({ row, updateRow, updateNewPart }) {
  const isNew = row.matchType === "new_part_number";
  const normalize = (s) => String(s || "").trim().toLowerCase();
  // Only set for a row that started out unmatched and was then resolved to
  // an existing part via the duplicate-check panel below — a row that
  // matched straight from the sheet has an empty newPart.itemDescription,
  // so this naturally stays quiet for those.
  const showDescriptionMismatch =
    row.matchedPart &&
    row.newPart?.itemDescription &&
    normalize(row.newPart.itemDescription) !== normalize(row.matchedPart.itemDescription);

  return (
    <div
      className={
        "rounded-md border border-border p-2.5 space-y-2.5" + (!row.included ? " opacity-50" : "")
      }
    >
      {/* Top line: checkbox, description, part number, qty, status — wraps
          onto multiple lines on narrow screens instead of forcing the card
          wider than its container. */}
      <div className="flex flex-wrap items-start gap-2.5">
        <input
          type="checkbox"
          checked={row.included}
          onChange={(e) => updateRow(row.rowIndex, { included: e.target.checked })}
          className="mt-2 shrink-0"
        />

        <div className="min-w-[180px] flex-1 space-y-1">
          {isNew ? (
            <Input
              value={row.newPart.itemDescription}
              onChange={(e) => updateNewPart(row.rowIndex, "itemDescription", e.target.value)}
              className="h-8 text-xs"
            />
          ) : (
            <span className="block text-sm break-words">{row.itemDescription}</span>
          )}
          {row.dateUnrecognized && (
            <span className="flex items-start gap-1 text-[11px] text-amber-700 break-words">
              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
              Sheet date "{row.dateRaw}" wasn't recognized — check/correct it on the source sheet.
            </span>
          )}
        </div>

        <div className="shrink-0 pt-1.5">
          {row.matchedPart ? (
            <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5 break-all">
              {row.matchedPart.ttUniquePartNumber}
            </span>
          ) : row.ttUniquePartNumber ? (
            <span className="font-mono text-xs bg-amber-100 text-amber-900 rounded px-1.5 py-0.5 break-all">
              {row.ttUniquePartNumber} (not found)
            </span>
          ) : (
            <span className="text-xs text-muted-foreground whitespace-nowrap">No code on sheet</span>
          )}
        </div>

        <Input
          type="number"
          min="1"
          value={row.quantityReceived}
          onChange={(e) => updateRow(row.rowIndex, { quantityReceived: e.target.value })}
          className="h-8 w-24 text-right shrink-0"
          disabled={!row.included}
        />

        <div className="shrink-0 pt-1">
          {row.matchedPart ? (
            <Badge variant="success" className="gap-1">
              <PackageCheck className="h-3 w-3" />
              Match
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              New
            </Badge>
          )}
        </div>
      </div>

      {showDescriptionMismatch && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <p className="break-words">
              The sheet's description for{" "}
              <span className="font-mono bg-white/70 rounded px-1.5 py-0.5 break-all">
                {row.matchedPart.ttUniquePartNumber}
              </span>{" "}
              doesn't match what's already in the master. The pre-existing description will be used — nothing new
              is being added.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded border border-amber-200 bg-white/60 p-1.5 min-w-0">
                <p className="font-medium">Existing description (will be used)</p>
                <p className="break-words">{row.matchedPart.itemDescription}</p>
              </div>
              <div className="rounded border border-amber-200 bg-white/60 p-1.5 min-w-0">
                <p className="font-medium">On the sheet / typed as new</p>
                <p className="break-words">{row.newPart.itemDescription}</p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => updateRow(row.rowIndex, { matchType: "new_part_number", matchedPart: null })}
            >
              Actually, this is a different part
            </Button>
          </div>
        </div>
      )}

      {isNew && row.included && (
        <div className="border-t border-border pt-2.5 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Company code</Label>
              <Input
                value={row.newPart.companyCode}
                onChange={(e) => updateNewPart(row.rowIndex, "companyCode", e.target.value)}
                className="h-8 text-xs"
                placeholder="TT"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Category</Label>
              <Input
                value={row.newPart.category}
                onChange={(e) => updateNewPart(row.rowIndex, "category", e.target.value)}
                className="h-8 text-xs"
                placeholder="AY"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Part type / batch no.</Label>
              <Input
                value={row.newPart.partTypeBatchNo}
                onChange={(e) => updateNewPart(row.rowIndex, "partTypeBatchNo", e.target.value)}
                className="h-8 text-xs"
                placeholder="FAN"
              />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Mfr part no. (optional)</Label>
              <Input
                value={row.newPart.manufacturerPartNumber}
                onChange={(e) => updateNewPart(row.rowIndex, "manufacturerPartNumber", e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <PartNumberPreview
            companyCode={row.newPart.companyCode}
            category={row.newPart.category}
            partTypeBatchNo={row.newPart.partTypeBatchNo}
            onUseExisting={(part) => updateRow(row.rowIndex, { matchType: "existing_part_number", matchedPart: part })}
          />

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={row.isAlternate}
              onChange={(e) =>
                updateRow(row.rowIndex, { isAlternate: e.target.checked, alternateOfPart: null })
              }
            />
            <GitBranchPlus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            This is an accepted substitute (alternate) for a part already in the master
          </label>
          {row.isAlternate && (
            <div className="space-y-1 max-w-md">
              <Label className="text-[11px]">Search the part this is an alternate of</Label>
              <AlternatePartPicker
                value={row.alternateOfPart}
                onChange={(part) => updateRow(row.rowIndex, { alternateOfPart: part })}
              />
            </div>
          )}

          <PartDuplicateCheck
            manufacturerPartNumber={row.newPart.manufacturerPartNumber}
            itemDescription={row.newPart.itemDescription}
            onUseExisting={(part) =>
              updateRow(row.rowIndex, { matchType: "existing_part_number", matchedPart: part })
            }
          />
        </div>
      )}
    </div>
  );
}