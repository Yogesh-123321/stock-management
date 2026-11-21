// frontend/src/pages/ChallanGenerator.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import api from "@/lib/api";
import { stateFromGstin } from "@/lib/gstStates";
import { SortableHead, useSort } from "@/components/SortableHead";
import ChallanPreview from "@/components/ChallanPreview";
import { Plus, Trash2, FileText, Download, RotateCcw, Search, Copy, Eye } from "lucide-react";

const emptyItem = () => ({ description: "", hsnSac: "", quantity: "1", unit: "NOS", rate: "" });
const emptyParty = () => ({ name: "", address: "", gstin: "", stateName: "", stateCode: "" });

const todayISO = () => new Date().toISOString().slice(0, 10);
// <input type="datetime-local"> works in the browser's local time.
const toLocalInput = (value) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");

const emptyForm = () => ({
  challanNo: "",
  challanType: "RETURNABLE",
  challanDate: todayISO(),
  dateTimeOfIssue: toLocalInput(),
  referenceNoDate: "",
  buyersOrderNo: "",
  buyersOrderDate: "",
  dispatchDocNo: "",
  dispatchedThrough: "",
  destination: "",
  motorVehicleNo: "",
  modeTermsOfPayment: "",
  otherReferences: "",
  durationOfProcess: "",
  natureOfProcessing: "",
  taxType: "IGST",
  taxRate: "18",
  items: [emptyItem()],
});

const fmtIndian = (n) => {
  const num = Number(n) || 0;
  const [intPart, decPart] = Math.abs(num).toFixed(2).split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${num < 0 ? "-" : ""}${grouped}.${decPart}`;
};

// Haryana (06) is intra-state -> CGST + SGST, every other state -> IGST.
const taxTypeForGstin = (gstin) => {
  const cleaned = String(gstin || "").trim();
  if (!cleaned) return null;
  return cleaned.startsWith("06") ? "CGST_SGST" : "IGST";
};

function StatusBadge({ status }) {
  const closed = status === "closed";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
        closed
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : "bg-amber-100 text-amber-800 border-amber-200"
      }`}
    >
      {closed ? "Returned / closed" : "Open"}
    </span>
  );
}

