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
import CategorySelect from "@/components/CategorySelect";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import FieldError from "@/components/FieldError";
import SearchableSelect from "@/components/ui/SearchableSelect";
import { validateValue } from "@/lib/validators";
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
  Save,
  Loader2,
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

  Per-row controls on the preview screen:
    - "Save entry" saves just that one row right away (same commit endpoint,
      one-row batch). The row then collapses into a green "saved" card that
      shows the resulting stock entry, the entry is pushed to the "Logged
      this session" list below via onImported, and the row is left out of the
      final bulk "Import remaining rows" so it can never be booked twice.
    - Each row also carries a Unit and a Price per unit (optional). They're
      pre-filled from the sheet's rate column, else from the matched part,
      and are stored on the stock entry (or on the new-part request, so the
      approved part starts out with them) exactly like the manual entry form.
    - Each row has its own part search box. Picking a part links that row to
      an existing master part (handy when the sheet's code was missing or
      wrong); clearing it falls back to whatever the sheet itself matched.
*/

// The sheet columns the importer tries to find on its own. If a vendor labels
// one of them differently, the operator can point it at the right column on the
// date-picking screen (sent back to the server as `columnMap`).
const COLUMN_FIELDS = [
  { key: "received", label: "Quantity received (default quantity)" },
  { key: "ordered", label: "Quantity ordered (used if received is empty)" },
  { key: "rate", label: "Price per unit" },
  { key: "unit", label: "Unit" },
];

const emptyNewPart = () => ({
  typeOfPart: "",
  manufacturerPartNumber: "",
  itemDescription: "",
  companyCode: "TT",
  category: "",
  partTypeBatchNo: "",
});

// Same field rules as the manual "new part" form on the Stock entry step —
// this is the bulk-import path for the same data, so it should be no more
// permissive than typing it in one row at a time.
const ROW_FIELD_RULES = {
  itemDescription: { required: true, requiredMessage: "Item description is required", maxLength: 200 },
  manufacturerPartNumber: { regex: "docNumber" },
  companyCode: { required: true, requiredMessage: "Company code is required", regex: "categoryCode" },
  partTypeBatchNo: {
    required: true,
    requiredMessage: "Part type / batch no. is required",
    regex: "alphaNumSpace",
    maxLength: 30,
  },
  quantityReceived: { required: true, requiredMessage: "Enter the quantity received", regex: "positiveInteger", min: 1 },
  // Both optional, same rules as the manual stock-entry form: the unit of
  // measure (PCS, KG, MTR, ...) and the rate charged per unit on THIS delivery.
  unit: { regex: "alphaNumSpace", maxLength: 20 },
  price: { regex: "decimal2", message: "Numbers only, up to 2 decimal places" },
};

function validateRowField(field, value) {
  return validateValue(value, ROW_FIELD_RULES[field], null);
}

// Every problem with a row, keyed by field — used both to gate the bulk
// import / per-row save and to light up the red messages on the row itself.
function collectRowErrors(r) {
  const errors = {};
  const qtyErr = validateRowField("quantityReceived", r.quantityReceived);
  if (qtyErr) errors.quantityReceived = qtyErr;
  const unitErr = validateRowField("unit", r.unit);
  if (unitErr) errors.unit = unitErr;
  const priceErr = validateRowField("price", r.price);
  if (priceErr) errors.price = priceErr;

  if (r.matchType === "existing_part_number") {
    if (!r.matchedPart) errors.match = "Pick the part this row belongs to";
    return errors;
  }

  if (r.isAlternate && !r.alternateOfPart) {
    errors.alternateOf = "Search and pick the part this is an alternate of";
  }
  if (!r.newPart.category) errors.category = "Select a category";
  ["itemDescription", "manufacturerPartNumber", "companyCode", "partTypeBatchNo"].forEach((field) => {
    const err = validateRowField(field, r.newPart[field]);
    if (err) errors[field] = err;
  });
  return errors;
}

