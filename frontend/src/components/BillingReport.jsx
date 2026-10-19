import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Download, FileBarChart, RefreshCw, RotateCcw } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

const EMPTY = {
  status: "all",
  dateField: "invoice",
  from: "",
  to: "",
  vendor: "",
  method: "",
  minAmount: "",
  maxAmount: "",
  search: "",
  groupBy: "none",
};

const GROUP_LABEL = { vendor: "Vendor", method: "Payment method", month: "Invoice month" };

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "paid" && "text-emerald-700",
          tone === "unpaid" && "text-amber-700"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function BillingReport() {
  const [f, setF] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  // Only send filters that have a value.
  const params = useCallback(
    () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")),
    [f]
  );

  const run = useCallback(async () => {
    if (f.from && f.to && f.from > f.to) return toast.error("“From” date is after “To” date");
    setLoading(true);
    try {
      const { data: res } = await api.get("/billing/report", { params: params() });
      setData(res);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not generate the report");
    } finally {
      setLoading(false);
    }
  }, [f.from, f.to, params]);

  // Show something useful on first open.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await api.get("/billing/report/export", {
        params: params(),
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not export the report");
    } finally {
      setExporting(false);
    }
  };

  const s = data?.summary;
  const rows = data?.rows || [];
  const groups = data?.groups || [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileBarChart className="h-5 w-5" /> Custom report
          </CardTitle>
          <CardDescription>
            Pick the filters you need, generate the report on screen, then download it as Excel.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setF(EMPTY)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={run} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Generate
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportXlsx}
            disabled={exporting || !rows.length}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> {exporting ? "Preparing…" : "Excel"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ---------------- filters ---------------- */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>Status</Label>
            <select className={selectClass} value={f.status} onChange={set("status")}>
              <option value="all">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Date based on</Label>
            <select className={selectClass} value={f.dateField} onChange={set("dateField")}>
              <option value="invoice">Invoice date</option>
              <option value="payment">Payment date (paid only)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input type="date" value={f.from} onChange={set("from")} />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input type="date" value={f.to} onChange={set("to")} />
          </div>
          <div className="space-y-1">
            <Label>Vendor</Label>
            <select className={selectClass} value={f.vendor} onChange={set("vendor")}>
              <option value="">All vendors</option>
              {(data?.vendors || []).map((v) => (
                <option key={v._id} value={v._id}>
                  {v.companyName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Payment method</Label>
            <select className={selectClass} value={f.method} onChange={set("method")}>
              <option value="">Any</option>
              {(data?.paymentMethods || []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Min amount (₹)</Label>
            <Input type="number" min="0" value={f.minAmount} onChange={set("minAmount")} />
          </div>
          <div className="space-y-1">
            <Label>Max amount (₹)</Label>
            <Input type="number" min="0" value={f.maxAmount} onChange={set("maxAmount")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Search</Label>
            <Input
              value={f.search}
              onChange={set("search")}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="Vendor, invoice no., PO/PI, UTR"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Group summary by</Label>
            <select className={selectClass} value={f.groupBy} onChange={set("groupBy")}>
              <option value="none">No grouping</option>
              <option value="vendor">Vendor</option>
              <option value="method">Payment method</option>
              <option value="month">Invoice month</option>
            </select>
          </div>
        </div>

        {/* ---------------- totals ---------------- */}
        {s && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total" value={inr(s.totalAmount)} sub={`${s.count} invoices`} />
            <Stat label="Paid" value={inr(s.paidAmount)} sub={`${s.paidCount} invoices`} tone="paid" />
            <Stat
              label="Unpaid"
              value={inr(s.unpaidAmount)}
              sub={`${s.unpaidCount} invoices`}
              tone="unpaid"
            />
            <Stat
              label="Taxable / GST"
              value={`${inr(s.taxable)}`}
              sub={`GST ${inr(s.gst)} · Freight ${inr(s.freight)}`}
            />
          </div>
        )}
        {s?.truncated && (
          <p className="text-xs text-amber-700">
            Showing the first 5,000 matching invoices — narrow the filters to see the rest.
          </p>
        )}

        {/* ---------------- grouped summary ---------------- */}
        {groups.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{GROUP_LABEL[data.groupBy]}</TableHead>
                <TableHead className="w-[90px] text-right">Invoices</TableHead>
                <TableHead className="w-[150px] text-right">Total</TableHead>
                <TableHead className="w-[150px] text-right">Paid</TableHead>
                <TableHead className="w-[150px] text-right">Unpaid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="text-xs font-medium">{g.key}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{g.count}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(g.amount)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-emerald-700">
                    {inr(g.paidAmount)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-amber-700">
                    {inr(g.unpaidAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* ---------------- detail ---------------- */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead className="w-[150px]">Invoice</TableHead>
              <TableHead className="w-[110px]">PO / PI</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[130px] text-right">Taxable</TableHead>
              <TableHead className="w-[110px] text-right">GST</TableHead>
              <TableHead className="w-[140px] text-right">Amount</TableHead>
              <TableHead className="w-[190px]">Payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableEmpty colSpan={8}>
                {loading ? "Generating…" : "No invoices match these filters."}
              </TableEmpty>
            )}
            {rows.map((r) => {
              const paid = r.status === "Paid";
              return (
                <TableRow key={r._id}>
                  <TableCell className="text-xs">
                    <p className="font-medium">{r.vendor}</p>
                    {r.gstin && <p className="text-[11px] text-muted-foreground">GSTIN {r.gstin}</p>}
                  </TableCell>
                  <TableCell className="text-xs">
                    <p className="font-medium">{r.invoiceNumber || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtDate(r.invoiceDate)}</p>
                  </TableCell>
                  <TableCell className="text-xs">{r.poNumber || "—"}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                        paid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                      )}
                    >
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(r.taxable)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{inr(r.gst)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
                    {inr(r.amount)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {paid ? (
                      <>
                        <p className="font-medium">{r.method || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.utr ? `UTR ${r.utr}` : "No UTR"} · {fmtDate(r.paymentDate)}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}