/** Name box with live buyer + vendor lookup; picking one fills the whole block. */
function PartyBlockForm({ title, description, party, onChange, onPick, extra }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null); // registered buyer/vendor chosen from the list
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/challan-generator/parties", { params: { q: party.name.trim() } });
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [party.name, open]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5 sm:col-span-2" ref={boxRef}>
          <Label>Name</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              value={party.name}
              placeholder="Start typing a buyer or vendor name…"
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                onChange("name", e.target.value);
                setPicked(null);
                setOpen(true);
              }}
            />
            {open && (
              <div
                className="keep-white absolute left-0 top-full z-[60] mt-1 w-full rounded-md border border-slate-300 bg-white text-[#0f172a] shadow-xl max-h-64 overflow-y-auto"
                style={{ backgroundColor: "#ffffff" }}
              >
                {loading && <div className="px-3 py-2 text-sm text-[#475569]">Searching…</div>}
                {party.name.trim() ? (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="keep-white w-full text-left px-3 py-2 text-sm bg-white text-[#1d4ed8] font-medium hover:bg-slate-100 border-b border-slate-200 flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4 shrink-0" />
                    <span className="truncate">Use “{party.name.trim()}” as a new party (not registered)</span>
                  </button>
                ) : (
                  <div className="px-3 py-2 text-xs text-[#475569] border-b border-slate-200">
                    Pick a registered buyer / vendor, or type any name to send to someone new.
                  </div>
                )}
                {!loading && results.length === 0 && party.name.trim() && (
                  <div className="px-3 py-2 text-sm text-[#475569]">No registered buyer or vendor matches.</div>
                )}
                {!loading &&
                  results.map((p) => (
                    <button
                      type="button"
                      key={`${p.type}-${p._id}`}
                      onClick={() => {
                        onPick(p);
                        setPicked(p);
                        setOpen(false);
                      }}
                      className="keep-white w-full text-left px-3 py-2 bg-white text-[#0f172a] hover:bg-slate-100 flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate text-[#0f172a]">{p.name}</span>
                        <span className="block text-xs text-[#475569] truncate">
                          {p.gstin ? `GSTIN ${p.gstin}` : "No GSTIN on file"}
                          {p.address ? ` · ${p.address}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b] shrink-0 mt-0.5">
                        {p.type}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          {picked ? (
            <p className="text-xs text-muted-foreground">
              Pulled from the registered {picked.type} records ·{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setPicked(null);
                  onPick({ name: "", address: "", gstin: "", stateName: "", stateCode: "" });
                }}
              >
                clear
              </button>
            </p>
          ) : (
            party.name.trim() && (
              <p className="text-xs text-amber-600">
                New party — not in your buyer / vendor records. Enter the address and GSTIN (if any) below; they are
                saved on this challan only.
              </p>
            )
          )}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Address</Label>
          <Textarea rows={2} value={party.address} onChange={(e) => onChange("address", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>GSTIN/UIN</Label>
          <Input value={party.gstin} onChange={(e) => onChange("gstin", e.target.value.toUpperCase())} />
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-3">
          <div className="space-y-1.5">
            <Label>State name</Label>
            <Input value={party.stateName} onChange={(e) => onChange("stateName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={party.stateCode} onChange={(e) => onChange("stateCode", e.target.value)} />
          </div>
        </div>
        {extra}
      </CardContent>
    </Card>
  );
}

export default function ChallanGenerator() {
  const [form, setForm] = useState(emptyForm());
  // "Party" = the company the challan is for. "Dispatch to" = where the goods actually go; it is
  // the same as the party unless the box below is unticked, so its address can differ.
  const [party, setParty] = useState(emptyParty());
  const [dispatchTo, setDispatchTo] = useState(emptyParty());
  const [sameDispatch, setSameDispatch] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [copiedFrom, setCopiedFrom] = useState(null);

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const { sort, toggle, apply } = useSort();
  const sortedHistory = apply(history, {
    challanNo: (r) => r.challanNo,
    party: (r) => r.party?.name || r.dispatchTo?.name,
    date: (r) => (r.challanDate ? new Date(r.challanDate).getTime() : null),
    status: (r) => r.status,
    total: (r) => Number(r.totalAmount),
  });

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data } = await api.get("/challan-generator");
      setHistory(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load previous challans");
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadNextNo = async (date) => {
    try {
      const { data } = await api.get("/challan-generator/next-no", { params: { date } });
      setForm((f) => (f.challanNo ? f : { ...f, challanNo: data.challanNo }));
    } catch {
      /* stays empty — it can be typed in */
    }
  };

  useEffect(() => {
    loadHistory();
    loadNextNo(todayISO());
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // --- parties ----------------------------------------------------------
  const changeParty = (setter) => (key, value) =>
    setter((p) => {
      const next = { ...p, [key]: value };
      // typing a GSTIN fills the state name / code from its first two digits
      if (key === "gstin") {
        const st = stateFromGstin(value);
        if (st.stateName) {
          next.stateName = st.stateName;
          next.stateCode = st.stateCode;
        }
      }
      return next;
    });
  const pickParty = (setter) => (p) =>
    setter({ name: p.name, address: p.address || "", gstin: p.gstin || "", stateName: p.stateName || "", stateCode: p.stateCode || "" });

  // GSTIN of the party drives the tax type (unless the challan is no-tax)
  const taxGstin = party.gstin || (sameDispatch ? "" : dispatchTo.gstin);
  useEffect(() => {
    const derived = taxTypeForGstin(taxGstin);
    if (derived) setForm((f) => (f.taxType === "NONE" ? f : { ...f, taxType: derived }));
  }, [taxGstin]);

  // --- items ----------------------------------------------------------------
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

  const liveSubTotal = form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const liveTaxRate = form.taxType === "NONE" ? 0 : Number(form.taxRate) || 0;
  const liveTax = liveSubTotal * (liveTaxRate / 100);
  const liveTotal = liveSubTotal + liveTax;

  const usedNos = useMemo(
    () => new Set(history.map((c) => String(c.challanNo || "").trim().toUpperCase())),
    [history]
  );
  const noTaken = form.challanNo.trim() !== "" && usedNos.has(form.challanNo.trim().toUpperCase());

  const filteredHistory = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return sortedHistory;
    return sortedHistory.filter(
      (c) =>
        String(c.challanNo || "").toLowerCase().includes(q) ||
        String(c.dispatchTo?.name || "").toLowerCase().includes(q) ||
        String(c.party?.name || "").toLowerCase().includes(q)
    );
  }, [sortedHistory, historyQuery]);

  const resetForm = () => {
    setForm(emptyForm());
    setParty(emptyParty());
    setDispatchTo(emptyParty());
    setSameDispatch(true);
    setGenerated(null);
    setCopiedFrom(null);
    loadNextNo(todayISO());
  };

  // Fill the form from an earlier challan (new number, today's date, time now).
  const copyFrom = async (c) => {
    try {
      const { data } = await api.get(`/challan-generator/${c._id}/copy`);
      setForm({
        challanNo: data.challanNo || "",
        challanType: data.challanType || "RETURNABLE",
        challanDate: toDateInput(data.challanDate) || todayISO(),
        dateTimeOfIssue: toLocalInput(data.dateTimeOfIssue),
        referenceNoDate: data.referenceNoDate || "",
        buyersOrderNo: data.buyersOrderNo || "",
        buyersOrderDate: toDateInput(data.buyersOrderDate),
        dispatchDocNo: data.dispatchDocNo || "",
        dispatchedThrough: data.dispatchedThrough || "",
        destination: data.destination || "",
        motorVehicleNo: data.motorVehicleNo || "",
        modeTermsOfPayment: data.modeTermsOfPayment || "",
        otherReferences: data.otherReferences || "",
        durationOfProcess: data.durationOfProcess || "",
        natureOfProcessing: data.natureOfProcessing || "",
        taxType: data.taxType || "IGST",
        taxRate: String(data.taxRate ?? "18"),
        items: data.items?.length
          ? data.items.map((it) => ({
              description: it.description || "",
              hsnSac: it.hsnSac || "",
              quantity: String(it.quantity ?? ""),
              unit: it.unit || "NOS",
              rate: String(it.rate ?? ""),
            }))
          : [emptyItem()],
      });
      const copiedParty = { ...emptyParty(), ...(data.party?.name ? data.party : data.dispatchTo || {}) };
      const copiedDispatch = { ...emptyParty(), ...(data.dispatchTo || {}) };
      const same =
        !copiedDispatch.name ||
        (copiedDispatch.name === copiedParty.name &&
          copiedDispatch.address === copiedParty.address &&
          copiedDispatch.gstin === copiedParty.gstin);
      setParty(copiedParty);
      setDispatchTo(same ? emptyParty() : copiedDispatch);
      setSameDispatch(same);
      setGenerated(null);
      setCopiedFrom(c.challanNo);
      toast.success(`Copied ${c.challanNo} → ${data.challanNo}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not copy that challan");
    }
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!form.challanNo.trim()) return toast.error("Challan no. is required");
    if (!party.name.trim()) return toast.error("Party name is required");
    if (!sameDispatch && !dispatchTo.name.trim()) return toast.error("Dispatch-to name is required");
    if (noTaken) return toast.error(`${form.challanNo.trim()} already exists — use a different number`);
    if (form.items.some((it) => !it.description.trim() || !it.quantity)) {
      return toast.error("Every item needs a description and quantity");
    }

    setSubmitting(true);
    try {
      const { data } = await api.post("/challan-generator", {
        ...form,
        // the picker is in local time — send an absolute instant
        dateTimeOfIssue: form.dateTimeOfIssue ? new Date(form.dateTimeOfIssue).toISOString() : undefined,
        buyersOrderDate: form.buyersOrderDate || undefined,
        party,
        dispatchTo: sameDispatch ? party : dispatchTo,
        items: form.items.map((it) => ({
          description: it.description,
          hsnSac: it.hsnSac,
          quantity: Number(it.quantity),
          unit: it.unit,
          rate: Number(it.rate) || 0,
        })),
      });
      setGenerated(data);
      toast.success("Challan generated");
      loadHistory();
      setCopiedFrom(null);
      setForm((f) => ({ ...f, challanNo: "" }));
      loadNextNo(form.challanDate);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not generate challan");
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (c) => {
    setDownloading(true);
    try {
      const { data } = await api.get(`/challan-generator/${c._id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      const safeName = (c.challanNo || "Challan").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not generate the PDF — try again");
    } finally {
      setDownloading(false);
    }
  };

  const toggleStatus = async (c) => {
    try {
      const { data } = await api.patch(`/challan-generator/${c._id}/status`, {
        status: c.status === "closed" ? "open" : "closed",
      });
      setHistory((h) => h.map((x) => (x._id === data._id ? data : x)));
      setGenerated((g) => (g && g._id === data._id ? data : g));
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the status");
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Challan generator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fill in the party and item details to generate a Delivery Challan in the standard Technotrendz format —
          preview it below, then download the PDF.
        </p>
      </div>

      {copiedFrom && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            Copied from <span className="font-medium">{copiedFrom}</span> — it will be saved as{" "}
            <span className="font-medium">{form.challanNo}</span>.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={resetForm}>
            Start a fresh challan
          </Button>
        </div>
      )}

      <form onSubmit={handleGenerate} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Challan details</CardTitle>
            <CardDescription>
              The number follows the TTZ/SPL&lt;FY&gt;/&lt;no.&gt; series for the financial year and increments with every challan —
              edit it if you need a different one.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>Challan no.</Label>
              <Input
                value={form.challanNo}
                onChange={set("challanNo")}
                placeholder="TTZ/SPL26-27/156"
                aria-invalid={noTaken}
                className={noTaken ? "border-destructive focus-visible:ring-destructive" : undefined}
                required
              />
              {noTaken && <p className="text-xs text-destructive">This challan number already exists.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.challanType} onValueChange={(v) => setForm((f) => ({ ...f, challanType: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETURNABLE">Returnable</SelectItem>
                  <SelectItem value="NON-RETURNABLE">Non-returnable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Challan date</Label>
              <Input type="date" value={form.challanDate} onChange={set("challanDate")} required />
            </div>
            <div className="space-y-1.5">
              <Label>Date &amp; time of issue</Label>
              <Input type="datetime-local" value={form.dateTimeOfIssue} onChange={set("dateTimeOfIssue")} />
            </div>
          </CardContent>
        </Card>

        <PartyBlockForm
          title="Party"
          description="The company the challan is made out to. Search registered buyers and vendors — details fill in automatically and stay editable."
          party={party}
          onChange={changeParty(setParty)}
          onPick={pickParty(setParty)}
          extra={
            <label className="sm:col-span-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameDispatch}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSameDispatch(checked);
                  // start the separate dispatch block from the party's details so only the address needs changing
                  if (!checked && !dispatchTo.name && !dispatchTo.address) setDispatchTo({ ...party });
                }}
                className="h-4 w-4"
              />
              The goods are dispatched to the same address as the party
            </label>
          }
        />

        {!sameDispatch && (
          <PartyBlockForm
            title="Dispatch to"
            description="Where the goods are actually being sent — printed in the “Dispatch To” box, and can differ from the party's address."
            party={dispatchTo}
            onChange={changeParty(setDispatchTo)}
            onPick={pickParty(setDispatchTo)}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">References &amp; transport</CardTitle>
            <CardDescription>All optional — whatever is filled in is printed in the matching box.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              ["referenceNoDate", "Reference no. & date"],
              ["buyersOrderNo", "Buyer's order no."],
              ["dispatchDocNo", "Dispatch doc no."],
              ["dispatchedThrough", "Dispatched through"],
              ["destination", "Destination"],
              ["motorVehicleNo", "Motor vehicle no."],
              ["modeTermsOfPayment", "Mode/terms of payment"],
              ["otherReferences", "Other references"],
              ["durationOfProcess", "Duration of process"],
            ].map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input value={form[key]} onChange={set(key)} />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label>Buyer's order date</Label>
              <Input type="date" value={form.buyersOrderDate} onChange={set("buyersOrderDate")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nature of processing</Label>
              <Input value={form.natureOfProcessing} onChange={set("natureOfProcessing")} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Items</CardTitle>
            <CardDescription>One row per line item — quantity × rate feeds the totals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.items.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end border-b border-border pb-4 last:border-0 last:pb-0"
              >
                <div className="space-y-1.5 sm:col-span-4">
                  <Label>Description of goods</Label>
                  <Input value={item.description} onChange={setItem(i, "description")} placeholder="EM LOCK" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>HSN/SAC</Label>
                  <Input value={item.hsnSac} onChange={setItem(i, "hsnSac")} placeholder="85365090" />
                </div>
                <div className="space-y-1.5 sm:col-span-1">
                  <Label>Qty</Label>
                  <Input type="number" min="0" step="any" value={item.quantity} onChange={setItem(i, "quantity")} />
                </div>
                <div className="space-y-1.5 sm:col-span-1">
                  <Label>Unit</Label>
                  <Input value={item.unit} onChange={setItem(i, "unit")} placeholder="NOS" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Rate</Label>
                  <Input type="number" min="0" step="any" value={item.rate} onChange={setItem(i, "rate")} />
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
            <CardTitle className="text-base font-display">Tax</CardTitle>
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
              <p className="text-xs text-muted-foreground">
                Set from the party's GSTIN (state code 06 → CGST + SGST, otherwise IGST) — change it only if needed.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tax rate (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.taxRate}
                onChange={set("taxRate")}
                disabled={form.taxType === "NONE"}
              />
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
              <Button type="submit" disabled={submitting || noTaken}>
                <FileText className="h-4 w-4 mr-2" />
                {submitting ? "Generating..." : "Generate challan"}
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
              <span className="id-chip">{generated.challanNo}</span>
              <StatusBadge status={generated.status} />
            </div>
            <Button onClick={() => download(generated)} disabled={downloading}>
              <Download className="h-4 w-4 mr-2" />
              {downloading ? "Preparing..." : "Download PDF"}
            </Button>
          </div>
          <div className="overflow-x-auto thin-scroll rounded-md bg-muted p-4">
            <ChallanPreview challan={generated} />
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="font-display text-lg font-semibold mb-1">Previously generated</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Every challan generated so far, newest first. Mark a returnable challan as returned once the goods are back.
        </p>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by challan no. or party…"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Challan no." sortKey="challanNo" sort={sort} onSort={toggle} />
                  <SortableHead label="Party" sortKey="party" sort={sort} onSort={toggle} />
                  <SortableHead label="Date" sortKey="date" sort={sort} onSort={toggle} />
                  <TableHead>Type</TableHead>
                  <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggle} />
                  <SortableHead label="Total" sortKey="total" sort={sort} onSort={toggle} align="right" />
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingHistory && <TableEmpty colSpan={7}>Loading…</TableEmpty>}
                {!loadingHistory && filteredHistory.length === 0 && (
                  <TableEmpty colSpan={7}>No challans found.</TableEmpty>
                )}
                {!loadingHistory &&
                  filteredHistory.map((c) => (
                    <TableRow key={c._id}>
                      <TableCell>
                        <span className="id-chip">{c.challanNo}</span>
                      </TableCell>
                      <TableCell className="font-medium">{c.party?.name || c.dispatchTo?.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(c.challanDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.challanType === "NON-RETURNABLE" ? "Non-returnable" : "Returnable"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono-tech">{fmtIndian(c.totalAmount)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2 flex-wrap">
                          <Button size="sm" variant="ghost" onClick={() => setGenerated(c)}>
                            <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => copyFrom(c)}>
                            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                          </Button>
                          {c.challanType !== "NON-RETURNABLE" && (
                            <Button size="sm" variant="outline" onClick={() => toggleStatus(c)}>
                              {c.status === "closed" ? "Reopen" : "Mark returned"}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => download(c)}>
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