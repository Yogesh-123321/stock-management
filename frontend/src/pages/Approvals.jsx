import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ShieldCheck, ShieldX, Clock, RefreshCw } from "lucide-react";
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

export default function Approvals() {
  const { user, can } = useAuth();
  const [status, setStatus] = useState("pending");
  const [entityType, setEntityType] = useState("all");
  const [items, setItems] = useState([]);
  const [remarks, setRemarks] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

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
    setBusyId(row._id);
    try {
      await api.patch(`/approvals/${row._id}/${action}`, {
        reviewRemarks: remarks[row._id] || "",
      });
      toast.success(action === "approve" ? "Approved" : "Rejected");
      setRemarks((r) => ({ ...r, [row._id]: "" }));
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
                <TableHead className="w-[130px]">Type</TableHead>
                <TableHead>Document</TableHead>
                <TableHead className="w-[150px]">Raised by</TableHead>
                <TableHead className="w-[110px] text-right">Amount</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="w-[300px]">Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableEmpty colSpan={6}>
                  {loading ? "Loading…" : "Nothing waiting here."}
                </TableEmpty>
              )}
              {items.map((row) => (
                <TableRow key={row._id}>
                  <TableCell>
                    <Badge variant="outline">{APPROVAL_LABEL[row.entityType]}</Badge>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{row.title}</p>
                    {row.summary && (
                      <p className="text-[11px] text-muted-foreground">{row.summary}</p>
                    )}
                    {row.requestRemarks && (
                      <p className="text-[11px] italic text-muted-foreground">
                        “{row.requestRemarks}”
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.requestedBy?.name || "—"}
                    <span className="block text-[10px] text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("en-IN")}
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
                  <TableCell>
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
                          : `${row.reviewedBy?.name || "Admin"}${
                              row.reviewRemarks ? ` — ${row.reviewRemarks}` : ""
                            }`}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
