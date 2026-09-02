import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import PoPreview from "@/components/PoPreview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileText, Plus, RotateCcw, Search, Trash2, Copy, X } from "lucide-react";
import toast from "react-hot-toast";

const fmtIndian = (value, decimals = 2) => {
  const number = Number(value) || 0;
  const [integer, decimal] = Math.abs(number).toFixed(decimals).split(".");
  const lastThree = integer.slice(-3);
  const leading = integer.slice(0, -3);
  const grouped = leading ? `${leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${number < 0 ? "-" : ""}${grouped}${decimal ? `.${decimal}` : ""}`;
};

const today = () => new Date().toISOString().slice(0, 10);
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const emptyItem = () => ({
  partId: "",
  description: "",
  partNo: "",
  hsnSac: "",
  dueOn: "",
  quantity: "",
  unit: "NOS",
  rate: "",
  per: "NOS",
});

const blankForm = () => ({
  voucherNo: "",
  voucherDate: today(),
  paymentTerms: "",
  referenceNo: "",
  otherReferences: "",
  dispatchedThrough: "",
  destination: "",
  termsOfDelivery: "",
  supplierId: "",
  supplierSource: "",
  supplierName: "",
  supplierAddress: "",
  supplierGSTIN: "",
  supplierStateName: "",
  supplierStateCode: "",
  consigneeName: "",
  consigneeAddress: "",
  taxType: "IGST",
  taxRate: 18,
  declaration: "",
  items: [emptyItem()],
});


/**
 * Live search over the part master (/parts?search=) so PO line items can only
 * be picked from our own registered part numbers. Selecting a part fills the
 * TT unique part number and its description into the line.
 */
