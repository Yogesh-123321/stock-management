import { useEffect, useRef, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import api from "@/lib/api";
import PiPreview from "@/components/PiPreview";
import { Plus, Trash2, FileText, Download, RotateCcw, Search, Copy } from "lucide-react";

const DEFAULT_SPECIAL_NOTE = "Proforma Invoice as per agreed terms & conditions.";
const DEFAULT_PAYMENT_TERMS =
  "100 % Payment against Purchase order. Material will be dispatched after the 30 days of full payment.";
const DEFAULT_BANK_DETAILS =
  "HDFC BANK, LOHA MANDI SEC-59, BALLABGARH, FARIDABAD, HARYANA, 121004\nAC No. : 50200121459015, IFSC Code : HDFC0010776";

const emptyItem = () => ({ description: "", hsnSac: "", quantity: "1", rate: "" });

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  invoiceNo: "",
  invoiceDate: todayISO(),
  buyerName: "",
  buyerAddress: "",
  buyerGSTIN: "",
  buyerContact: "",
  buyerEmail: "",
  buyerDated: "",
  specialNote: DEFAULT_SPECIAL_NOTE,
  paymentTerms: DEFAULT_PAYMENT_TERMS,
  bankDetails: DEFAULT_BANK_DETAILS,
  taxType: "IGST",
  taxRate: "18",
  items: [emptyItem()],
});

