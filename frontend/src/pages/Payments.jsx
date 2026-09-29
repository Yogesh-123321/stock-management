import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Upload,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  Banknote,
  FileText,
  History,
  Clock,
  Search,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SearchableSelect from "@/components/ui/SearchableSelect";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const PAYMENT_MODES = ["UPI", "NEFT", "RTGS", "IMPS", "Cheque", "Cash", "Card", "Other"];
const CATEGORY_HINTS = ["Utilities", "Rent", "Vendor payment", "Travel", "Courier", "Repairs", "Other"];
const MAX_FILE_MB = 15;

const STATUS_META = {
  pending_approval: { label: "Awaiting approval", tone: "bg-amber-100 text-amber-800" },
  approved: { label: "Approved — to pay", tone: "bg-sky-100 text-sky-800" },
  paid: { label: "Paid · closed", tone: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", tone: "bg-rose-100 text-rose-800" },
};

const TABS = [
  { key: "pending_approval", label: "To approve" },
  { key: "approved", label: "To pay" },
  { key: "paid", label: "Paid" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const fmtAmount = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString("en-IN") : "—");
const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const todayInput = () => new Date().toISOString().slice(0, 10);

const errMsg = (err, fallback) => err?.response?.data?.message || fallback;

/* ------------------------------------------------------------------ */
/* Upload a bill  /  fix & resubmit a rejected one                     */
/* ------------------------------------------------------------------ */

const EMPTY_FORM = {
  vendor: "",
  billNo: "",
  billDate: "",
  amount: "",
  category: "",
  description: "",
};

function BillFormDialog({ open, onClose, bill, onSaved }) {
  const resubmitting = Boolean(bill);
  const [form, setForm] = useState(EMPTY_FORM);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  // Only vendors that are registered, approved and active can be paid.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVendorsLoading(true);
    api
      .get("/vendors", { params: { status: "approved", activeStatus: "active" } })
      .then(({ data }) => {
        if (alive) setVendors(Array.isArray(data) ? data : []);
      })
      .catch((err) => toast.error(errMsg(err, "Could not load vendors")))
      .finally(() => alive && setVendorsLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  const vendorOptions = useMemo(
    () =>
      vendors
        .map((v) => ({ value: v._id, label: v.companyName, sublabel: v.taxRegistrationNo || "" }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [vendors]
  );

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setForm(
      bill
        ? {
            vendor: bill.vendor?._id || bill.vendor || "",
            billNo: bill.billNo || "",
            billDate: toInputDate(bill.billDate),
            amount: String(bill.amount ?? ""),
            category: bill.category || "",
            description: bill.description || "",
          }
        : EMPTY_FORM
    );
  }, [open, bill]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`File is larger than ${MAX_FILE_MB} MB`);
      e.target.value = "";
      return;
    }
    setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.vendor) return toast.error("Choose the vendor from the list");
    if (!form.billNo.trim()) return toast.error("Enter the bill number");
    if (!form.billDate) return toast.error("Choose the bill date");
    if (!(Number(form.amount) > 0)) return toast.error("Enter an amount greater than 0");
    if (!resubmitting && !file) return toast.error("Attach the bill (PDF or image)");

    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (file) fd.append("document", file);

      const cfg = { headers: { "Content-Type": "multipart/form-data" } };
      if (resubmitting) await api.patch(`/payment-bills/${bill._id}/resubmit`, fd, cfg);
      else await api.post("/payment-bills", fd, cfg);

      toast.success(
        resubmitting ? "Resubmitted — sent back to the admin" : "Bill uploaded — sent to the admin for approval"
      );
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "Could not save the bill"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resubmitting ? `Fix & resubmit ${bill.refNo}` : "Upload a bill"}</DialogTitle>
          <DialogDescription>
            {resubmitting
              ? "Correct what the admin flagged and send it back for approval. Attaching a new file is optional."
              : "The bill goes to the admin for approval, then to the cashier for payment."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          {resubmitting && bill.reviewRemarks && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              <span className="font-semibold">Rejected: </span>
              {bill.reviewRemarks}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Payee / vendor *</Label>
              <SearchableSelect
                options={vendorOptions}
                value={form.vendor}
                onChange={(v) => setForm((f) => ({ ...f, vendor: v }))}
                placeholder={vendorsLoading ? "Loading vendors…" : "Select a registered vendor"}
                searchPlaceholder="Search vendors…"
                emptyText="No approved vendor matches. Register it on the Vendors page first."
                disabled={vendorsLoading}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-billno">Bill number *</Label>
              <Input id="pb-billno" value={form.billNo} onChange={set("billNo")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-amount">Amount (₹) *</Label>
              <Input
                id="pb-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={set("amount")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-date">Bill date *</Label>
              <Input id="pb-date" type="date" value={form.billDate} onChange={set("billDate")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pb-cat">Category</Label>
              <Input
                id="pb-cat"
                list="pb-cat-list"
                value={form.category}
                onChange={set("category")}
                placeholder="e.g. Utilities, Rent, Vendor payment"
              />
              <datalist id="pb-cat-list">
                {CATEGORY_HINTS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pb-desc">Note for the admin</Label>
              <Textarea
                id="pb-desc"
                rows={2}
                value={form.description}
                onChange={set("description")}
                placeholder="What is this bill for?"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pb-file">
                Bill file {resubmitting ? "(optional — replaces the old one)" : "*"}
              </Label>
              <Input
                id="pb-file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                onChange={pickFile}
              />
              {file && <p className="text-[11px] text-muted-foreground">{file.name}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Upload className="mr-1.5 h-4 w-4" />
              {saving ? "Sending…" : resubmitting ? "Resubmit" : "Send for approval"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Cashier: record the payment                                         */
/* ------------------------------------------------------------------ */

function PayDialog({ bill, onClose, onPaid }) {
  const [form, setForm] = useState({
    transactionId: "",
    paymentMode: "",
    paymentDate: todayInput(),
    paymentRemarks: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bill)
      setForm({ transactionId: "", paymentMode: "", paymentDate: todayInput(), paymentRemarks: "" });
  }, [bill]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.transactionId.trim()) return toast.error("Enter the transaction ID");
    if (!form.paymentMode) return toast.error("Choose how the payment was made");
    if (!form.paymentDate) return toast.error("Choose the payment date");

    setSaving(true);
    try {
      await api.patch(`/payment-bills/${bill._id}/pay`, form);
      toast.success("Payment recorded — entry closed");
      onPaid?.();
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "Could not record the payment"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(bill)} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Make the payment first, then enter its transaction ID here. This closes the entry.
          </DialogDescription>
        </DialogHeader>

        {bill && (
          <form onSubmit={submit} className="space-y-3">
            <div className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm">
              <p className="font-medium">{bill.payeeName}</p>
              <p className="text-xs text-muted-foreground">
                {bill.refNo} · Bill {bill.billNo}
              </p>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                ₹ {fmtAmount(bill.amount)}
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-txn">Transaction ID *</Label>
              <Input
                id="pay-txn"
                autoFocus
                value={form.transactionId}
                onChange={set("transactionId")}
                placeholder="UTR / reference / cheque no."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pay-mode">Paid via *</Label>
                <select
                  id="pay-mode"
                  value={form.paymentMode}
                  onChange={set("paymentMode")}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Choose…</option>
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pay-date">Payment date *</Label>
                <Input
                  id="pay-date"
                  type="date"
                  max={todayInput()}
                  value={form.paymentDate}
                  onChange={set("paymentDate")}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="pay-remarks">Remarks</Label>
              <Input
                id="pay-remarks"
                value={form.paymentRemarks}
                onChange={set("paymentRemarks")}
                placeholder="Optional"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                {saving ? "Saving…" : "Mark paid & close"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

const ACTION_LABEL = {
  submitted: "Uploaded",
  resubmitted: "Resubmitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

function HistoryDialog({ bill, onClose }) {
  return (
    <Dialog open={Boolean(bill)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{bill?.refNo} — history</DialogTitle>
          <DialogDescription>
            {bill?.payeeName} · Bill {bill?.billNo}
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 border-l border-border pl-4">
          {(bill?.history || []).map((h, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-sidebar-active" />
              <p className="text-sm font-medium">
                {ACTION_LABEL[h.action] || h.action}
                <span className="font-normal text-muted-foreground"> by {h.byName || "—"}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">{fmtDateTime(h.at)}</p>
              {h.remarks && <p className="mt-0.5 text-xs">{h.remarks}</p>}
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Payments() {
  const { user, can, isAdmin } = useAuth();

  const [tab, setTab] = useState(() => (isAdmin ? "pending_approval" : can("payment.pay") ? "approved" : "all"));
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [amounts, setAmounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [remarks, setRemarks] = useState({});
  const [busyId, setBusyId] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editBill, setEditBill] = useState(null);
  const [payBill, setPayBill] = useState(null);
  const [historyBill, setHistoryBill] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/payment-bills", {
        params: { status: tab, search: debounced },
      });
      setItems(data.items || []);
      setCounts(data.counts || {});
      setAmounts(data.amounts || {});
    } catch (err) {
      toast.error(errMsg(err, "Could not load bills"));
    } finally {
      setLoading(false);
    }
  }, [tab, debounced]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, action) => {
    const text = (remarks[row._id] || "").trim();
    if (action === "reject" && !text) return toast.error("Write a reason before rejecting");
    setBusyId(row._id);
    try {
      await api.patch(`/payment-bills/${row._id}/${action}`, { remarks: text });
      toast.success(action === "approve" ? "Approved — sent to the cashier" : "Rejected");
      setRemarks((r) => ({ ...r, [row._id]: "" }));
      load();
    } catch (err) {
      toast.error(errMsg(err, "Could not record the decision"));
    } finally {
      setBusyId(null);
    }
  };

  const openUpload = () => {
    setEditBill(null);
    setFormOpen(true);
  };
  const openResubmit = (row) => {
    setEditBill(row);
    setFormOpen(true);
  };

  const toPayTotal = useMemo(() => amounts.approved || 0, [amounts]);
  const toApproveTotal = useMemo(() => amounts.pending_approval || 0, [amounts]);

  const renderStatus = (row) => {
    const meta = STATUS_META[row.status] || { label: row.status, tone: "bg-secondary" };
    return (
      <div className="space-y-0.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium",
            meta.tone
          )}
        >
          {row.status === "pending_approval" && <Clock className="h-3 w-3" />}
          {meta.label}
        </span>
        {row.status === "paid" && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{row.transactionId}</span> · {row.paymentMode}
            <br />
            {fmtDate(row.paymentDate)} · {row.paidBy?.name || "—"}
          </p>
        )}
        {(row.status === "approved" || row.status === "rejected") && (
          <p className="text-[11px] text-muted-foreground">
            {row.reviewedBy?.name || "Admin"}
            {row.reviewRemarks ? ` — ${row.reviewRemarks}` : ""}
          </p>
        )}
      </div>
    );
  };

  const renderAction = (row) => {
    if (row.canApprove)
      return (
        <div className="flex items-center gap-1.5">
          <Input
            value={remarks[row._id] || ""}
            onChange={(e) => setRemarks((r) => ({ ...r, [row._id]: e.target.value }))}
            placeholder="Remarks (required to reject)"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="h-8 shrink-0"
            title="Approve"
            disabled={busyId === row._id}
            onClick={() => decide(row, "approve")}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 shrink-0"
            title="Reject"
            disabled={busyId === row._id}
            onClick={() => decide(row, "reject")}
          >
            <ShieldX className="h-3.5 w-3.5" />
          </Button>
        </div>
      );

    if (row.canPay)
      return (
        <Button size="sm" className="h-8" onClick={() => setPayBill(row)}>
          <Banknote className="mr-1.5 h-3.5 w-3.5" /> Record payment
        </Button>
      );

    if (row.canResubmit)
      return (
        <Button size="sm" variant="outline" className="h-8" onClick={() => openResubmit(row)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Fix & resubmit
        </Button>
      );

    if (row.status === "pending_approval")
      return <span className="text-[11px] text-muted-foreground">Waiting for an admin</span>;
    if (row.status === "approved")
      return <span className="text-[11px] text-muted-foreground">Waiting for the cashier</span>;
    return <span className="text-[11px] text-muted-foreground">—</span>;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              Upload a bill → admin approves → cashier pays and enters the transaction ID → entry closes.
            </CardDescription>
            {(isAdmin || can("payment.pay")) && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {isAdmin && (
                  <>
                    Awaiting approval:{" "}
                    <span className="font-medium text-foreground">₹ {fmtAmount(toApproveTotal)}</span>
                    {"  ·  "}
                  </>
                )}
                Approved, to be paid:{" "}
                <span className="font-medium text-foreground">₹ {fmtAmount(toPayTotal)}</span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
            {can("payment.submit") && (
              <Button size="sm" onClick={openUpload}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload bill
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 rounded-md bg-secondary p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    tab === t.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                  <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">
                    {counts[t.key] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ref, payee, bill no., transaction ID"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Ref</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead className="w-[150px]">Uploaded by</TableHead>
                <TableHead className="w-[110px] text-right">Amount (₹)</TableHead>
                <TableHead className="w-[210px]">Status</TableHead>
                <TableHead className="w-[320px]">Action</TableHead>
                <TableHead className="w-[70px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableEmpty colSpan={7}>{loading ? "Loading…" : "No bills here."}</TableEmpty>
              )}
              {items.map((row) => (
                <TableRow key={row._id}>
                  <TableCell className="text-xs font-medium tabular-nums">{row.refNo}</TableCell>
                  <TableCell>
                    <p className="font-medium">{row.payeeName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Bill {row.billNo} · {fmtDate(row.billDate)}
                      {row.category ? ` · ${row.category}` : ""}
                    </p>
                    {row.description && (
                      <p className="text-[11px] italic text-muted-foreground">“{row.description}”</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.submittedBy?.name || "—"}
                    {row.submittedBy?._id === user?._id && (
                      <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>
                    )}
                    <span className="block text-[10px] text-muted-foreground">
                      {fmtDateTime(row.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(row.amount)}</TableCell>
                  <TableCell>{renderStatus(row)}</TableCell>
                  <TableCell>{renderAction(row)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={row.documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the bill"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <FileText className="h-4 w-4" />
                      </a>
                      <button
                        type="button"
                        title="History"
                        onClick={() => setHistoryBill(row)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <History className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BillFormDialog
        open={formOpen}
        bill={editBill}
        onClose={() => setFormOpen(false)}
        onSaved={load}
      />
      <PayDialog bill={payBill} onClose={() => setPayBill(null)} onPaid={load} />
      <HistoryDialog bill={historyBill} onClose={() => setHistoryBill(null)} />
    </div>
  );
}