function PartPicker({ item, onPick, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
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
    const term = query.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: term } });
        setResults(Array.isArray(data) ? data.slice(0, 8) : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  if (item.partNo) {
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono-tech text-xs bg-muted rounded px-1.5 py-0.5">{item.partNo}</span>
          <p className="text-sm mt-1 truncate">{item.description || "—"}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClear} title="Change part">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        className="pl-8"
        value={query}
        placeholder="Search part number or description…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate">
          <ul className="max-h-64 overflow-y-auto bg-card">
            {loading && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
            {!loading && results.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matching part in the part master.</li>
            )}
            {!loading &&
              results.map((p) => (
                <li key={p._id}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 bg-card px-3 py-2 text-left hover:bg-secondary"
                    onClick={() => {
                      onPick(p);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="min-w-0">
                      <span className="font-mono-tech text-xs bg-muted rounded px-1.5 py-0.5">{p.ttUniquePartNumber}</span>
                      <span className="block truncate text-sm text-muted-foreground mt-0.5">{p.itemDescription}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Table cell that spans the whole row for empty/loading states.
function TableEmpty({ colSpan, children }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6">
        {children}
      </TableCell>
    </TableRow>
  );
}

/**
 * Every generated document now waits for the central admin's sign-off, so the
 * PDF stays locked until then. This badge makes that state obvious.
 */
function ApprovalBadge({ status }) {
  const s = status || "pending";
  const map = {
    pending: ["Awaiting admin approval", "bg-amber-100 text-amber-800 border-amber-200"],
    approved: ["Approved", "bg-emerald-100 text-emerald-800 border-emerald-200"],
    rejected: ["Rejected by admin", "bg-rose-100 text-rose-800 border-rose-200"],
  };
  const [label, cls] = map[s] || map.pending;
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function PoGenerator() {
  const [form, setForm] = useState(blankForm);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [copySource, setCopySource] = useState(null);

  // supplier search
  const [partyQuery, setPartyQuery] = useState("");
  const [partyResults, setPartyResults] = useState([]);
  const [partyLoading, setPartyLoading] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [pickedParty, setPickedParty] = useState(null);
  const partyBoxRef = useRef(null);

  // copy-an-existing-PO search
  const [copyQuery, setCopyQuery] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const copyBoxRef = useRef(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setItem = (index, key) => (e) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === index ? { ...it, [key]: e.target.value } : it)),
    }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (index) =>
    setForm((f) => ({ ...f, items: f.items.length === 1 ? f.items : f.items.filter((_, i) => i !== index) }));
  // Line items can only come from the part master.
  const pickItemPart = (index, part) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) =>
        i === index
          ? {
              ...it,
              partId: part._id,
              partNo: part.ttUniquePartNumber || "",
              description: part.itemDescription || "",
              unit: it.unit || part.unit || "NOS",
              per: it.per || part.unit || "NOS",
            }
          : it,
      ),
    }));
  const clearItemPart = (index) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === index ? { ...it, partId: "", partNo: "", description: "" } : it)),
    }));

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data } = await api.get("/po-generator");
      setHistory(data || []);
    } catch {
      toast.error("Could not load previous purchase orders");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadNextNo = async () => {
    try {
      const { data } = await api.get("/po-generator/next-no");
      setForm((f) => (f.voucherNo ? f : { ...f, voucherNo: data.voucherNo, declaration: f.declaration || data.declaration }));
    } catch {
      /* the user can always type the voucher no. manually */
    }
  };

  useEffect(() => {
    loadHistory();
    loadNextNo();
  }, []);

  // Close the dropdowns when clicking elsewhere.
  useEffect(() => {
    const onClick = (e) => {
      if (partyBoxRef.current && !partyBoxRef.current.contains(e.target)) setPartyOpen(false);
      if (copyBoxRef.current && !copyBoxRef.current.contains(e.target)) setCopyOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Live, debounced supplier search across vendors and buyers.
  useEffect(() => {
    const q = partyQuery.trim();
    if (q.length < 1) {
      setPartyResults([]);
      return undefined;
    }
    setPartyLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/po-generator/parties", { params: { q } });
        setPartyResults(data || []);
      } catch {
        setPartyResults([]);
      } finally {
        setPartyLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [partyQuery]);

  const applyGstin = (gstin, prev = {}) => {
    const value = (gstin || "").trim();
    const code = value.slice(0, 2);
    return {
      supplierGSTIN: value,
      supplierStateCode: code || prev.supplierStateCode || "",
      // Intra-state (Haryana, code 06) is CGST+SGST, everything else is IGST.
      taxType: !value ? prev.taxType || "IGST" : value.startsWith("06") ? "CGST_SGST" : "IGST",
    };
  };

  const pickParty = (p) => {
    setPickedParty(p);
    setPartyQuery(p.name);
    setPartyOpen(false);
    setForm((f) => ({
      ...f,
      supplierId: p.id,
      supplierSource: p.source,
      supplierName: p.name,
      supplierAddress: p.address || f.supplierAddress,
      supplierStateName: p.stateName || f.supplierStateName,
      ...applyGstin(p.gstin, f),
    }));
    if (p.activeStatus === "inactive") toast(`${p.name} is marked inactive.`, { icon: "⚠️" });
  };

  const clearParty = () => {
    setPickedParty(null);
    setPartyQuery("");
    setForm((f) => ({
      ...f,
      supplierId: "",
      supplierSource: "",
      supplierName: "",
      supplierAddress: "",
      supplierGSTIN: "",
      supplierStateName: "",
    }));
  };

  const setGstin = (value) => setForm((f) => ({ ...f, ...applyGstin(value, f) }));

  // Voucher numbers already used — the form blocks duplicates before submitting.
  const usedVoucherNos = useMemo(
    () => new Set(history.map((p) => String(p.voucherNo).trim().toLowerCase())),
    [history],
  );
  const voucherNoTaken = usedVoucherNos.has(form.voucherNo.trim().toLowerCase());

  const copyMatches = useMemo(() => {
    const q = copyQuery.trim().toLowerCase();
    const list = q
      ? history.filter(
          (p) =>
            String(p.voucherNo).toLowerCase().includes(q) || String(p.supplierName || "").toLowerCase().includes(q),
        )
      : history;
    return list.slice(0, 8);
  }, [copyQuery, history]);

  const copyFromPo = async (po) => {
    try {
      const { data } = await api.get(`/po-generator/${po._id}/copy`);
      setForm({
        voucherNo: data.voucherNo || "",
        voucherDate: today(),
        paymentTerms: data.paymentTerms || "",
        referenceNo: data.referenceNo || "",
        otherReferences: data.otherReferences || "",
        dispatchedThrough: data.dispatchedThrough || "",
        destination: data.destination || "",
        termsOfDelivery: data.termsOfDelivery || "",
        supplierId: data.supplierVendor || "",
        supplierSource: data.supplierVendor ? "vendor" : "",
        supplierName: data.supplierName || "",
        supplierAddress: data.supplierAddress || "",
        supplierGSTIN: data.supplierGSTIN || "",
        supplierStateName: data.supplierStateName || "",
        supplierStateCode: data.supplierStateCode || "",
        consigneeName: data.consigneeName || "",
        consigneeAddress: data.consigneeAddress || "",
        taxType: data.taxType || "IGST",
        taxRate: data.taxRate ?? 18,
        declaration: data.declaration || "",
        items: (data.items || [emptyItem()]).map((it) => ({
          partId: it.partId || "",
          description: it.description || "",
          partNo: it.partNo || "",
          hsnSac: it.hsnSac || "",
          dueOn: toDateInput(it.dueOn),
          quantity: it.quantity ?? "",
          unit: it.unit || "NOS",
          rate: it.rate ?? "",
          per: it.per || "NOS",
        })),
      });
      setPartyQuery(data.supplierName || "");
      setPickedParty(null);
      setCopySource(data.sourceVoucherNo || po.voucherNo);
      setCopyOpen(false);
      setCopyQuery("");
      setGenerated(null);
      toast.success(`Copied ${po.voucherNo} — new voucher no. ${data.voucherNo}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("Could not copy that purchase order");
    }
  };

  const resetForm = async () => {
    setForm(blankForm());
    setGenerated(null);
    setCopySource(null);
    setPickedParty(null);
    setPartyQuery("");
    const { data } = await api.get("/po-generator/next-no").catch(() => ({ data: {} }));
    if (data?.voucherNo) setForm((f) => ({ ...f, voucherNo: data.voucherNo, declaration: data.declaration || "" }));
  };

  const liveSubTotal = form.items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
    0,
  );
  const liveTaxRate = form.taxType === "NONE" ? 0 : Number(form.taxRate) || 0;
  const liveTax = (liveSubTotal * liveTaxRate) / 100;
  const liveTotal = Math.round(liveSubTotal + liveTax);

  const submit = async (e) => {
    e.preventDefault();
    if (voucherNoTaken) return;
    if (form.items.some((it) => !it.partNo)) {
      toast.error("Every line item must be picked from the part master");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/po-generator", form);
      setGenerated(data);
      setCopySource(null);
      toast.success(`Purchase order ${data.voucherNo} generated — sent to the admin for approval`);
      loadHistory();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not generate the purchase order");
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (po) => {
    // The server refuses unapproved documents; catch it here for a clear message.
    if (po?.approvalStatus && po.approvalStatus !== "approved") {
      toast.error(
        po.approvalStatus === "rejected"
          ? "This PO was rejected by the admin."
          : "This PO is waiting for admin approval."
      );
      return;
    }
    setDownloading(true);
    try {
      const res = await api.get(`/po-generator/${po._id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${String(po.voucherNo).replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err?.response?.status === 403
        ? "This PO still needs admin approval before it can be downloaded."
        : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8">
      <h1 className="font-display text-2xl font-semibold">Purchase order generator</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Raise a purchase order on a supplier and download it as a PDF in the Technotrendz format.
      </p>

      {/* copy an existing PO */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-display">Copy an existing PO</CardTitle>
          <CardDescription>
            Reuse a previous purchase order — the copy is numbered as a revision (07 → 07A) and the running series stays
            untouched.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative z-40" ref={copyBoxRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by voucher no. or supplier…"
              value={copyQuery}
              onFocus={() => setCopyOpen(true)}
              onChange={(e) => {
                setCopyQuery(e.target.value);
                setCopyOpen(true);
              }}
            />
            {copyOpen && (
              <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate">
                <ul className="max-h-64 overflow-y-auto bg-card">
                  {copyMatches.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No matching purchase order.</li>
                  )}
                  {copyMatches.map((po) => (
                    <li key={po._id}>
                      <button
                        type="button"
                        onClick={() => copyFromPo(po)}
                        className="flex w-full items-center justify-between gap-3 bg-card px-3 py-2 text-left hover:bg-secondary"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{po.voucherNo}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {po.supplierName} · {new Date(po.voucherDate).toLocaleDateString()}
                          </span>
                        </span>
                        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {copySource && (
            <div className="mt-3 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>
                Copying from <span className="font-medium">{copySource}</span> — this will be saved as{" "}
                <span className="font-medium">{form.voucherNo}</span>.
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
                <X className="h-3.5 w-3.5 mr-1.5" /> Start a fresh PO
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Voucher details</CardTitle>
            <CardDescription>The voucher no. is suggested automatically and stays editable.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Voucher no.</Label>
              <Input
                value={form.voucherNo}
                onChange={set("voucherNo")}
                className={voucherNoTaken ? "border-destructive focus-visible:ring-destructive" : ""}
                required
              />
              {voucherNoTaken && (
                <p className="text-xs text-destructive">This voucher no. already exists — pick another one.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Dated</Label>
              <Input type="date" value={form.voucherDate} onChange={set("voucherDate")} required />
            </div>
            <div className="space-y-1.5">
              <Label>Reference no. &amp; date</Label>
              <Input value={form.referenceNo} onChange={set("referenceNo")} />
            </div>
            <div className="space-y-1.5">
              <Label>Other references</Label>
              <Input value={form.otherReferences} onChange={set("otherReferences")} />
            </div>
            <div className="space-y-1.5">
              <Label>Dispatched through</Label>
              <Input value={form.dispatchedThrough} onChange={set("dispatchedThrough")} />
            </div>
            <div className="space-y-1.5">
              <Label>Destination</Label>
              <Input value={form.destination} onChange={set("destination")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Mode/terms of payment</Label>
              <Textarea rows={2} value={form.paymentTerms} onChange={set("paymentTerms")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Terms of delivery</Label>
              <Textarea rows={4} value={form.termsOfDelivery} onChange={set("termsOfDelivery")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Supplier (bill from)</CardTitle>
            <CardDescription>
              Search across registered vendors and buyers — details are filled in automatically and stay editable.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative z-40 space-y-1.5 sm:col-span-2" ref={partyBoxRef}>
              <Label>Supplier name</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={partyQuery}
                  placeholder="Start typing a vendor or buyer name…"
                  onFocus={() => setPartyOpen(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPartyQuery(value);
                    setPickedParty(null);
                    setPartyOpen(true);
                    setForm((f) => ({
                      ...f,
                      supplierId: "",
                      supplierSource: "",
                      supplierName: value,
                    }));
                  }}
                  required
                />
                {partyOpen && (
                  <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate">
                    <ul className="max-h-64 overflow-y-auto bg-card">
                      {partyLoading && <li className="px-3 py-2 text-sm text-muted-foreground">Searching…</li>}
                      {!partyLoading && partyResults.length === 0 && (
                        <li className="px-3 py-2 text-sm text-muted-foreground">
                          No match — the name you typed will be used as-is.
                        </li>
                      )}
                      {!partyLoading &&
                        partyResults.map((p) => (
                          <li key={`${p.source}-${p.id}`}>
                            <button
                              type="button"
                              onClick={() => pickParty(p)}
                              className="flex w-full items-start justify-between gap-3 bg-card px-3 py-2 text-left hover:bg-secondary"
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium truncate">
                                  {p.name}
                                  {p.activeStatus === "inactive" && (
                                    <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] uppercase text-destructive">
                                      Inactive
                                    </span>
                                  )}
                                </span>
                                <span className="block text-xs text-muted-foreground truncate">
                                  {p.gstin ? `GSTIN ${p.gstin}` : "No GSTIN on file"}
                                  {p.address ? ` · ${p.address}` : ""}
                                </span>
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                                {p.source}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
              {pickedParty && (
                <p className="text-xs text-muted-foreground">
                  Pulled from the {pickedParty.source} records ·{" "}
                  <button type="button" className="underline" onClick={clearParty}>
                    clear
                  </button>
                </p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Supplier address</Label>
              <Textarea rows={2} value={form.supplierAddress} onChange={set("supplierAddress")} />
            </div>
            <div className="space-y-1.5">
              <Label>GSTIN/UIN</Label>
              <Input value={form.supplierGSTIN} onChange={(e) => setGstin(e.target.value)} />
              {form.supplierGSTIN.trim() && form.taxType !== "NONE" && (
                <p className="text-xs text-muted-foreground">
                  {form.supplierGSTIN.trim().startsWith("06")
                    ? "State code 06 — CGST + SGST applied."
                    : "Out-of-state GSTIN — IGST applied."}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>State name</Label>
              <Input value={form.supplierStateName} onChange={set("supplierStateName")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Consignee (ship to)</CardTitle>
            <CardDescription>Leave blank to print our own works address.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Consignee name</Label>
              <Input value={form.consigneeName} onChange={set("consigneeName")} placeholder="Technotrendz (default)" />
            </div>
            <div className="space-y-1.5">
              <Label>Consignee address</Label>
              <Input value={form.consigneeAddress} onChange={set("consigneeAddress")} placeholder="Plot 101 (default)" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Items</CardTitle>
            <CardDescription>Pick each line from the part master — quantity × rate feeds the total.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.items.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <div className="space-y-1.5 sm:col-span-8">
                  <Label>Part (from part master)</Label>
                  <PartPicker
                    item={item}
                    onPick={(part) => pickItemPart(i, part)}
                    onClear={() => clearItemPart(i)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>HSN/SAC</Label>
                  <Input value={item.hsnSac} onChange={setItem(i, "hsnSac")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Due on</Label>
                  <Input type="date" value={item.dueOn} onChange={setItem(i, "dueOn")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Quantity</Label>
                  <Input type="number" min="0" value={item.quantity} onChange={setItem(i, "quantity")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Unit</Label>
                  <Input value={item.unit} onChange={setItem(i, "unit")} placeholder="NOS" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Rate</Label>
                  <Input type="number" min="0" value={item.rate} onChange={setItem(i, "rate")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>per</Label>
                  <Input value={item.per} onChange={setItem(i, "per")} placeholder="NOS" />
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <p className="font-mono-tech text-sm py-2">
                    {fmtIndian((Number(item.quantity) || 0) * (Number(item.rate) || 0))}
                  </p>
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add item
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Tax &amp; declaration</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tax type</Label>
              <Select value={form.taxType} onValueChange={(v) => setForm((f) => ({ ...f, taxType: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IGST">IGST</SelectItem>
                  <SelectItem value="CGST_SGST">CGST + SGST</SelectItem>
                  <SelectItem value="NONE">None</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Set from the supplier's GSTIN — change it only if needed.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Tax rate (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={form.taxRate}
                onChange={set("taxRate")}
                disabled={form.taxType === "NONE"}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Declaration</Label>
              <Textarea rows={4} value={form.declaration} onChange={set("declaration")} />
            </div>
          </CardContent>
          <CardFooter className="justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Subtotal <span className="font-mono-tech text-foreground">{fmtIndian(liveSubTotal)}</span>
              {liveTaxRate > 0 && (
                <>
                  {" "}
                  + tax <span className="font-mono-tech text-foreground">{fmtIndian(liveTax)}</span>
                </>
              )}{" "}
              = <span className="font-mono-tech font-semibold text-foreground">{fmtIndian(liveTotal)}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button type="submit" disabled={submitting || voucherNoTaken}>
                <FileText className="h-4 w-4 mr-2" />
                {submitting ? "Generating..." : "Generate PO"}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>

      {generated && (
        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold">Preview</h2>
              <ApprovalBadge status={generated.approvalStatus} />
            </div>
            <Button
              onClick={() => download(generated)}
              disabled={downloading || generated.approvalStatus !== "approved"}
              title={
                generated.approvalStatus === "approved"
                  ? "Download the PDF"
                  : "Available once the admin approves this PO"
              }
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
          <div className="overflow-x-auto thin-scroll rounded-md bg-muted p-4">
            <PoPreview po={generated} />
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold mb-1">Previously generated</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Every purchase order raised here, newest first.
        </p>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Voucher no.</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory && <TableEmpty colSpan={7}>Loading…</TableEmpty>}
                {!loadingHistory && history.length === 0 && (
                  <TableEmpty colSpan={7}>No purchase orders generated yet.</TableEmpty>
                )}
                {!loadingHistory &&
                  history.map((po) => (
                    <TableRow key={po._id}>
                      <TableCell>
                        <span className="id-chip">{po.voucherNo}</span>
                      </TableCell>
                      <TableCell className="font-medium">{po.supplierName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(po.voucherDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">{po.status || "open"}</TableCell>
                      <TableCell>
                        <ApprovalBadge status={po.approvalStatus} />
                      </TableCell>
                      <TableCell className="text-right font-mono-tech">{fmtIndian(po.totalAmount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setGenerated(po)}>
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={po.approvalStatus !== "approved"}
                            onClick={() => download(po)}
                          >
                            <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