export default function ExcelImportPanel({ vendor, purchaseOrder, enteredBy, sessionId = null, onImported, onClose }) {
  const [phase, setPhase] = useState("upload"); // upload -> pick-date -> preview -> done
  const [file, setFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0); // bump to force-remount the <input type=file>
  const [parsing, setParsing] = useState(false);

  const [parsed, setParsed] = useState(null); // { sheetName, dates, rows }
  const [selectedDate, setSelectedDate] = useState(null);
  // Persistent red banner for a rejected upload (e.g. a sheet spanning more
  // than one date) — kept separate from the transient toast so the reason
  // stays visible on screen while the operator fixes the file and retries.
  const [uploadError, setUploadError] = useState("");

  const [rows, setRows] = useState([]); // editable preview rows for the selected date
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null); // { createdEntries, createdApprovals, failedRows }
  // Rows saved one at a time from the preview, keyed by sheet rowIndex. Kept
  // at panel level (not just on the row objects) so going "Back to dates" and
  // re-opening the same date doesn't hand back rows that are already booked.
  const [columnMap, setColumnMap] = useState({}); // manual column overrides, see COLUMN_FIELDS
  const [rereading, setRereading] = useState(false);
  const [savedRows, setSavedRows] = useState({});
  const [savingRowIndex, setSavingRowIndex] = useState(null);

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
    setSavedRows({});
    setSavingRowIndex(null);
    setColumnMap({});
    setUploadError("");
    setPhase("upload");
  };

  // Re-reads the same file with the operator's column choices applied.
  const rereadWithColumns = async (nextMap) => {
    if (!file) return;
    setRereading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("columnMap", JSON.stringify(nextMap));
      const { data } = await api.post("/stock-entries/import/parse", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setParsed(data);
      setColumnMap(nextMap);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not re-read the sheet with that column");
    } finally {
      setRereading(false);
    }
  };

  const handleParse = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Choose the vendor's stock sheet (.xlsx or .xls) first");
      return;
    }
    setParsing(true);
    setParsed(null); // never show a stale parse while a new one is in flight
    setColumnMap({});
    setUploadError("");
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
      // The backend rejects a sheet up front if it spans more than one date
      // (each import is meant to be a single delivery date) — surface that,
      // and any other parse failure, as a standing red warning right under
      // the file picker, not just a toast that disappears in a few seconds.
      const message = err.response?.data?.message || "Could not read that spreadsheet";
      setUploadError(message);
      toast.error(message);
    } finally {
      setParsing(false);
    }
  };

  // Options for the column pickers on the date screen (searchable).
  const columnOptions = useMemo(
    () => [
      { value: "-1", label: "— not on this sheet —" },
      ...(parsed?.headers || []).map((h) => ({ value: String(h.index), label: h.label })),
    ],
    [parsed]
  );

  const pickDate = (dateValue) => {
    setSelectedDate(dateValue);
    const dayRows = parsed.rows
      .filter((r) => r.dateKey === dateValue)
      .map((r) => ({
        rowIndex: r.rowIndex,
        itemDescription: r.itemDescription,
        ttUniquePartNumber: r.ttUniquePartNumber,
        matchedPart: r.matchedPart,
        // What the sheet itself matched — restored if the operator clears a
        // part they linked by hand through the row's search box.
        sheetMatchedPart: r.matchedPart,
        searchPick: null,
        saved: savedRows[r.rowIndex] || null,
        saveError: "",
        dateRaw: r.dateRaw,
        dateUnrecognized: r.dateUnrecognized,
        included: true,
        matchType: r.matchedPart ? "existing_part_number" : "new_part_number",
        isAlternate: false,
        alternateOfPart: null,
        quantityReceived: r.suggestedQuantity != null ? String(r.suggestedQuantity) : "",
        // Unit + rate for this delivery. The sheet's own "Rate per Unit"
        // (and "Unit"/"UOM" column, if it has one) wins; otherwise fall back
        // to what's registered on the matched part. Always editable.
        sheetRate: r.ratePerUnit ?? null,
        unit: r.unit || r.matchedPart?.unit || "",
        price:
          r.ratePerUnit != null
            ? String(r.ratePerUnit)
            : r.matchedPart?.price != null
              ? String(r.matchedPart.price)
              : "",
        errors: {},
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

  const blurRowField = (rowIndex, field, value) => {
    const err = validateRowField(field, value);
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, errors: { ...r.errors, [field]: err } } : r)));
  };

  const updateRow = (rowIndex, patch) => {
    setRows((prev) => prev.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  };

  const updateNewPart = (rowIndex, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, newPart: { ...r.newPart, [field]: value } } : r))
    );
  };

  // Links a row to a part chosen from its own search box (or, when the pick is
  // cleared, goes back to whatever the sheet matched on its own).
  const pickRowPart = (rowIndex, part) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        if (part) {
          return {
            ...r,
            searchPick: part,
            matchedPart: part,
            matchType: "existing_part_number",
            isAlternate: false,
            alternateOfPart: null,
            // Only fill blanks from the picked part — never overwrite what
            // the operator (or the sheet) already put in.
            unit: r.unit || part.unit || "",
            price: r.price !== "" ? r.price : part.price != null ? String(part.price) : "",
            saveError: "",
            errors: { ...r.errors, match: undefined },
          };
        }
        const back = r.sheetMatchedPart || null;
        return {
          ...r,
          searchPick: null,
          matchedPart: back,
          matchType: back ? "existing_part_number" : "new_part_number",
        };
      })
    );
  };

  // Rows still waiting to be imported in bulk — anything already saved
  // individually is done and must never be sent again.
  const includedRows = useMemo(() => rows.filter((r) => r.included && !r.saved), [rows]);
  const savedCount = useMemo(() => rows.filter((r) => r.saved).length, [rows]);
  const existingCount = includedRows.filter((r) => r.matchType === "existing_part_number").length;
  const newCount = includedRows.filter((r) => r.matchType === "new_part_number").length;
  const skippedCount = rows.filter((r) => !r.included && !r.saved).length;

  const rowIsValid = (r) => {
    if (!r.included || r.saved) return true; // skipped / already-saved rows don't block submission
    return Object.keys(collectRowErrors(r)).length === 0;
  };

  const canCommit = includedRows.length > 0 && rows.every(rowIsValid) && savingRowIndex == null;

  const buildRowPayload = (r) => ({
    rowIndex: r.rowIndex,
    itemDescription: r.itemDescription,
    quantityReceived: Number(r.quantityReceived),
    unit: String(r.unit || "").trim(),
    price: r.price === "" || r.price == null ? null : Number(r.price),
    matchType: r.isAlternate && r.matchType === "new_part_number" ? "alternate_part" : r.matchType,
    existingPartId: r.matchType === "existing_part_number" ? r.matchedPart?._id : undefined,
    alternateOfPartId: r.isAlternate ? r.alternateOfPart?._id : undefined,
    newPart: r.matchType === "new_part_number" ? r.newPart : undefined,
  });

  const buildPayload = (list) => ({
    vendor: vendor._id,
    purchaseOrder: purchaseOrder?._id ?? null,
    // Stamped on every booked line so it reappears under "Logged this
    // session" after a Save & exit / Resume, same as a hand-entered line.
    receivingSession: sessionId || null,
    enteredBy,
    date: selectedDate,
    rows: list.map(buildRowPayload),
  });

  // Save ONE row on its own — same endpoint as the bulk import, one-row batch.
  const handleSaveRow = async (row) => {
    const errors = collectRowErrors(row);
    if (Object.keys(errors).length > 0) {
      updateRow(row.rowIndex, { errors, saveError: "" });
      toast.error(Object.values(errors)[0] || "Fix the highlighted field(s) on this row first");
      return;
    }
    setSavingRowIndex(row.rowIndex);
    updateRow(row.rowIndex, { saveError: "" });
    try {
      const { data } = await api.post("/stock-entries/import/commit", buildPayload([row]));
      const failed = data.failedRows?.[0];
      if (failed) {
        updateRow(row.rowIndex, { saveError: failed.message });
        toast.error(failed.message);
        return;
      }
      const saved = {
        entry: data.createdEntries?.[0] || null,
        approval: data.createdApprovals?.[0] || null,
      };
      setSavedRows((prev) => ({ ...prev, [row.rowIndex]: saved }));
      updateRow(row.rowIndex, { saved, saveError: "", errors: {} });
      if (saved.entry) {
        toast.success(`Saved ${saved.entry.part?.ttUniquePartNumber || "entry"} — added to this session's stock entries`);
      } else {
        toast.success("Saved — new part number sent for admin approval");
      }
      onImported?.(data);
    } catch (err) {
      const message =
        err.response?.data?.failedRows?.[0]?.message || err.response?.data?.message || "Could not save this row";
      updateRow(row.rowIndex, { saveError: message });
      toast.error(message);
    } finally {
      setSavingRowIndex(null);
    }
  };

  const handleCommit = async () => {
    if (!canCommit) {
      toast.error("Every included row needs a quantity, and new parts need company code / category / part type");
      return;
    }
    setCommitting(true);
    try {
      const { data } = await api.post("/stock-entries/import/commit", buildPayload(includedRows));
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
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setUploadError("");
                }}
              />
              <p className="text-xs text-muted-foreground">
                The sheet is only read to build a preview — nothing is saved until you approve it on the next
                screen. Every time you pick a file here it's re-read fresh from disk; nothing from an earlier
                upload carries over. The sheet must cover a single date — a sheet with more than one date on it
                will be rejected below.
              </p>
              {uploadError && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                  <div>
                    <p className="font-medium">Failed to upload</p>
                    <p className="break-words">{uploadError}</p>
                  </div>
                </div>
              )}
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
          {parsed.headers?.length > 0 && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-xs font-medium">Columns being read from the sheet</p>
              {parsed.columns?.received === -1 && parsed.columns?.ordered === -1 && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  No quantity column was recognised — pick it below, otherwise quantities will start blank.
                </p>
              )}
              {parsed.columns?.rate === -1 && (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  No price / rate column was recognised — pick it below, otherwise prices will start blank.
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {COLUMN_FIELDS.map((f) => (
                  <div key={f.key} className="space-y-1 min-w-0">
                    <Label className="text-[11px]">{f.label}</Label>
                    <SearchableSelect
                      options={columnOptions}
                      value={String(parsed.columns?.[f.key] ?? -1)}
                      disabled={rereading}
                      placeholder="— not on this sheet —"
                      searchPlaceholder="Search columns…"
                      emptyText="No column matches."
                      onChange={(v) => rereadWithColumns({ ...columnMap, [f.key]: Number(v) })}
                    />
                  </div>
                ))}
              </div>
              {rereading && <p className="text-xs text-muted-foreground">Re-reading the sheet…</p>}
            </div>
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
              {savedCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {savedCount} saved
                </Badge>
              )}
              {skippedCount > 0 && <Badge variant="secondary">{skippedCount} skipped</Badge>}
            </div>

            <div className="space-y-2">
              {rows.map((r) => (
                <RowEditor
                  key={r.rowIndex}
                  row={r}
                  updateRow={updateRow}
                  updateNewPart={updateNewPart}
                  blurRowField={blurRowField}
                  pickRowPart={pickRowPart}
                  onSave={handleSaveRow}
                  saving={savingRowIndex === r.rowIndex}
                  busy={committing || savingRowIndex != null}
                />
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" onClick={() => setPhase("pick-date")}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to dates
            </Button>
            {includedRows.length === 0 && savedCount > 0 ? (
              <Button type="button" onClick={onClose}>
                Done — {savedCount} row(s) saved
              </Button>
            ) : (
              <Button type="button" onClick={handleCommit} disabled={committing || !canCommit}>
                {committing
                  ? "Importing…"
                  : savedCount > 0
                    ? `Import ${includedRows.length} remaining row(s)`
                    : `Import ${includedRows.length} row(s)`}
              </Button>
            )}
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

function RowEditor({ row, updateRow, updateNewPart, blurRowField, pickRowPart, onSave, saving, busy }) {
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

  // Already saved on its own — collapse to a read-only card that shows what
  // was actually recorded, so the stock entry is visible right on the row.
  if (row.saved) return <SavedRow row={row} />;

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
              onBlur={(e) => blurRowField(row.rowIndex, "itemDescription", e.target.value)}
              className="h-8 text-xs"
            />
          ) : (
            <span className="block text-sm break-words">{row.itemDescription}</span>
          )}
          {isNew && row.errors?.itemDescription && (
            <FieldError error={row.errors.itemDescription} />
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

        <div className="shrink-0">
          <Input
            type="number"
            min="1"
            value={row.quantityReceived}
            onChange={(e) => updateRow(row.rowIndex, { quantityReceived: e.target.value })}
            onBlur={(e) => blurRowField(row.rowIndex, "quantityReceived", e.target.value)}
            className="h-8 w-24 text-right"
            disabled={!row.included}
          />
          {row.errors?.quantityReceived && <FieldError error={row.errors.quantityReceived} />}
        </div>

        <div className="shrink-0 pt-1">
          {row.matchedPart ? (
            <Badge variant="success" className="gap-1">
              <PackageCheck className="h-3 w-3" />
              {row.searchPick ? "Linked" : "Match"}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              New
            </Badge>
          )}
        </div>

        <div className="shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onSave(row)}
            disabled={!row.included || busy}
            title={
              isNew
                ? "Save just this row — the new part number goes for admin approval"
                : "Save just this row as a stock entry now"
            }
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            {saving ? "Saving…" : isNew ? "Save for approval" : "Save entry"}
          </Button>
        </div>
      </div>

      {row.included && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Label className="text-[11px] shrink-0">Search part</Label>
          <div className="min-w-[220px] flex-1 max-w-md">
            <AlternatePartPicker
              value={row.searchPick}
              onChange={(part) => pickRowPart(row.rowIndex, part)}
              placeholder="Search master by part no. or description to link this row…"
            />
          </div>
        </div>
      )}
      {row.errors?.match && <FieldError error={row.errors.match} />}
      {row.included && (
        <div className="flex flex-wrap items-start gap-3 pl-6">
          <div className="space-y-1">
            <Label className="text-[11px]">Unit</Label>
            <Input
              value={row.unit}
              onChange={(e) => updateRow(row.rowIndex, { unit: e.target.value })}
              onBlur={(e) => blurRowField(row.rowIndex, "unit", e.target.value)}
              className="h-8 w-24 text-xs"
              placeholder={row.matchedPart?.unit || "PCS, KG, MTR"}
            />
            <FieldError error={row.errors?.unit} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Price per unit (optional)</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={row.price}
              onChange={(e) => updateRow(row.rowIndex, { price: e.target.value })}
              onBlur={(e) => blurRowField(row.rowIndex, "price", e.target.value)}
              className="h-8 w-32 text-right text-xs"
              placeholder="e.g. 12.50"
            />
            <FieldError error={row.errors?.price} />
          </div>
          {row.sheetRate != null && row.price === String(row.sheetRate) && (
            <p className="self-center pt-4 text-[11px] text-muted-foreground">Rate taken from the sheet — edit if needed.</p>
          )}
        </div>
      )}
      {row.saveError && (
        <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />
          <span className="break-words">{row.saveError}</span>
        </div>
      )}

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
              onClick={() => updateRow(row.rowIndex, { matchType: "new_part_number", matchedPart: null, searchPick: null })}
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
                onBlur={(e) => blurRowField(row.rowIndex, "companyCode", e.target.value)}
                className="h-8 text-xs"
                placeholder="TT"
              />
              <FieldError error={row.errors?.companyCode} />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Category</Label>
              <CategorySelect
                value={row.newPart.category}
                onChange={(v) => updateNewPart(row.rowIndex, "category", v)}
                triggerClassName="h-8 text-xs"
              />
              <FieldError error={row.errors?.category} />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Part type / batch no.</Label>
              <Input
                value={row.newPart.partTypeBatchNo}
                onChange={(e) => updateNewPart(row.rowIndex, "partTypeBatchNo", e.target.value)}
                onBlur={(e) => blurRowField(row.rowIndex, "partTypeBatchNo", e.target.value)}
                className="h-8 text-xs"
                placeholder="FAN"
              />
              <FieldError error={row.errors?.partTypeBatchNo} />
            </div>
            <div className="space-y-1 min-w-0">
              <Label className="text-[11px]">Mfr part no. (optional)</Label>
              <Input
                value={row.newPart.manufacturerPartNumber}
                onChange={(e) => updateNewPart(row.rowIndex, "manufacturerPartNumber", e.target.value)}
                onBlur={(e) => blurRowField(row.rowIndex, "manufacturerPartNumber", e.target.value)}
                className="h-8 text-xs"
              />
              <FieldError error={row.errors?.manufacturerPartNumber} />
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
              <FieldError error={row.errors?.alternateOf} />
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

// Read-only card shown in place of a row once it has been saved on its own.
function SavedRow({ row }) {
  const { entry, approval } = row.saved;
  const partNo = entry?.part?.ttUniquePartNumber;
  const description = entry?.part?.itemDescription || approval?.newPart?.itemDescription || row.itemDescription;
  const qty = entry ? entry.quantityReceived : approval?.proposedQuantity ?? row.quantityReceived;

  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-2.5 space-y-1">
      <div className="flex flex-wrap items-start gap-2.5">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
        <span className="min-w-[180px] flex-1 break-words text-sm">{description}</span>
        {partNo && (
          <span className="shrink-0 font-mono text-xs bg-white rounded px-1.5 py-0.5 break-all">{partNo}</span>
        )}
        <span className="shrink-0 text-sm font-semibold text-primary">+{qty}</span>
        <Badge variant="success" className="shrink-0">
          Saved
        </Badge>
      </div>
      {(entry ? entry.unit || entry.price != null : approval?.newPart?.unit || approval?.newPart?.price != null) && (
        <p className="pl-6 text-[11px] text-muted-foreground">
          {[
            (entry ? entry.unit : approval?.newPart?.unit) && `Unit: ${entry ? entry.unit : approval.newPart.unit}`,
            (entry ? entry.price : approval?.newPart?.price) != null &&
              `Price per unit: ${entry ? entry.price : approval.newPart.price}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {entry ? (
        <p className="pl-6 text-[11px] text-amber-700">
          Stock entry logged · {entry.stockApplied ? `In stock now: ${entry.part?.quantityInStock}` : "Pending — goes to IQC stock once the tax invoice is uploaded"}
        </p>
      ) : (
        <p className="pl-6 text-[11px] text-amber-700">
          New part number sent for admin approval — book it from “Approved — ready to book” once it's approved.
        </p>
      )}
    </div>
  );
}