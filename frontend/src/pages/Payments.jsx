import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RefreshCw, Banknote, Eye, Search, Wallet } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import InvoicePreviewDialog from "@/components/InvoicePreviewDialog";

// Keep in step with PAYMENT_METHODS in backend/src/models/TaxInvoice.js.
const PAYMENT_METHODS = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque", "Card", "Other", "Cash purchase"];
const CASH_METHOD = "Cash purchase";

const TABS = [
  { key: "unpaid", label: "Unpaid" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const todayInput = () => new Date().toISOString().slice(0, 10);
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const isPaid = (row) => row?.payment?.status === "paid";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* ------------------------------------------------------------------ */
/* Mark an invoice as paid                                             */
/* ------------------------------------------------------------------ */

function PayDialog({ invoice, onClose, onPaid }) {
  const [method, setMethod] = useState("NEFT");
  const [utr, setUtr] = useState("");
  const [date, setDate] = useState(todayInput());
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setMethod("NEFT");
    setUtr("");
    setDate(todayInput());
    setRemarks("");
  }, [invoice]);

  const isCash = method === CASH_METHOD;

  const submit = async (e) => {
    e.preventDefault();
    if (!isCash && !utr.trim()) return toast.error("Enter the UTR number");
    if (!date) return toast.error("Choose the payment date");

    setSaving(true);
    try {
      await api.patch(`/billing/${invoice._id}/pay`, {
        paymentMethod: method,
        // A cash purchase never carries a UTR — the server stores null.
        utrNumber: isCash ? null : utr.trim(),
        paymentDate: date,
        remarks,
      });
      toast.success("Invoice marked as paid");
      onPaid?.();
      onClose();
    } catch (err) {
      toast.error(errMsg(err, "Could not mark the invoice as paid"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark invoice as paid</DialogTitle>
          <DialogDescription>
            {invoice?.vendor?.companyName || "Vendor"} · invoice {invoice?.invoiceNumber || "—"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="pay-method">Payment method *</Label>
            <select
              id="pay-method"
              className={selectClass}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pay-utr">UTR number {isCash ? "" : "*"}</Label>
            <Input
              id="pay-utr"
              value={isCash ? "" : utr}
              onChange={(e) => setUtr(e.target.value)}
              disabled={isCash}
              placeholder={isCash ? "Not needed for a cash purchase" : "Bank UTR / reference number"}
              autoComplete="off"
            />
            {isCash && (
              <p className="text-[11px] text-muted-foreground">
                Cash purchase — no UTR is recorded for this invoice.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="pay-date">Payment date *</Label>
            <Input
              id="pay-date"
              type="date"
              max={todayInput()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pay-remarks">Remarks</Label>
            <Textarea
              id="pay-remarks"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Banknote className="mr-1.5 h-4 w-4" />
              {saving ? "Saving…" : "Mark as paid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Payments() {
  const { can } = useAuth();
  const allowed = can("payment.pay");

  const [tab, setTab] = useState("unpaid");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({ unpaid: 0, paid: 0, all: 0 });
  const [loading, setLoading] = useState(false);
  const [payInvoice, setPayInvoice] = useState(null);
  const [previewInvoice, setPreviewInvoice] = useState(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const { data } = await api.get("/billing", { params: { status: tab, search: search.trim() } });
      setItems(data.items || []);
      setCounts(data.counts || { unpaid: 0, paid: 0, all: 0 });
    } catch (err) {
      toast.error(errMsg(err, "Could not load invoices"));
    } finally {
      setLoading(false);
    }
  }, [allowed, tab, search]);

  // Small debounce so typing in the search box doesn't fire a request per key.
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);

  if (!allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>
            You do not have access to billing. Ask an admin to enable it for your account.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Billing
            </CardTitle>
            <CardDescription>
              Tax invoices uploaded at stock entry appear here as unpaid. Mark each one paid with its
              UTR number (not needed for a cash purchase).
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
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
                placeholder="Search vendor, invoice no., PO/PI, UTR"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="w-[170px]">Invoice</TableHead>
                <TableHead className="w-[150px]">PO / PI</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[230px]">Payment details</TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableEmpty colSpan={6}>
                  {loading
                    ? "Loading…"
                    : tab === "unpaid"
                    ? "No unpaid invoices."
                    : "No invoices here."}
                </TableEmpty>
              )}
              {items.map((row) => {
                const paid = isPaid(row);
                const cash = row.payment?.method === CASH_METHOD;
                return (
                  <TableRow key={row._id}>
                    <TableCell>
                      <p className="font-medium">{row.vendor?.companyName || "—"}</p>
                      {row.vendor?.taxRegistrationNo && (
                        <p className="text-[11px] text-muted-foreground">
                          GSTIN {row.vendor.taxRegistrationNo}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <p className="font-medium">{row.invoiceNumber || "—"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDate(row.invoiceDate || row.createdAt)}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.purchaseOrder ? (
                        <>
                          {row.purchaseOrder.documentNumber}
                          <span className="block text-[10px] text-muted-foreground">
                            {row.purchaseOrder.documentType}
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                          paid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        )}
                      >
                        {paid ? "Paid" : "Unpaid"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {paid ? (
                        <>
                          <p className="font-medium">{row.payment.method}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {cash ? "No UTR (cash purchase)" : `UTR ${row.payment.utrNumber}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {fmtDate(row.payment.paymentDate)}
                            {row.payment.paidBy?.name || row.payment.paidByName
                              ? ` · ${row.payment.paidBy?.name || row.payment.paidByName}`
                              : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {!paid && (
                          <Button size="sm" className="h-8" onClick={() => setPayInvoice(row)}>
                            <Banknote className="mr-1.5 h-3.5 w-3.5" /> Mark paid
                          </Button>
                        )}
                        {row.documentUrl && (
                          <button
                            type="button"
                            onClick={() => setPreviewInvoice(row)}
                            title="Preview the invoice"
                            aria-label="Preview the invoice"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InvoicePreviewDialog
        invoice={previewInvoice}
        onClose={() => setPreviewInvoice(null)}
        onMarkPaid={(inv) => {
          // Close the preview first so the two dialogs never stack.
          setPreviewInvoice(null);
          setPayInvoice(inv);
        }}
      />

      <PayDialog invoice={payInvoice} onClose={() => setPayInvoice(null)} onPaid={load} />
    </div>
  );
}