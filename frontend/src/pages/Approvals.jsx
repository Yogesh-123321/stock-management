import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, ShieldX, Clock, RefreshCw, Eye, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { APPROVAL_LABEL } from "@/lib/permissions";
import { useAuth } from "@/lib/auth";
import ApprovalPreviewDialog from "@/components/ApprovalPreviewDialog";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const TYPES = [
  { key: "all", label: "All types" },
  { key: "po", label: "Purchase orders" },
  { key: "pi", label: "Proforma invoices" },
  { key: "vendor", label: "Vendors" },
  { key: "buyer", label: "Buyers" },
];

const STATUS_TONE = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

const fmtAmount = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

// How each sortable column turns a row into a comparable value.
const SORT_VALUE = {
  type: (r) => APPROVAL_LABEL[r.entityType] || r.entityType || "",
  document: (r) => String(r.title || "").toLowerCase(),
  raisedBy: (r) => String(r.requestedBy?.name || "").toLowerCase(),
  date: (r) => new Date(r.createdAt).getTime() || 0,
  amount: (r) => (r.amount == null ? null : Number(r.amount)),
  status: (r) => r.status || "",
};

export default function Approvals() {
  const { user, can } = useAuth();
  const [status, setStatus] = useState("pending");
  const [entityType, setEntityType] = useState("all");
  const [items, setItems] = useState([]);
  const [remarks, setRemarks] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [previewRow, setPreviewRow] = useState(null);
  // Newest first by default; click a column heading to sort by it.
  const [sort, setSort] = useState({ key: "date", dir: "desc" });

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "date" || key === "amount" ? "desc" : "asc" }
    );

  const sortedItems = useMemo(() => {
    const get = SORT_VALUE[sort.key] || SORT_VALUE.date;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      // Rows with no value (e.g. no amount) always sink to the bottom.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (x < y) return -1 * factor;
      if (x > y) return 1 * factor;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [items, sort]);

  const SortHead = ({ k, children, className }) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-medium hover:text-foreground",
          className?.includes("text-right") && "flex-row-reverse"
        )}
      >
        {children}
        {sort.key === k ? (
          sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/approvals", { params: { status, entityType } });
      setItems(data.items || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load approvals");
    } finally {
      setLoading(false);
    }
  }, [status, entityType]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, action) => {
    // Approving / rejecting is a final decision, so ask first. Both the row
    // buttons and the preview dialog's buttons come through here.
    const label = (APPROVAL_LABEL[row.entityType] || "request").toLowerCase();
    const verb = action === "approve" ? "approve" : "reject";
    const ok = window.confirm(
      `Are you sure you want to ${verb} this ${label}${row.title ? ` — ${row.title}` : ""}?`
    );
    if (!ok) return;

    setBusyId(row._id);
    try {
      await api.patch(`/approvals/${row._id}/${action}`, {
        reviewRemarks: remarks[row._id] || "",
      });
      toast.success(action === "approve" ? "Approved" : "Rejected");
      setRemarks((r) => ({ ...r, [row._id]: "" }));
      setPreviewRow((p) => (p?._id === row._id ? null : p));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not record the decision");
    } finally {
      setBusyId(null);
    }
  };

  const mayDecide = (row) => can(`${row.entityType}.approve`);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Approvals</CardTitle>
            <CardDescription>
              {user?.role === "admin"
                ? "Everything users have sent in for your sign-off."
                : "Requests you raised, and anything you are allowed to approve."}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-md bg-secondary p-0.5">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatus(t.key)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    status === t.key
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setEntityType(t.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    entityType === t.key
                      ? "border-sidebar-active bg-secondary text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="type" className="w-[130px]">Type</SortHead>
                <SortHead k="document">Document</SortHead>
                <SortHead k="raisedBy" className="w-[130px]">Raised by</SortHead>
                <SortHead k="date" className="w-[130px]">Date</SortHead>
                <SortHead k="amount" className="w-[120px] text-right">Amount (₹)</SortHead>
                <SortHead k="status" className="w-[110px]">Status</SortHead>
                <TableHead className="w-[300px]">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableEmpty colSpan={7}>
                  {loading ? "Loading…" : "Nothing waiting here."}
                </TableEmpty>
              )}
              {sortedItems.map((row) => (
                <TableRow
                  key={row._id}
                  className="cursor-pointer"
                  onClick={() => setPreviewRow(row)}
                >
                  <TableCell>
                    <Badge variant="outline">{APPROVAL_LABEL[row.entityType]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium">{row.title}</p>
                      <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Click to preview" />
                    </div>
                    {/* PO / PI: just the company on the other side (amount has its own
                        column). Vendor / buyer registrations keep their short summary. */}
                    {row.details?.party ? (
                      <p className="text-[11px] text-muted-foreground">
                        {row.entityType === "pi" ? "To" : "From"}: {row.details.party}
                      </p>
                    ) : (
                      row.summary && (
                        <p className="text-[11px] text-muted-foreground">{row.summary}</p>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.requestedBy?.name || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(row.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    <span className="block text-[10px] text-muted-foreground">
                      {new Date(row.createdAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(row.amount)}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_TONE[row.status]
                      )}
                    >
                      {row.status === "pending" && <Clock className="h-3 w-3" />}
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {row.status === "pending" && mayDecide(row) ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={remarks[row._id] || ""}
                          onChange={(e) =>
                            setRemarks((r) => ({ ...r, [row._id]: e.target.value }))
                          }
                          placeholder="Remarks (optional)"
                          className="h-8 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={busyId === row._id}
                          onClick={() => decide(row, "approve")}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 shrink-0"
                          disabled={busyId === row._id}
                          onClick={() => decide(row, "reject")}
                        >
                          <ShieldX className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {row.status === "pending"
                          ? "Waiting for an admin"
                          : `${row.status === "approved" ? "Approved" : "Rejected"} by ${
                              row.reviewedBy?.name || "Admin"
                            }`}
                      </span>
                    )}
                    {/* Only the remarks typed at the time of approving / rejecting. */}
                    {row.status !== "pending" && row.reviewRemarks && (
                      <p className="mt-1 text-[11px] italic text-muted-foreground">
                        Remarks: {row.reviewRemarks}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ApprovalPreviewDialog
        row={previewRow}
        open={!!previewRow}
        onOpenChange={(o) => !o && setPreviewRow(null)}
        canDecide={previewRow ? mayDecide(previewRow) : false}
        busy={previewRow ? busyId === previewRow._id : false}
        remark={previewRow ? remarks[previewRow._id] || "" : ""}
        onRemarkChange={(v) => previewRow && setRemarks((r) => ({ ...r, [previewRow._id]: v }))}
        onDecide={decide}
      />
    </div>
  );
}