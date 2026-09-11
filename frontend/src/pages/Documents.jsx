import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText,
  FileSpreadsheet,
  Receipt,
  Download,
  Lock,
  LockOpen,
  Upload,
  Search,
  Boxes,
} from "lucide-react";

const API_ORIGIN = (api?.defaults?.baseURL || "").replace(/\/api\/?$/, "");
const fileUrl = (u) => (!u ? "#" : /^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

// Parts have evolved: older records carry ttUniquePartNumber /
// manufacturerPartNumber / itemDescription, newer UI used partNumber /
// description. Read every known alias so old entries never render blank.
const partNumberOf = (part) =>
  part?.ttUniquePartNumber ||
  part?.partNumber ||
  part?.manufacturerPartNumber ||
  "—";

const partDescriptionOf = (part) =>
  part?.itemDescription || part?.description || part?.name || "—";

// Whether a file can be shown in an <iframe> preview — practically just
// PDFs (Cloudinary can also hold the odd image/doc, which fall back to a
// plain "open in a new tab" link instead of an inline preview).
const isPdfFile = (invoice) =>
  /\.pdf(\?|$)/i.test(invoice?.documentUrl || "") ||
  /\.pdf$/i.test(invoice?.originalFileName || "");

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

const fmtAmount = (n) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS = [
  { key: "po", label: "Purchase orders", icon: FileText },
  { key: "pi", label: "Proforma invoices", icon: FileSpreadsheet },
  { key: "tax", label: "Tax invoices", icon: Receipt },
];

function StatusPill({ status }) {
  const closed = status === "closed";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        closed ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-700"
      }`}
    >
      {closed ? "Closed" : "Open"}
    </span>
  );
}

function StatusFilter({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-white px-3 text-sm"
    >
      <option value="">All statuses</option>
      <option value="open">Open</option>
      <option value="closed">Closed</option>
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* PO / vendor-PI table (both come from the PurchaseOrder collection)  */
/* ------------------------------------------------------------------ */
function DocumentTable({ documentType, emptyLabel }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/purchase-orders", {
        params: {
          documentType,
          lifecycleStatus: status || undefined,
          search: search.trim() || undefined,
        },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [documentType, status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = async (row) => {
    const next = row.lifecycleStatus === "closed" ? "open" : "closed";
    setBusyId(row._id);
    try {
      await api.patch(`/purchase-orders/${row._id}/lifecycle`, { lifecycleStatus: next });
      toast.success(next === "closed" ? "Marked as closed" : "Re-opened");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not update status");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by document number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <StatusFilter value={status} onChange={setStatus} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Document no.</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row._id} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.documentNumber || "—"}</td>
                  <td className="px-3 py-2">{row.vendor?.companyName || row.vendor?.name || "—"}</td>
                  <td className="px-3 py-2">{fmtDate(row.receivedDate || row.createdAt)}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={row.lifecycleStatus} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={fileUrl(row.documentUrl)} target="_blank" rel="noreferrer">
                          <Download className="mr-1 h-4 w-4" /> File
                        </a>
                      </Button>
                      <Button
                        variant={row.lifecycleStatus === "closed" ? "secondary" : "default"}
                        size="sm"
                        disabled={busyId === row._id}
                        onClick={() => toggle(row)}
                      >
                        {row.lifecycleStatus === "closed" ? (
                          <>
                            <LockOpen className="mr-1 h-4 w-4" /> Re-open
                          </>
                        ) : (
                          <>
                            <Lock className="mr-1 h-4 w-4" /> Close
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generated POs (raised by TISPL in the PO Generator)                 */
/* ------------------------------------------------------------------ */
function GeneratedPoTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/po-generator", {
        params: { status: status || undefined },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.voucherNo || "").toLowerCase().includes(q) ||
        String(r.supplierName || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const toggle = async (row) => {
    const next = row.status === "closed" ? "open" : "closed";
    setBusyId(row._id);
    try {
      await api.patch(`/po-generator/${row._id}/status`, { status: next });
      toast.success(next === "closed" ? "PO closed" : "PO re-opened");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not update status");
    } finally {
      setBusyId(null);
    }
  };

  const download = async (row) => {
    try {
      const res = await api.get(`/po-generator/${row._id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(row.voucherNo || "PO").replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not download the PO");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by PO number or supplier"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <StatusFilter value={status} onChange={setStatus} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">PO no.</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No purchase orders generated yet.
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={row._id} className={i % 2 ? "border-t bg-muted/30" : "border-t"}>
                  <td className="px-3 py-1.5 font-medium">{row.voucherNo}</td>
                  <td className="px-3 py-1.5">{row.supplierName || "—"}</td>
                  <td className="px-3 py-1.5">{fmtDate(row.voucherDate)}</td>
                  <td className="px-3 py-1.5 text-right">₹ {fmtAmount(row.totalAmount)}</td>
                  <td className="px-3 py-1.5">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => download(row)}>
                        <Download className="mr-1 h-4 w-4" /> PDF
                      </Button>
                      <Button
                        variant={row.status === "closed" ? "secondary" : "default"}
                        size="sm"
                        disabled={busyId === row._id}
                        onClick={() => toggle(row)}
                      >
                        {row.status === "closed" ? (
                          <>
                            <LockOpen className="mr-1 h-4 w-4" /> Re-open
                          </>
                        ) : (
                          <>
                            <Lock className="mr-1 h-4 w-4" /> Close
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generated PIs (issued by TISPL)                                     */
/* ------------------------------------------------------------------ */
function GeneratedPiTable() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/pi-generator", {
        params: { status: status || undefined, search: search.trim() || undefined },
      });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = async (row) => {
    const next = row.status === "closed" ? "open" : "closed";
    setBusyId(row._id);
    try {
      await api.patch(`/pi-generator/${row._id}/status`, { status: next });
      toast.success(next === "closed" ? "PI closed" : "PI re-opened");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not update status");
    } finally {
      setBusyId(null);
    }
  };

  const download = async (row) => {
    try {
      const res = await api.get(`/pi-generator/${row._id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(row.invoiceNo || "PI").replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the PI");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by PI number or buyer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <StatusFilter value={status} onChange={setStatus} />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">PI no.</th>
              <th className="px-3 py-2 font-medium">Buyer</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No proforma invoices generated yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row._id} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.invoiceNo}</td>
                  <td className="px-3 py-2">{row.buyerName}</td>
                  <td className="px-3 py-2">{fmtDate(row.invoiceDate)}</td>
                  <td className="px-3 py-2 text-right">₹ {fmtAmount(row.totalAmount)}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => download(row)}>
                        <Download className="mr-1 h-4 w-4" /> PDF
                      </Button>
                      <Button
                        variant={row.status === "closed" ? "secondary" : "default"}
                        size="sm"
                        disabled={busyId === row._id}
                        onClick={() => toggle(row)}
                      >
                        {row.status === "closed" ? (
                          <>
                            <LockOpen className="mr-1 h-4 w-4" /> Re-open
                          </>
                        ) : (
                          <>
                            <Lock className="mr-1 h-4 w-4" /> Close
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tax invoices — uploaded against an OPEN PO / PI picked from a list  */
/* ------------------------------------------------------------------ */
/* Side-by-side comparison for one tax invoice: the invoice file itself
   (as uploaded, previewed inline for PDFs) on the left, and every stock
   entry actually booked against it on the right — so what the paperwork
   says and what was physically entered can be checked against each other
   without switching screens. */
function InvoiceStockDialog({ invoice, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoice?._id) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    api
      .get(`/tax-invoices/${invoice._id}/stock-entries`)
      .then((r) => !cancelled && setData(r.data))
      .catch(() => !cancelled && setData({ entries: [], totalQuantity: 0, linkedDocuments: [] }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [invoice?._id]);

  const entries = data?.entries || [];
  const fileHref = fileUrl(invoice?.documentUrl);
  const canPreview = isPdfFile(invoice);

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {invoice?.invoiceNumber || "Tax invoice"} — invoice vs. material entered
          </DialogTitle>
          <DialogDescription>
            {invoice?.vendor?.companyName || invoice?.vendor?.name || "Vendor"} ·{" "}
            {fmtDate(invoice?.invoiceDate || invoice?.createdAt)}
            {invoice?.purchaseOrder
              ? ` · ${invoice.purchaseOrder.documentType} ${invoice.purchaseOrder.documentNumber || ""}`
              : " · no PO / PI linked"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-2">
          {/* Left: the invoice PDF itself, as uploaded */}
          <div className="flex min-h-[45vh] flex-col overflow-hidden border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Invoice file{invoice?.originalFileName ? ` · ${invoice.originalFileName}` : ""}
              </span>
              <Button variant="outline" size="sm" asChild>
                <a href={fileHref} target="_blank" rel="noreferrer">
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Open
                </a>
              </Button>
            </div>
            <div className="flex-1 overflow-hidden bg-muted/20">
              {canPreview ? (
                <iframe title="Tax invoice PDF" src={fileHref} className="h-full w-full" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                  <FileText className="h-8 w-8" />
                  <p>This file type can't be previewed inline.</p>
                  <Button variant="outline" size="sm" asChild>
                    <a href={fileHref} target="_blank" rel="noreferrer">
                      Open in a new tab
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Right: what was actually entered into stock against it */}
          <div className="flex min-h-[45vh] flex-col overflow-hidden lg:min-h-0">
            <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/50 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Boxes className="h-3.5 w-3.5" />
                Material entered{!loading ? ` (${entries.length})` : ""}
              </span>
              {!loading && (
                <span className="text-xs font-medium">Total: {data?.totalQuantity || 0}</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading stock entries…</p>
              ) : entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No stock was booked against this invoice yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/70 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Part no.</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                      <th className="px-3 py-2 font-medium text-right">Qty</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Batch</th>
                      <th className="px-3 py-2 font-medium">Booked on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e._id} className="border-t odd:bg-muted/20">
                        <td className="px-3 py-1.5 font-medium">
                          {partNumberOf(e.part)}
                          {e.alternateOfPart && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              (alt of {partNumberOf(e.alternateOfPart)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">{partDescriptionOf(e.part)}</td>
                        <td className="px-3 py-1.5 text-right">{e.quantityReceived}</td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">
                          {String(e.matchType || "").replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-1.5 text-xs font-mono-tech text-muted-foreground">
                          {e.batchCode || "—"}
                        </td>
                        <td className="px-3 py-1.5">{fmtDate(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {!loading && (data?.linkedDocuments || []).length > 0 && (
              <div className="flex shrink-0 flex-wrap gap-2 border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {data.linkedDocuments.map((d) => (
                  <span key={d._id} className="rounded-full border px-2 py-0.5">
                    {d.documentType} {d.documentNumber}
                    {d.totalQuantity != null ? ` · declared ${d.totalQuantity}` : ""} ·{" "}
                    {d.lifecycleStatus}
                  </span>
                ))}
              </div>
            )}
            {!loading && data?.matchedBy === "vendor_without_document" && (
              <p className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                Matched by vendor — no PO / PI on record for this invoice.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaxInvoiceTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [openDocs, setOpenDocs] = useState([]);
  const [docType, setDocType] = useState("Proforma Invoice");
  const [selectedDoc, setSelectedDoc] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [stockFor, setStockFor] = useState(null);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/tax-invoices");
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only OPEN POs / PIs can receive a tax invoice — that's the dropdown source.
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const { data } = await api.get("/purchase-orders/open", { params: { documentType: docType } });
        setOpenDocs(Array.isArray(data) ? data : []);
      } catch {
        setOpenDocs([]);
      }
      setSelectedDoc("");
    })();
  }, [open, docType]);

  const chosen = useMemo(() => openDocs.find((d) => d._id === selectedDoc) || null, [openDocs, selectedDoc]);

  const submit = async (e) => {
    e.preventDefault();
    if (!chosen) return toast.error("Pick an open PO / PI first");
    if (!file) return toast.error("Attach the tax invoice file");

    const fd = new FormData();
    fd.append("vendor", chosen.vendor?._id || chosen.vendor);
    fd.append("purchaseOrder", chosen._id);
    if (invoiceNumber) fd.append("invoiceNumber", invoiceNumber);
    if (invoiceDate) fd.append("invoiceDate", invoiceDate);
    fd.append("document", file);

    setSaving(true);
    try {
      const { data } = await api.post("/tax-invoices", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Tax invoice uploaded");
      if (data?.stockApplied?.count > 0) {
        toast.success(
          `${data.stockApplied.totalQuantity} unit(s) across ${data.stockApplied.count} line(s) added to stock`
        );
      }
      setOpen(false);
      setInvoiceNumber("");
      setInvoiceDate("");
      setFile(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Upload tax invoice
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Invoice no.</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Against</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium text-right">File</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No tax invoices uploaded yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row._id}
                  className="cursor-pointer border-t odd:bg-muted/20 hover:bg-accent/40"
                  onClick={() => setStockFor(row)}
                  title="Click to see the material booked against this invoice"
                >
                  <td className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                      <Boxes className="h-3.5 w-3.5" />
                      {row.invoiceNumber || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{row.vendor?.companyName || row.vendor?.name || "—"}</td>
                  <td className="px-3 py-2">
                    {row.purchaseOrder
                      ? `${row.purchaseOrder.documentType} ${row.purchaseOrder.documentNumber || ""}`.trim()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{fmtDate(row.invoiceDate || row.createdAt)}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" asChild>
                      <a href={fileUrl(row.documentUrl)} target="_blank" rel="noreferrer">
                        <Download className="mr-1 h-4 w-4" /> Open
                      </a>
                    </Button>
                  </td>
                </tr>
              ))

            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload tax invoice</DialogTitle>
            <DialogDescription>Pick the open PO / PI this invoice settles.</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Against</label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="Proforma Invoice">Open proforma invoices</option>
                <option value="Purchase Order">Open purchase orders</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">
                {docType === "Purchase Order" ? "Open PO" : "Open PI"}
              </label>
              <select
                value={selectedDoc}
                onChange={(e) => setSelectedDoc(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="">Select…</option>
                {openDocs.map((d) => (
                  <option key={d._id} value={d._id}>
                    {(d.documentNumber || "(no number)") +
                      " — " +
                      (d.vendor?.companyName || d.vendor?.name || "vendor") +
                      " — " +
                      fmtDate(d.receivedDate || d.createdAt)}
                  </option>
                ))}
              </select>
              {openDocs.length === 0 && (
                <p className="text-xs text-muted-foreground">Nothing open in this category right now.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Invoice number</label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Invoice date</label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Invoice file</label>
              <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <InvoiceStockDialog invoice={stockFor} onClose={() => setStockFor(null)} />
    </div>

  );
}

export default function Documents() {
  const [tab, setTab] = useState("po");
  const [poSource, setPoSource] = useState("received"); // received (from vendors) | generated (PO Generator)
  const [piSource, setPiSource] = useState("received"); // received (from vendors) | generated (issued by TISPL)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">PO / Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Purchase orders, proforma invoices and tax invoices — each tracked separately with an open / closed
          status.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Button key={key} variant={tab === key ? "default" : "outline"} onClick={() => setTab(key)}>
            <Icon className="mr-2 h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{TABS.find((t) => t.key === tab)?.label}</CardTitle>
          <CardDescription>
            {tab === "po" && "Purchase orders — received against deliveries, or raised by TISPL in the PO Generator."}
            {tab === "pi" && "Proforma invoices — received from vendors, or generated by TISPL for buyers."}
            {tab === "tax" && "Tax invoices, each raised against an open PO / PI."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tab === "po" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={poSource === "received" ? "default" : "outline"}
                  onClick={() => setPoSource("received")}
                >
                  Received from vendors
                </Button>
                <Button
                  size="sm"
                  variant={poSource === "generated" ? "default" : "outline"}
                  onClick={() => setPoSource("generated")}
                >
                  Generated by us
                </Button>
              </div>

              {poSource === "received" ? (
                <DocumentTable documentType="Purchase Order" emptyLabel="No purchase orders yet." />
              ) : (
                <GeneratedPoTable />
              )}
            </div>
          )}

          {tab === "pi" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={piSource === "received" ? "default" : "outline"}
                  onClick={() => setPiSource("received")}
                >
                  Received from vendors
                </Button>
                <Button
                  size="sm"
                  variant={piSource === "generated" ? "default" : "outline"}
                  onClick={() => setPiSource("generated")}
                >
                  Generated for buyers
                </Button>
              </div>

              {piSource === "received" ? (
                <DocumentTable documentType="Proforma Invoice" emptyLabel="No proforma invoices yet." />
              ) : (
                <GeneratedPiTable />
              )}
            </div>
          )}

          {tab === "tax" && <TaxInvoiceTab />}
        </CardContent>
      </Card>
    </div>
  );
}