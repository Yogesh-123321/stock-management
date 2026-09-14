import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import api from "@/lib/api";
import { fetchReceivedTotal } from "@/lib/receivedTotal";
import ExcelImportPanel from "@/pages/receive/ExcelImportPanel";
import PartDuplicateCheck from "@/components/PartDuplicateCheck";
import PartNumberPreview from "@/components/PartNumberPreview";
import CategorySelect from "@/components/CategorySelect";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";
import {
  Search,
  PackageCheck,
  PackagePlus,
  GitBranchPlus,
  ArrowRight,
  RotateCcw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Rows3,
  ShieldCheck,
  ShieldAlert,
  Clock,
  FileSpreadsheet,
  Sparkles,
} from "lucide-react";

// Debounced fetch of the lightweight "AI suggested checks" for the line
// currently being entered — see getStockEntrySuggestions in
// stockController.js. Purely advisory: it never blocks saving, it just
// surfaces things worth a second look (unusual quantity, unfamiliar
// vendor, a total that would overshoot the document quantity).
function useStockSuggestions({ partId, quantity, vendorId, purchaseOrderId }) {
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const qty = Number(quantity);
    if (!partId || !qty || Number.isNaN(qty) || qty <= 0) {
      setWarnings([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/stock-entries/suggest-warnings", {
          params: {
            part: partId,
            quantity: qty,
            vendor: vendorId || undefined,
            purchaseOrder: purchaseOrderId || undefined,
          },
        });
        setWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
      } catch {
        // Advisory only — a failed check should never block data entry.
        setWarnings([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [partId, quantity, vendorId, purchaseOrderId]);

  return { warnings, loading };
}

function AiSuggestedWarnings({ warnings, loading }) {
  if (!loading && warnings.length === 0) return null;
  return (
    <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-xs space-y-1.5">
      <p className="flex items-center gap-1.5 font-medium text-sky-900">
        <Sparkles className="h-3.5 w-3.5" />
        AI suggested checks
      </p>
      {loading && warnings.length === 0 && <p className="text-sky-700">Checking…</p>}
      {warnings.map((w, i) => (
        <p
          key={i}
          className={"flex items-start gap-1.5 " + (w.level === "warning" ? "text-amber-800" : "text-sky-800")}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{w.message}</span>
        </p>
      ))}
    </div>
  );
}

// Entries logged in this session, shown either as a compact list or as a
// grid of cards so the person can scan what has been entered so far.
function SessionLog({ entries, view }) {
  if (entries.length === 0) return null;

  if (view === "grid") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {entries.map((e, i) => (
          <div key={i} className="rounded-md border border-border bg-card p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] bg-muted rounded px-1.5 py-0.5">
                {e.part.ttUniquePartNumber}
              </span>
              <span className="text-sm font-semibold text-primary">+{e.quantityReceived}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2" title={e.part.itemDescription}>
              {e.part.itemDescription}
            </p>
            {e.stockApplied ? (
              <p className="mt-1 text-[11px] text-muted-foreground">In stock now: {e.part.quantityInStock}</p>
            ) : (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600">
                <Clock className="h-3 w-3" />
                Pending — added once the tax invoice is uploaded
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[150px]">Part no.</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="w-[90px] text-right">Qty</TableHead>
          <TableHead className="w-[140px] text-right">Stock status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e, i) => (
          <TableRow key={i}>
            <TableCell className="font-mono text-xs">{e.part.ttUniquePartNumber}</TableCell>
            <TableCell className="truncate max-w-0" title={e.part.itemDescription}>
              {e.part.itemDescription}
            </TableCell>
            <TableCell className="text-right font-medium">+{e.quantityReceived}</TableCell>
            <TableCell className="text-right">
              {e.stockApplied ? (
                <span className="text-muted-foreground">In stock: {e.part.quantityInStock}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <Clock className="h-3 w-3" />
                  Pending invoice
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const partLabel = (np) =>
  [np?.companyCode, np?.category, np?.partTypeBatchNo].filter(Boolean).join(" / ");

// Shared by the "matched existing part" and "approved request" phases —
// both just need a quantity + optional remarks.
const QTY_REMARKS_SCHEMA = {
  quantityReceived: {
    required: true,
    requiredMessage: "Enter the quantity received",
    regex: "positiveInteger",
    min: 1,
  },
  remarks: { maxLength: 500 },
};

// New / alternate part registration — same field names/placeholders as the
// Parts section itself, so the same rules apply here.
const NEW_PART_SCHEMA = {
  itemDescription: { required: true, requiredMessage: "Item description is required", maxLength: 200 },
  manufacturerPartNumber: { regex: "docNumber" },
  typeOfPart: { regex: "alphaNumSpace", maxLength: 40 },
  companyCode: { required: true, requiredMessage: "Company code is required", regex: "categoryCode" },
  partTypeBatchNo: {
    required: true,
    requiredMessage: "Part type / batch no. is required",
    regex: "alphaNumSpace",
    maxLength: 30,
  },
  quantityReceived: { regex: "positiveInteger" },
  remarks: { maxLength: 500 },
};

export default function StockEntryStep({
  vendor,
  purchaseOrder,
  deliveryDocs = [],
  expectedQuantities = {},
  onFinish,
}) {
  // "lookup" -> "matched" | "approved-request" -> "choose-alternate" -> "new-part" -> "lookup"
  const [phase, setPhase] = useState("lookup");
  const [quantityReceived, setQuantityReceived] = useState("");
  const [enteredBy, setEnteredBy] = useState("");
  const [remarks, setRemarks] = useState("");

  const [matchedPart, setMatchedPart] = useState(null);
  const [alternateOfPart, setAlternateOfPart] = useState(null); // set when registering as an alternate
  const [activeRequest, setActiveRequest] = useState(null); // approved request being booked

  const [newPart, setNewPart] = useState({
    typeOfPart: "",
    manufacturerPartNumber: "",
    itemDescription: "",
    companyCode: "",
    category: "",
    partTypeBatchNo: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [sessionEntries, setSessionEntries] = useState([]);
  const [logView, setLogView] = useState("grid"); // "grid" | "list"
  const vQty = useFormValidation(QTY_REMARKS_SCHEMA);
  const vNewPart = useFormValidation(NEW_PART_SCHEMA);

  // ---- part-number approval queue ----
  // A brand-new part number, or an alternate of an existing one, cannot take
  // stock until the Parts (item parts) section has approved it.
  const [approvals, setApprovals] = useState([]); // pending + approved requests
  const [approvalsLoading, setApprovalsLoading] = useState(false);

  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const { data } = await api.get("/part-approvals", {
        params: { status: "pending,approved" },
      });
      setApprovals(Array.isArray(data) ? data : []);
    } catch {
      // non-blocking — the operator can still book existing parts
    } finally {
      setApprovalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const pendingApprovals = useMemo(
    () => approvals.filter((r) => r.status === "pending"),
    [approvals]
  );
  const readyApprovals = useMemo(
    () => approvals.filter((r) => r.status === "approved"),
    [approvals]
  );

  // ---- live part search (replaces the old type-then-click lookup) ----
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // ---- PO / PI vs stock reconciliation (cumulative across days) ----
  const { po: poQty = null, pi: piQty = null } = expectedQuantities;

  // Quantity already booked against this PO/PI on earlier days. A delivery can
  // arrive in parts (10 today, 2 next week) against the same still-open PO.
  const [priorTotal, setPriorTotal] = useState(0);
  const [priorLoading, setPriorLoading] = useState(false);

  const docsKey = useMemo(
    () =>
      [...deliveryDocs, purchaseOrder]
        .map((d) => (typeof d === "string" ? d : d?._id))
        .filter(Boolean)
        .join(","),
    [deliveryDocs, purchaseOrder]
  );

  useEffect(() => {
    let cancelled = false;
    const ids = docsKey ? docsKey.split(",") : [];
    if (ids.length === 0) {
      setPriorTotal(0);
      return undefined;
    }
    setPriorLoading(true);
    fetchReceivedTotal(ids)
      .then(({ total }) => {
        if (!cancelled) setPriorTotal(total);
      })
      .finally(() => {
        if (!cancelled) setPriorLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Fetched once per delivery: entries logged in this session are tracked
    // locally in sessionEntries and added on top of this baseline.
  }, [docsKey]);

  const enteredTotal = useMemo(
    () => sessionEntries.reduce((sum, e) => sum + Number(e.quantityReceived || 0), 0),
    [sessionEntries]
  );
  const cumulativeTotal = priorTotal + enteredTotal;
  const docQtys = [
    { label: "Purchase order", qty: poQty },
    { label: "Proforma invoice", qty: piQty },
  ].filter((d) => d.qty != null);
  const docMismatch = poQty != null && piQty != null && poQty !== piQty;
  const stockMismatch = docQtys.length > 0 && docQtys.some((d) => d.qty !== cumulativeTotal);
  const allMatch = docQtys.length > 0 && !docMismatch && !stockMismatch;
  const expectedQty = docQtys.length > 0 ? docQtys[0].qty : null;
  const remainingQty = expectedQty == null ? null : expectedQty - cumulativeTotal;

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Live, debounced, partial + case-insensitive search across the part master.
  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: term } });
        setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not search parts");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const pickPart = (part) => {
    setMatchedPart(part);
    setActiveRequest(null);
    setPhase("matched");
    setOpen(false);
    setSearchTerm(part.ttUniquePartNumber);
  };

  // Book stock against a part number that has already cleared approval.
  const pickApproved = (request) => {
    setActiveRequest(request);
    setMatchedPart(null);
    setQuantityReceived(request.proposedQuantity ? String(request.proposedQuantity) : "");
    setOpen(false);
    setPhase("approved-request");
  };

  const resetLine = () => {
    setPhase("lookup");
    setSearchTerm("");
    setQuantityReceived("");
    setRemarks("");
    setMatchedPart(null);
    setAlternateOfPart(null);
    setActiveRequest(null);
    vQty.reset();
    vNewPart.reset();
    setNewPart({
      typeOfPart: "",
      manufacturerPartNumber: "",
      itemDescription: "",
      companyCode: "",
      category: "",
      partTypeBatchNo: "",
    });
  };

  const submitEntry = async (payload, request = null) => {
    setSubmitting(true);
    try {
      const { data } = await api.post("/stock-entries", {
        vendor: vendor._id,
        purchaseOrder: purchaseOrder?._id ?? null,
        quantityReceived: Number(quantityReceived),
        enteredBy,
        remarks,
        ...payload,
      });
      // An approval can create exactly one part — close it out.
      if (request) {
        try {
          await api.patch(`/part-approvals/${request._id}/consume`, { partId: data.part?._id });
        } catch {
          /* the entry is already saved; the queue will just show it as approved */
        }
        loadApprovals();
      }
      toast.success(
        data.stockApplied
          ? `Stock updated for ${data.part.ttUniquePartNumber}`
          : `Logged ${data.part.ttUniquePartNumber} — will be added to stock once the tax invoice is uploaded`
      );
      setSessionEntries((prev) => [...prev, data]);
      resetLine();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to record stock entry");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmExisting = (e) => {
    e.preventDefault();
    if (!vQty.validateAll({ quantityReceived, remarks })) {
      toast.error("Fix the highlighted field before continuing");
      return;
    }
    submitEntry({ matchType: "existing_part_number", existingPartId: matchedPart._id });
  };

  // Book the approved new / alternate part number.
  const handleConfirmApproved = (e) => {
    e.preventDefault();
    if (!activeRequest) return;
    if (!vQty.validateAll({ quantityReceived, remarks })) {
      toast.error("Fix the highlighted field before continuing");
      return;
    }
    submitEntry(
      {
        matchType: activeRequest.requestType, // new_part_number | alternate_part
        alternateOfPartId:
          activeRequest.requestType === "alternate_part"
            ? activeRequest.alternateOfPart?._id || activeRequest.alternateOfPart
            : undefined,
        newPart: {
          typeOfPart: activeRequest.newPart?.typeOfPart || "",
          manufacturerPartNumber: activeRequest.newPart?.manufacturerPartNumber || "",
          itemDescription: activeRequest.newPart?.itemDescription || "",
          companyCode: activeRequest.newPart?.companyCode || "",
          category: activeRequest.newPart?.category || "",
          partTypeBatchNo: activeRequest.newPart?.partTypeBatchNo || "",
        },
        approvedRequestId: activeRequest._id,
      },
      activeRequest
    );
  };

  const handleSearchAlternate = async (query) => {
    if (!query.trim()) {
      setAlternateOfPart(null);
      return;
    }
    try {
      const { data } = await api.get("/parts", { params: { search: query } });
      setAlternateOfPart(data[0] || null);
    } catch {
      // best-effort inline search — swallow errors, the person can retry
    }
  };

  // New / alternate part numbers no longer create stock straight away: they go
  // to the Parts section for approval first.
  const handleSendForApproval = async (e, isAlternate) => {
    e.preventDefault();
    const newPartForm = { ...newPart, quantityReceived, remarks };
    if (!vNewPart.validateAll(newPartForm)) {
      toast.error("Fix the highlighted field before sending for approval");
      return;
    }
    if (isAlternate && !alternateOfPart) {
      toast.error("Search for and select the part this is an alternate of");
      return;
    }
    if (!newPart.category) {
      toast.error("Category is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/part-approvals", {
        requestType: isAlternate ? "alternate_part" : "new_part_number",
        newPart,
        alternateOfPartId: isAlternate ? alternateOfPart._id : null,
        vendorId: vendor?._id || null,
        purchaseOrderId: purchaseOrder?._id || null,
        searchTerm: searchTerm.trim(),
        proposedQuantity: quantityReceived ? Number(quantityReceived) : null,
        requestedBy: enteredBy,
        requestRemarks: remarks,
      });
      toast.success("Sent for approval — stock can be booked once the Parts section approves it");
      await loadApprovals();
      resetLine();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not send the part for approval");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = () => {
    if (sessionEntries.length === 0) {
      toast.error("Log at least one stock entry before finishing");
      return;
    }
    if (stockMismatch || docMismatch) {
      const ok = window.confirm(
        `Quantity check:\n${docQtys.map((d) => `${d.label}: ${d.qty}`).join("\n")}\n` +
          `Received earlier: ${priorTotal}\nEntered now: ${enteredTotal}\nTotal received: ${cumulativeTotal}\n` +
          (remainingQty != null && remainingQty > 0 ? `Still pending: ${remainingQty}\n` : "") +
          "\nContinue anyway? The PO/PI will be left OPEN until the full quantity is received."
      );
      if (!ok) return;
      // Let admins know this PO/PI is being left open with a quantity
      // mismatch, rather than leaving it to be noticed later.
      api
        .post("/stock-entries/report-mismatch", {
          purchaseOrder: purchaseOrder?._id || null,
          poQty,
          piQty,
          previouslyReceived: priorTotal,
          enteredNow: enteredTotal,
          totalReceived: cumulativeTotal,
          reportedBy: enteredBy,
        })
        .catch(() => {
          // Best-effort — this should never block finishing the receiving flow.
        });
    }
    onFinish({
      enteredQuantity: cumulativeTotal,
      sessionQuantity: enteredTotal,
      previouslyReceived: priorTotal,
      quantityMatched: allMatch,
    });
  };

  // Bulk import ("Import from vendor sheet") hands back the same shape the
  // single-line endpoint returns for booked entries, plus any newly-raised
  // approval requests — fold both into the session state the same way a
  // manual line would.
  const handleImported = (data) => {
    if (data?.createdEntries?.length) {
      setSessionEntries((prev) => [...prev, ...data.createdEntries]);
    }
    if (data?.createdApprovals?.length) {
      loadApprovals();
    }
  };

  // AI suggested checks only make sense once we know which existing part
  // is being booked (a brand-new part has no receiving history yet).
  const { warnings: aiWarnings, loading: aiWarningsLoading } = useStockSuggestions({
    partId: matchedPart?._id,
    quantity: quantityReceived,
    vendorId: vendor?._id,
    purchaseOrderId: purchaseOrder?._id,
  });

  const term = searchTerm.trim();
  const termMatches = (r) => {
    if (!term) return true;
    const hay = `${r.newPart?.itemDescription || ""} ${partLabel(r.newPart)} ${
      r.newPart?.manufacturerPartNumber || ""
    } ${r.searchTerm || ""}`.toLowerCase();
    return hay.includes(term.toLowerCase());
  };

  if (phase === "excel-import") {
    return (
      <div className="space-y-4">
        <ExcelImportPanel
          vendor={vendor}
          purchaseOrder={purchaseOrder}
          enteredBy={enteredBy}
          onImported={handleImported}
          onClose={() => setPhase("lookup")}
        />
        {sessionEntries.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Logged this session ({sessionEntries.length} {sessionEntries.length === 1 ? "line" : "lines"})
            </Label>
            <SessionLog entries={sessionEntries} view={logView} />
          </div>
        )}
        <div className="flex justify-end">
          <Button variant={sessionEntries.length > 0 ? "default" : "outline"} onClick={handleFinish}>
            Finish stock entry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 4 · Stock entry</CardTitle>
          <CardDescription>
            Start typing a part number or any keyword from the description — matching parts appear as you type.
            Pick the part, then enter the quantity received. A part number that is not in the master (new or an
            alternate) must be approved in the Parts section before its quantity can be booked.
            <span className="mt-1 block text-amber-600">
              Quantity logged here is kept pending — it only appears in the parts master once the tax invoice
              for this delivery is uploaded in the next step.
            </span>
          </CardDescription>
        </CardHeader>

        {phase === "lookup" && (
          <CardContent>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-xs text-muted-foreground">
                Or import a whole delivery at once from the vendor's own stock sheet.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setPhase("excel-import")}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                Import from vendor sheet
              </Button>
            </div>
            <div ref={boxRef} className="relative z-40">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Type part no. or description… e.g. FAN, TTAY, capacitor"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                autoComplete="off"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}

              {open && term && (
                <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate">
                  <ul className="max-h-72 overflow-y-auto bg-card">
                    {results.map((p) => (
                      <li key={p._id}>
                        <button
                          type="button"
                          onClick={() => pickPart(p)}
                          className="flex w-full items-start justify-between gap-3 bg-card px-3 py-2 text-left text-sm hover:bg-secondary"
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                                {p.ttUniquePartNumber}
                              </span>
                              {p.isAlternatePart && <Badge variant="secondary">Alternate</Badge>}
                            </span>
                            <span className="block truncate text-muted-foreground mt-0.5">{p.itemDescription}</span>
                            {p.manufacturerPartNumber && (
                              <span className="block truncate text-xs text-muted-foreground">
                                Mfr: {p.manufacturerPartNumber}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">Stock: {p.quantityInStock}</span>
                        </button>
                      </li>
                    ))}
                    {!searching && results.length === 0 && (
                      <li className="px-3 py-3 text-sm text-muted-foreground">
                        No part matches “{term}”.
                      </li>
                    )}

                    {/* Approved part numbers that do not exist in the master yet */}
                    {readyApprovals.filter(termMatches).map((r) => (
                      <li key={r._id} className="border-t border-border">
                        <button
                          type="button"
                          onClick={() => pickApproved(r)}
                          className="flex w-full items-start justify-between gap-3 bg-card px-3 py-2 text-left text-sm hover:bg-secondary"
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <Badge variant="success" className="gap-1">
                                <ShieldCheck className="h-3 w-3" />
                                Approved
                              </Badge>
                              <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                                {partLabel(r.newPart)}
                              </span>
                            </span>
                            <span className="block truncate text-muted-foreground mt-0.5">
                              {r.newPart?.itemDescription}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">Book stock</span>
                        </button>
                      </li>
                    ))}

                    {/* Still waiting — shown but not selectable */}
                    {pendingApprovals.filter(termMatches).map((r) => (
                      <li
                        key={r._id}
                        className="flex items-start justify-between gap-3 border-t border-border bg-card px-3 py-2 text-sm opacity-70"
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <Badge variant="warning" className="gap-1">
                              <Clock className="h-3 w-3" />
                              Awaiting approval
                            </Badge>
                            <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                              {partLabel(r.newPart)}
                            </span>
                          </span>
                          <span className="block truncate text-muted-foreground mt-0.5">
                            {r.newPart?.itemDescription}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">Locked</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-border bg-card">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        setPhase("choose-alternate");
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-secondary"
                    >
                      <PackagePlus className="h-4 w-4" />
                      Send “{term}” for approval as a new part
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick access to everything that already cleared approval */}
            {(readyApprovals.length > 0 || pendingApprovals.length > 0) && (
              <div className="mt-4 space-y-2">
                {readyApprovals.length > 0 && (
                  <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
                    <p className="text-xs font-medium text-emerald-900 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Approved — ready to book ({readyApprovals.length})
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {readyApprovals.map((r) => (
                        <Button key={r._id} type="button" size="sm" variant="outline" onClick={() => pickApproved(r)}>
                          {r.newPart?.itemDescription}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {pendingApprovals.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-medium flex items-center gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {pendingApprovals.length} part number(s) waiting for approval in the Parts section
                    </p>
                    <p className="mt-1">
                      {pendingApprovals.map((r) => r.newPart?.itemDescription).join(", ")} — quantity cannot be
                      entered until these are approved.
                    </p>
                  </div>
                )}
                {approvalsLoading && (
                  <p className="text-xs text-muted-foreground">Refreshing approval status…</p>
                )}
              </div>
            )}
          </CardContent>
        )}

        {phase === "matched" && matchedPart && (
          <form onSubmit={handleConfirmExisting}>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-border p-3 flex items-start gap-3">
                <PackageCheck className="h-5 w-5 text-success mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                      {matchedPart.ttUniquePartNumber}
                    </span>
                    {matchedPart.isAlternatePart && <Badge variant="secondary">Alternate part</Badge>}
                  </div>
                  <p className="text-sm">{matchedPart.itemDescription}</p>
                  <p className="text-xs text-muted-foreground">
                    Currently in stock: {matchedPart.quantityInStock}
                  </p>
                </div>
              </div>
              {newPart.itemDescription &&
                newPart.itemDescription.trim().toLowerCase() !== matchedPart.itemDescription.trim().toLowerCase() && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="space-y-1.5 min-w-0">
                      <p className="break-words">
                        <span className="font-mono bg-white/70 rounded px-1.5 py-0.5">
                          {matchedPart.ttUniquePartNumber}
                        </span>{" "}
                        already exists with a different description than what you'd typed. The pre-existing
                        description above will be used — nothing new is being added.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="rounded border border-amber-200 bg-white/60 p-1.5 min-w-0">
                          <p className="font-medium">Existing description (will be used)</p>
                          <p className="break-words">{matchedPart.itemDescription}</p>
                        </div>
                        <div className="rounded border border-amber-200 bg-white/60 p-1.5 min-w-0">
                          <p className="font-medium">You had typed</p>
                          <p className="break-words">{newPart.itemDescription}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              <div className="space-y-1.5 max-w-xs">
                <Label>Quantity received</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantityReceived}
                  onChange={(e) => setQuantityReceived(e.target.value)}
                  onBlur={() => vQty.handleBlur("quantityReceived", quantityReceived, { quantityReceived, remarks })}
                />
                <FieldError error={vQty.fieldError("quantityReceived")} />
              </div>
              <AiSuggestedWarnings warnings={aiWarnings} loading={aiWarningsLoading} />
              <div className="space-y-1.5">
                <Label>Remarks (optional)</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  onBlur={() => vQty.handleBlur("remarks", remarks, { quantityReceived, remarks })}
                  rows={2}
                />
                <FieldError error={vQty.fieldError("remarks")} />
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" onClick={resetLine}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Not this part
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Add to stock"}
              </Button>
            </CardFooter>
          </form>
        )}

        {phase === "approved-request" && activeRequest && (
          <form onSubmit={handleConfirmApproved}>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div className="space-y-1 text-emerald-900">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-white/70 rounded px-1.5 py-0.5">
                      {partLabel(activeRequest.newPart)}
                    </span>
                    {activeRequest.requestType === "alternate_part" && (
                      <Badge variant="secondary">
                        Alternate of {activeRequest.alternateOfPart?.ttUniquePartNumber || "—"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm">{activeRequest.newPart?.itemDescription}</p>
                  <p className="text-xs">
                    Approved{activeRequest.reviewedBy ? ` by ${activeRequest.reviewedBy}` : ""} — the TT part number
                    is generated when you save this entry.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5 max-w-xs">
                <Label>Quantity received</Label>
                <Input
                  type="number"
                  min="1"
                  value={quantityReceived}
                  onChange={(e) => setQuantityReceived(e.target.value)}
                  onBlur={() => vQty.handleBlur("quantityReceived", quantityReceived, { quantityReceived, remarks })}
                />
                <FieldError error={vQty.fieldError("quantityReceived")} />
              </div>
              <div className="space-y-1.5">
                <Label>Remarks (optional)</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  onBlur={() => vQty.handleBlur("remarks", remarks, { quantityReceived, remarks })}
                  rows={2}
                />
                <FieldError error={vQty.fieldError("remarks")} />
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" onClick={resetLine}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Create part & add to stock"}
              </Button>
            </CardFooter>
          </form>
        )}

        {phase === "choose-alternate" && (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5 mr-1">{term}</span>
              doesn't match anything in the master database. Is it an accepted substitute for a part you already
              stock?
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button type="button" variant="outline" className="flex-1 justify-start" onClick={() => setPhase("new-part")}>
                <PackagePlus className="h-4 w-4 mr-2" />
                No — register as a brand-new part
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 justify-start"
                onClick={() => setPhase("new-part-alternate")}
              >
                <GitBranchPlus className="h-4 w-4 mr-2" />
                Yes — it's an alternate of an existing part
              </Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={resetLine}>
              Back to part number
            </Button>
          </CardContent>
        )}

        {(phase === "new-part" || phase === "new-part-alternate") && (
          <form onSubmit={(e) => handleSendForApproval(e, phase === "new-part-alternate")}>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  This part number has to be approved in the <strong>Parts</strong> section before any quantity can be
                  booked. Fill in the details and send it for approval — nothing is added to stock yet.
                </p>
              </div>
              {phase === "new-part-alternate" && (
                <div className="space-y-1.5">
                  <Label>Search the part this is an alternate of</Label>
                  <Input placeholder="Part number or description" onChange={(e) => handleSearchAlternate(e.target.value)} />
                  {alternateOfPart && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-mono bg-muted rounded px-1.5 py-0.5">{alternateOfPart.ttUniquePartNumber}</span>
                      {alternateOfPart.itemDescription}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Item description</Label>
                  <Input
                    value={newPart.itemDescription}
                    onChange={(e) => setNewPart({ ...newPart, itemDescription: e.target.value })}
                    onBlur={() =>
                      vNewPart.handleBlur("itemDescription", newPart.itemDescription, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                  />
                  <FieldError error={vNewPart.fieldError("itemDescription")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Manufacturer part number (optional)</Label>
                  <Input
                    value={newPart.manufacturerPartNumber}
                    onChange={(e) => setNewPart({ ...newPart, manufacturerPartNumber: e.target.value })}
                    onBlur={() =>
                      vNewPart.handleBlur("manufacturerPartNumber", newPart.manufacturerPartNumber, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                  />
                  <FieldError error={vNewPart.fieldError("manufacturerPartNumber")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <PartDuplicateCheck
                    manufacturerPartNumber={newPart.manufacturerPartNumber}
                    itemDescription={newPart.itemDescription}
                    onUseExisting={(part) => {
                      pickPart(part);
                      toast.success(`Using existing part ${part.ttUniquePartNumber} instead`);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Type of part (optional)</Label>
                  <Input
                    value={newPart.typeOfPart}
                    onChange={(e) => setNewPart({ ...newPart, typeOfPart: e.target.value })}
                    onBlur={() =>
                      vNewPart.handleBlur("typeOfPart", newPart.typeOfPart, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                    placeholder="PCB, MECHANICAL, ..."
                  />
                  <FieldError error={vNewPart.fieldError("typeOfPart")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Company code</Label>
                  <Input
                    value={newPart.companyCode}
                    onChange={(e) => setNewPart({ ...newPart, companyCode: e.target.value })}
                    onBlur={() =>
                      vNewPart.handleBlur("companyCode", newPart.companyCode, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                    placeholder="TT"
                  />
                  <FieldError error={vNewPart.fieldError("companyCode")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <CategorySelect
                    value={newPart.category}
                    onChange={(v) => setNewPart({ ...newPart, category: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Part type / batch no.</Label>
                  <Input
                    value={newPart.partTypeBatchNo}
                    onChange={(e) => setNewPart({ ...newPart, partTypeBatchNo: e.target.value })}
                    onBlur={() =>
                      vNewPart.handleBlur("partTypeBatchNo", newPart.partTypeBatchNo, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                    placeholder="FAN"
                  />
                  <FieldError error={vNewPart.fieldError("partTypeBatchNo")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <PartNumberPreview
                    companyCode={newPart.companyCode}
                    category={newPart.category}
                    partTypeBatchNo={newPart.partTypeBatchNo}
                    onUseExisting={(part) => {
                      pickPart(part);
                      toast.success(`Using existing part ${part.ttUniquePartNumber} instead`);
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity expected (optional)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={quantityReceived}
                    onChange={(e) => setQuantityReceived(e.target.value)}
                    onBlur={() =>
                      vNewPart.handleBlur("quantityReceived", quantityReceived, {
                        ...newPart,
                        quantityReceived,
                        remarks,
                      })
                    }
                    placeholder="Booked after approval"
                  />
                  <FieldError error={vNewPart.fieldError("quantityReceived")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Remarks for the approver (optional)</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  onBlur={() =>
                    vNewPart.handleBlur("remarks", remarks, { ...newPart, quantityReceived, remarks })
                  }
                  rows={2}
                />
                <FieldError error={vNewPart.fieldError("remarks")} />
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button type="button" variant="outline" onClick={() => setPhase("choose-alternate")}>
                Back
              </Button>
              <Button type="submit" disabled={submitting}>
                <ShieldCheck className="h-4 w-4 mr-2" />
                {submitting ? "Sending..." : "Send for approval"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>

      {/* Quantity reconciliation against the PO / PI of this delivery */}
      {(docQtys.length > 0 || sessionEntries.length > 0) && (
        <div
          className={
            "rounded-md border p-3 text-sm " +
            (docQtys.length === 0
              ? "border-border bg-card"
              : allMatch
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-900")
          }
        >
          <div className="flex items-start gap-2">
            {docQtys.length > 0 &&
              (allMatch ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              ))}
            <div className="space-y-1">
              <p className="font-medium">
                Quantity check — total received: {cumulativeTotal}
                {docQtys.map((d) => ` · ${d.label}: ${d.qty}`)}
              </p>
              {priorTotal > 0 && (
                <p className="text-xs">
                  Previously received {priorTotal} + {enteredTotal} entered now = <strong>{cumulativeTotal}</strong>
                  {expectedQty != null ? ` of ${expectedQty}` : ""}.
                </p>
              )}
              {priorLoading && <p className="text-xs text-muted-foreground">Checking earlier receipts…</p>}
              {docQtys.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No quantity was recorded on the PO/PI for this delivery, so nothing can be cross-checked.
                </p>
              ) : allMatch ? (
                <p className="text-xs">Everything matches — the PO/PI will close once the tax invoice is uploaded.</p>
              ) : (
                <p className="text-xs">
                  {docMismatch && "The PO and PI quantities differ. "}
                  {stockMismatch &&
                    (remainingQty != null && remainingQty > 0
                      ? `${remainingQty} still pending — book the balance later against this same PO/PI. `
                      : remainingQty != null && remainingQty < 0
                      ? `${Math.abs(remainingQty)} more than the document quantity has been received. `
                      : "The stock received does not match the document quantity. ")}
                  You can still finish, but the PO/PI will stay <strong>open</strong> so the balance can be received
                  later.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {sessionEntries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              Logged this session ({sessionEntries.length} {sessionEntries.length === 1 ? "line" : "lines"})
            </Label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={logView === "grid" ? "default" : "outline"}
                onClick={() => setLogView("grid")}
              >
                <LayoutGrid className="h-4 w-4 mr-1.5" />
                Grid
              </Button>
              <Button
                type="button"
                size="sm"
                variant={logView === "list" ? "default" : "outline"}
                onClick={() => setLogView("list")}
              >
                <Rows3 className="h-4 w-4 mr-1.5" />
                List
              </Button>
            </div>
          </div>
          <SessionLog entries={sessionEntries} view={logView} />
        </div>
      )}

      <div className="flex justify-end">
        <Button variant={sessionEntries.length > 0 ? "default" : "outline"} onClick={handleFinish}>
          Finish stock entry
        </Button>
      </div>
    </div>
  );
}