const fmtIndian = (n) => {
  const num = Number(n) || 0;
  const isInt = Number.isInteger(num);
  const [intPart, decPart] = Math.abs(num).toFixed(isInt ? 0 : 2).split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${num < 0 ? "-" : ""}${grouped}${decPart ? "." + decPart : ""}`;
};

// Haryana (state code 06) is an intra-state supply → CGST + SGST; every other
// state code is inter-state → IGST. Mirrors the same rule on the server.
const taxTypeForGstin = (gstin) => {
  const cleaned = String(gstin || "").trim();
  if (!cleaned) return null;
  return cleaned.startsWith("06") ? "CGST_SGST" : "IGST";
};

/**
 * PIs now go to the central admin for sign-off before the PDF is released.
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

export default function PiGenerator() {
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [generated, setGenerated] = useState(null); // last generated PI record, for preview
  const [downloading, setDownloading] = useState(false);

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Set when the form was filled from an existing PI — the number then carries
  // a revision letter (07 → 07A) instead of taking the next series number.
  const [copiedFrom, setCopiedFrom] = useState(null);
  const [copyingId, setCopyingId] = useState(null);
  // Top-of-page "copy an existing PI" picker
  const [copyQuery, setCopyQuery] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const copyBoxRef = useRef(null);

  // Buyer lookup (vendors + buyers, live as you type)
  const [partyQuery, setPartyQuery] = useState("");
  const [partyResults, setPartyResults] = useState([]);
  const [partyOpen, setPartyOpen] = useState(false);
  const [partyLoading, setPartyLoading] = useState(false);
  const [pickedParty, setPickedParty] = useState(null);
  const partyBoxRef = useRef(null);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data } = await api.get("/pi-generator");
      setHistory(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load previously generated PIs");
    } finally {
      setLoadingHistory(false);
    }
  };

  // The next number in the TISPL/PI series — suggested, still fully editable.
  const loadNextInvoiceNo = async (date) => {
    try {
      const { data } = await api.get("/pi-generator/next-no", { params: { date } });
      setForm((f) => (f.invoiceNo ? f : { ...f, invoiceNo: data.invoiceNo }));
    } catch {
      /* the field stays empty and the server fills it in on generate */
    }
  };

  useEffect(() => {
    loadHistory();
    loadNextInvoiceNo(todayISO());
  }, []);

  // Debounced party search — results refresh with every letter typed and
  // match anywhere in the name, case-insensitively ("du" finds "DUMMY").
  useEffect(() => {
    const q = partyQuery.trim();
    if (!partyOpen) return;
    const t = setTimeout(async () => {
      setPartyLoading(true);
      try {
        const { data } = await api.get("/pi-generator/parties", { params: { search: q } });
        setPartyResults(data);
      } catch {
        setPartyResults([]);
      } finally {
        setPartyLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [partyQuery, partyOpen]);

  // Close the dropdown when clicking away
  useEffect(() => {
    const onClick = (e) => {
      if (partyBoxRef.current && !partyBoxRef.current.contains(e.target)) setPartyOpen(false);
      if (copyBoxRef.current && !copyBoxRef.current.contains(e.target)) setCopyOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // GSTIN drives the tax type automatically, wherever it comes from.
  const setGstin = (value) =>
    setForm((f) => {
      const derived = taxTypeForGstin(value);
      return { ...f, buyerGSTIN: value, taxType: f.taxType === "NONE" ? "NONE" : derived || f.taxType };
    });

  const pickParty = (party) => {
    setPickedParty(party);
    setPartyQuery(party.name);
    setPartyOpen(false);
    const derived = taxTypeForGstin(party.gstin);
    setForm((f) => ({
      ...f,
      buyerName: party.name,
      buyerAddress: party.address || "",
      buyerGSTIN: party.gstin || "",
      buyerContact: party.contact || "",
      buyerEmail: party.email || "",
      taxType: f.taxType === "NONE" ? "NONE" : derived || f.taxType,
    }));
  };

  const clearParty = () => {
    setPickedParty(null);
    setPartyQuery("");
    setForm((f) => ({ ...f, buyerName: "", buyerAddress: "", buyerGSTIN: "", buyerContact: "", buyerEmail: "" }));
  };

  const setItem = (i, key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], [key]: value };
      return { ...f, items };
    });
  };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (i) =>
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, idx) => idx !== i) : f.items }));

  // Live, client-side estimate — the authoritative totals come back from the
  // server on generate, same pattern as everywhere else amounts are shown.
  const liveSubTotal = form.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const liveTaxRate = form.taxType === "NONE" ? 0 : Number(form.taxRate) || 0;
  const liveTax = liveSubTotal * (liveTaxRate / 100);
  const liveTotal = liveSubTotal + liveTax;

  // A PI number can never be reused — the list of numbers already on record is
  // right here in the history, so the clash is caught before we ever submit.
  const usedInvoiceNos = useMemo(
    () => new Set(history.map((pi) => String(pi.invoiceNo || "").trim().toUpperCase())),
    [history],
  );
  const invoiceNoTaken = usedInvoiceNos.has(form.invoiceNo.trim().toUpperCase()) && form.invoiceNo.trim() !== "";

  // Matches anywhere in the number or the buyer name, case-insensitively.
  const copyMatches = useMemo(() => {
    const q = copyQuery.trim().toLowerCase();
    const list = q
      ? history.filter(
          (pi) =>
            String(pi.invoiceNo || "").toLowerCase().includes(q) ||
            String(pi.buyerName || "").toLowerCase().includes(q),
        )
      : history;
    return list.slice(0, 8);
  }, [copyQuery, history]);

  const resetForm = () => {
    setForm(emptyForm());
    setGenerated(null);
    setCopiedFrom(null);
    clearParty();
    loadNextInvoiceNo(todayISO());
  };

  // Copy an earlier PI into the form. Everything is pre-filled and editable,
  // and the invoice no. comes back from the server as the next revision of the
  // source number (07 → 07A → 07B) so the main series is untouched.
  const copyFromPI = async (pi) => {
    setCopyingId(pi._id);
    try {
      const { data } = await api.get(`/pi-generator/${pi._id}/copy`);
      setForm({
        invoiceNo: data.invoiceNo || "",
        invoiceDate: data.invoiceDate || todayISO(),
        buyerName: data.buyerName || "",
        buyerAddress: data.buyerAddress || "",
        buyerGSTIN: data.buyerGSTIN || "",
        buyerContact: data.buyerContact || "",
        buyerEmail: data.buyerEmail || "",
        buyerDated: data.buyerDated || "",
        specialNote: data.specialNote || DEFAULT_SPECIAL_NOTE,
        paymentTerms: data.paymentTerms || DEFAULT_PAYMENT_TERMS,
        bankDetails: data.bankDetails || DEFAULT_BANK_DETAILS,
        taxType: data.taxType || "IGST",
        taxRate: String(data.taxRate ?? "18"),
        items:
          data.items?.length > 0
            ? data.items.map((it) => ({
                description: it.description || "",
                hsnSac: it.hsnSac || "",
                quantity: String(it.quantity ?? ""),
                rate: String(it.rate ?? ""),
              }))
            : [emptyItem()],
      });
      setPickedParty(null);
      setPartyQuery(data.buyerName || "");
      setGenerated(null);
      setCopiedFrom(data.copiedFrom || { invoiceNo: pi.invoiceNo });
      setCopyQuery("");
      setCopyOpen(false);
      toast.success(`Copied ${pi.invoiceNo} → ${data.invoiceNo}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not copy that PI");
    } finally {
      setCopyingId(null);
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!form.invoiceNo.trim() || !form.buyerName.trim()) {
      toast.error("Invoice no. and buyer name are required");
      return;
    }
    if (invoiceNoTaken) {
      toast.error(`${form.invoiceNo.trim()} already exists — use a different number or copy that PI instead`);
      return;
    }
    if (form.items.some((it) => !it.description.trim() || !it.quantity || !it.rate)) {
      toast.error("Every item needs a description, quantity and rate");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post("/pi-generator", {
        ...form,
        buyerDated: form.buyerDated || undefined,
        items: form.items.map((it) => ({
          description: it.description,
          hsnSac: it.hsnSac,
          quantity: Number(it.quantity),
          rate: Number(it.rate),
        })),
      });
      setGenerated(data);
      toast.success("PI generated — sent to the admin for approval");
      loadHistory();
      // Back to a fresh PI: the form moves on to the next number in the main
      // series, even if the one just generated was a revision copy.
      setCopiedFrom(null);
      setForm((f) => ({ ...f, invoiceNo: "" }));
      loadNextInvoiceNo(form.invoiceDate);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not generate PI");
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (pi) => {
    if (pi?.approvalStatus && pi.approvalStatus !== "approved") {
      toast.error(
        pi.approvalStatus === "rejected"
          ? "This PI was rejected by the admin."
          : "This PI is waiting for admin approval."
      );
      return;
    }
    setDownloading(true);
    try {
      const { data } = await api.get(`/pi-generator/${pi._id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const safeName = (pi.invoiceNo || "PI").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the file — try again");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">PI generator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fill in the buyer and item details to generate a Proforma Invoice in the standard TISPL format —
          preview it below, then download the PDF.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Copy className="h-4 w-4" /> Copy an existing PI
          </CardTitle>
          <CardDescription>
            Search by invoice no. or buyer and pick one — the buyer, items and terms are pulled in and the number
            becomes the next revision of that PI (07 → 07A), never a new number in the series.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xl" ref={copyBoxRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search a previous PI to copy…"
              value={copyQuery}
              onChange={(e) => {
                setCopyQuery(e.target.value);
                setCopyOpen(true);
              }}
              onFocus={() => setCopyOpen(true)}
            />
            {copyOpen && (
              <div className="absolute z-[60] mt-1 w-full rounded-md border bg-white shadow-lg max-h-72 overflow-auto thin-scroll">
                {loadingHistory && <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>}
                {!loadingHistory && copyMatches.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No matching PI.</div>
                )}
                {!loadingHistory &&
                  copyMatches.map((pi) => (
                    <button
                      key={pi._id}
                      type="button"
                      disabled={copyingId === pi._id}
                      onClick={() => copyFromPI(pi)}
                      className="w-full text-left px-3 py-2 text-sm bg-white hover:bg-slate-100 disabled:opacity-60"
                    >
                      <span className="font-medium">{pi.invoiceNo}</span>
                      <span className="text-muted-foreground"> — {pi.buyerName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(pi.invoiceDate).toLocaleDateString()} • {fmtIndian(pi.totalAmount)}
                        {copyingId === pi._id ? " • copying…" : ""}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {copiedFrom && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            Copied from <span className="font-medium">{copiedFrom.invoiceNo}</span> — this will be saved as revision{" "}
            <span className="font-medium">{form.invoiceNo}</span>, so the main series is unaffected.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={resetForm}>
            Start a fresh PI
          </Button>
        </div>
      )}

      <form onSubmit={handleGenerate} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Invoice details</CardTitle>
            <CardDescription>
              The invoice no. follows the TISPL/PI series for the financial year and increments with every PI —
              copies of an existing PI get a revision letter (07 → 07A → 07B) instead. Edit it if you need a
              different one.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Invoice no.</Label>
              <Input
                value={form.invoiceNo}
                onChange={set("invoiceNo")}
                placeholder="TISPL/PI/07/26-27"
                aria-invalid={invoiceNoTaken}
                className={invoiceNoTaken ? "border-destructive focus-visible:ring-destructive" : undefined}
                required
              />
              {invoiceNoTaken && (
                <p className="text-xs text-destructive">
                  This PI number already exists — pick another, or copy that PI to create a revision.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Invoice date</Label>
              <Input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({ ...f, invoiceDate: value }));
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Buyer's PO / reference date (optional)</Label>
              <Input type="date" value={form.buyerDated} onChange={set("buyerDated")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Buyer</CardTitle>
            <CardDescription>
              Search across registered buyers and vendors — details are filled in automatically and stay editable.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2" ref={partyBoxRef}>
              <Label>Buyer name</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={partyQuery}
                  placeholder="Start typing a buyer or vendor name…"
                  onFocus={() => setPartyOpen(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setPartyQuery(value);
                    setPickedParty(null);
                    setPartyOpen(true);
                    setForm((f) => ({ ...f, buyerName: value }));
                  }}
                  required
                />
                {partyOpen && (
                  <div
                    className="absolute left-0 top-full z-[60] mt-1 w-full rounded-md border border-slate-300 bg-white text-slate-900 shadow-xl max-h-64 overflow-y-auto"
                    style={{ backgroundColor: "#ffffff" }}
                  >
                    {partyLoading && <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>}
                    {!partyLoading && partyResults.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        No match — the name you typed will be used as-is.
                      </div>
                    )}
                    {!partyLoading &&
                      partyResults.map((p) => (
                        <button
                          type="button"
                          key={`${p.source}-${p.id}`}
                          onClick={() => pickParty(p)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-100 flex items-start justify-between gap-3"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{p.name}</span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {p.gstin ? `GSTIN ${p.gstin}` : "No GSTIN on file"}
                              {p.address ? ` · ${p.address}` : ""}
                            </span>
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                            {p.source}
                          </span>
                        </button>
                      ))}
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
              <Label>Buyer address</Label>
              <Textarea rows={2} value={form.buyerAddress} onChange={set("buyerAddress")} />
            </div>
            <div className="space-y-1.5">
              <Label>GSTIN/UIN</Label>
              <Input value={form.buyerGSTIN} onChange={(e) => setGstin(e.target.value)} />
              {form.buyerGSTIN.trim() && form.taxType !== "NONE" && (
                <p className="text-xs text-muted-foreground">
                  {form.buyerGSTIN.trim().startsWith("06")
                    ? "State code 06 — CGST + SGST applied."
                    : "Out-of-state GSTIN — IGST applied."}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Contact</Label>
              <Input value={form.buyerContact} onChange={set("buyerContact")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={form.buyerEmail} onChange={set("buyerEmail")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Items</CardTitle>
            <CardDescription>Add one row per line item — HSN/SAC and quantity/rate feed the total.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.items.map((item, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="space-y-1.5 sm:col-span-5">
                  <Label>Description</Label>
                  <Input value={item.description} onChange={setItem(i, "description")} placeholder="Tactical Thermal Box" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>HSN/SAC</Label>
                  <Input value={item.hsnSac} onChange={setItem(i, "hsnSac")} placeholder="39231030" />
                </div>
                <div className="space-y-1.5 sm:col-span-1">
                  <Label>Qty</Label>
                  <Input type="number" min="0" value={item.quantity} onChange={setItem(i, "quantity")} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Rate</Label>
                  <Input type="number" min="0" value={item.rate} onChange={setItem(i, "rate")} placeholder="200000" />
                </div>
                <div className="space-y-1.5 sm:col-span-1">
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
            <CardTitle className="text-base font-display">Tax, notes & bank details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Tax type</Label>
              <Select value={form.taxType} onValueChange={(v) => setForm((f) => ({ ...f, taxType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IGST">IGST</SelectItem>
                  <SelectItem value="CGST_SGST">CGST + SGST</SelectItem>
                  <SelectItem value="NONE">None</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Set from the buyer's GSTIN — change it only if needed.</p>
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
              <Label>Special note</Label>
              <Textarea rows={2} value={form.specialNote} onChange={set("specialNote")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Mode/terms of payment</Label>
              <Textarea rows={2} value={form.paymentTerms} onChange={set("paymentTerms")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Bank details</Label>
              <Textarea rows={3} value={form.bankDetails} onChange={set("bankDetails")} />
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
              <Button type="submit" disabled={submitting || invoiceNoTaken}>
                <FileText className="h-4 w-4 mr-2" />
                {submitting ? "Generating..." : "Generate PI"}
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
                  : "Available once the admin approves this PI"
              }
            >
              <Download className="h-4 w-4 mr-2" />
              {downloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
          <div className="overflow-x-auto thin-scroll rounded-md bg-muted p-4">
            <PiPreview pi={generated} />
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold mb-1">Previously generated</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Every PI ever generated, newest first. To reuse one, use <span className="font-medium">Copy an existing
          PI</span> at the top of this page.
        </p>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice no.</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
                {!loadingHistory && history.length === 0 && <TableEmpty colSpan={6}>No PIs generated yet.</TableEmpty>}
                {!loadingHistory &&
                  history.map((pi) => (
                    <TableRow key={pi._id}>
                      <TableCell>
                        <span className="id-chip">{pi.invoiceNo}</span>
                      </TableCell>
                      <TableCell className="font-medium">{pi.buyerName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(pi.invoiceDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <ApprovalBadge status={pi.approvalStatus} />
                      </TableCell>
                      <TableCell className="text-right font-mono-tech">{fmtIndian(pi.totalAmount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setGenerated(pi)}>
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pi.approvalStatus !== "approved"}
                            onClick={() => download(pi)}
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
