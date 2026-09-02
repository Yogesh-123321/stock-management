import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "@/components/ui/table";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ShieldCheck,
  ShieldX,
  Clock,
  GitBranchPlus,
  PackagePlus,
  Pencil,
  X,
  Save,
} from "lucide-react";

/**
 * Column descriptor for the Parts master table.
 */
const COLUMNS = [
  {
    key: "ttUniquePartNumber",
    label: "TT part number",
    width: "w-[150px]",
    align: "left",
    sortValue: (p) => (p.ttUniquePartNumber || "").toLowerCase(),
  },
  {
    key: "itemDescription",
    label: "Description",
    width: "w-auto",
    align: "left",
    sortValue: (p) => (p.itemDescription || "").toLowerCase(),
  },
  {
    key: "manufacturerPartNumber",
    label: "Mfr part no.",
    width: "w-[160px]",
    align: "left",
    sortValue: (p) => (p.manufacturerPartNumber || "").toLowerCase(),
  },
  {
    key: "category",
    label: "Category",
    width: "w-[120px]",
    align: "left",
    sortValue: (p) => (p.category || "").toLowerCase(),
  },
  {
    key: "vendors",
    label: "Vendor(s)",
    width: "w-[190px]",
    align: "left",
    sortValue: (p) =>
      (p.vendors && p.vendors.length ? p.vendors[0].companyName : "").toLowerCase(),
  },
  {
    key: "quantityInStock",
    label: "Stock qty",
    width: "w-[90px]",
    align: "right",
    sortValue: (p) => Number(p.quantityInStock ?? 0),
  },
  {
    key: "isAlternatePart",
    label: "Alternate?",
    width: "w-[110px]",
    align: "left",
    sortValue: (p) => (p.isAlternatePart ? 1 : 0),
  },
];

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";


/* ------------------------------------------------------------------ *
 * Edit an approval request — ADMIN ONLY.
 * Available on the Pending, Approved AND Rejected tabs so a wrong
 * description / category / mfr number can be corrected after the call.
 * ------------------------------------------------------------------ */
const REQUEST_FIELDS = [
  { key: "itemDescription", label: "Description", full: true },
  { key: "manufacturerPartNumber", label: "Manufacturer part no." },
  { key: "typeOfPart", label: "Type of part" },
  { key: "companyCode", label: "Company code" },
  { key: "category", label: "Category" },
  { key: "partTypeBatchNo", label: "Part type / batch no." },
];

const REQUEST_STATUSES = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function EditRequestDialog({ request, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const base = {};
    REQUEST_FIELDS.forEach((f) => {
      base[f.key] = request?.newPart?.[f.key] ?? "";
    });
    return {
      ...base,
      proposedQuantity: request?.proposedQuantity ?? "",
      requestRemarks: request?.requestRemarks ?? "",
      reviewRemarks: request?.reviewRemarks ?? "",
      status: request?.status ?? "pending",
    };
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!String(form.itemDescription || "").trim()) {
      toast.error("Description is required");
      return;
    }
    setSaving(true);
    try {
      const newPart = {};
      REQUEST_FIELDS.forEach((f) => {
        newPart[f.key] = form[f.key];
      });
      const { data } = await api.patch(`/part-approvals/${request._id}`, {
        newPart,
        proposedQuantity: form.proposedQuantity,
        requestRemarks: form.requestRemarks,
        reviewRemarks: form.reviewRemarks,
        status: form.status,
      });
      toast.success("Request updated — the requester has been notified");
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the request");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        {/* sticky header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Edit part request</h2>
            <p className="break-all text-xs text-muted-foreground">
              {request.requestType === "alternate_part"
                ? `Alternate of ${request.alternateOfPart?.ttUniquePartNumber || "—"}`
                : "New part number"}{" "}
              · raised {fmtDate(request.createdAt)}
              {request.requestedBy ? ` by ${request.requestedBy}` : ""}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {REQUEST_FIELDS.map((f) => (
              <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </label>
                <Input value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
              </div>
            ))}

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Proposed qty
              </label>
              <Input
                type="number"
                className="font-mono-tech"
                value={form.proposedQuantity ?? ""}
                onChange={(e) => set("proposedQuantity", e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </label>
              <div className="flex gap-1">
                {REQUEST_STATUSES.map((s) => (
                  <Button
                    key={s.key}
                    type="button"
                    size="sm"
                    variant={form.status === s.key ? "default" : "outline"}
                    onClick={() => set("status", s.key)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Requester remarks
              </label>
              <Input
                value={form.requestRemarks}
                onChange={(e) => set("requestRemarks", e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Admin remarks
              </label>
              <Input
                value={form.reviewRemarks}
                onChange={(e) => set("reviewRemarks", e.target.value)}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Approval queue — ADMIN ONLY (rendered only when can("part.approve"))
 * ------------------------------------------------------------------ */
function PartApprovals({ onApproved }) {
  const [tab, setTab] = useState("pending"); // pending | approved | rejected
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [editingReq, setEditingReq] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === "approved" ? "approved,consumed" : tab;
      const { data } = await api.get("/part-approvals", { params: { status } });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load approval requests");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (req, action) => {
    let reviewRemarks = "";
    if (action === "reject") {
      reviewRemarks = window.prompt("Reason for rejecting this part number?") || "";
      if (!reviewRemarks.trim()) return;
    }

    setBusyId(req._id);
    try {
      await api.patch(`/part-approvals/${req._id}/${action}`, { reviewRemarks });
      toast.success(
        action === "approve"
          ? "Part number approved — the requester has been notified"
          : "Part number rejected — the requester has been notified"
      );
      await load();
      if (action === "approve") onApproved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the request");
    } finally {
      setBusyId(null);
    }
  };

  const TABS = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-display flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Part number approvals
            <Badge variant="outline">Admin</Badge>
            {tab === "pending" && requests.length > 0 && (
              <Badge variant="warning">{requests.length} waiting</Badge>
            )}
          </CardTitle>
          <CardDescription>
            New and alternate part numbers raised during material receiving. Stock can only be
            booked after the number is approved here.
          </CardDescription>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Button
              key={t.key}
              type="button"
              size="sm"
              variant={tab === t.key ? "default" : "outline"}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Raised</TableHead>
              <TableHead>Proposed part</TableHead>
              <TableHead className="w-[150px]">Type</TableHead>
              <TableHead className="w-[160px]">Vendor</TableHead>
              <TableHead className="w-[80px] text-right">Qty</TableHead>
              <TableHead className="w-[190px] text-right">Status</TableHead>
              <TableHead className="w-[60px] text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableEmpty colSpan={7}>Loading…</TableEmpty>}
            {!loading && requests.length === 0 && (
              <TableEmpty colSpan={7}>
                {tab === "pending" ? "Nothing waiting for approval." : `No ${tab} requests.`}
              </TableEmpty>
            )}
            {!loading &&
              requests.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDate(r.createdAt)}
                    {r.requestedBy ? (
                      <span className="block truncate" title={r.requestedBy}>
                        by {r.requestedBy}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <p className="truncate font-medium" title={r.newPart?.itemDescription}>
                      {r.newPart?.itemDescription}
                    </p>
                    <p className="truncate text-xs text-muted-foreground font-mono-tech">
                      {[r.newPart?.companyCode, r.newPart?.category, r.newPart?.partTypeBatchNo]
                        .filter(Boolean)
                        .join(" / ")}
                      {r.newPart?.manufacturerPartNumber
                        ? ` · Mfr: ${r.newPart.manufacturerPartNumber}`
                        : ""}
                    </p>
                    {r.requestRemarks ? (
                      <p className="truncate text-xs text-muted-foreground">{r.requestRemarks}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {r.requestType === "alternate_part" ? (
                      <div className="space-y-1">
                        <Badge variant="secondary" className="gap-1">
                          <GitBranchPlus className="h-3 w-3" />
                          Alternate
                        </Badge>
                        <p className="truncate text-xs text-muted-foreground">
                          of {r.alternateOfPart?.ttUniquePartNumber || "—"}
                        </p>
                      </div>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <PackagePlus className="h-3 w-3" />
                        New part
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="truncate text-sm" title={r.vendor?.companyName}>
                    {r.vendor?.companyName || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono-tech">
                    {r.proposedQuantity ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "pending" ? (
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={busyId === r._id}
                          onClick={() => review(r, "approve")}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r._id}
                          onClick={() => review(r, "reject")}
                        >
                          <ShieldX className="h-3.5 w-3.5 mr-1" />
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Badge
                          variant={
                            r.status === "rejected"
                              ? "destructive"
                              : r.status === "consumed"
                              ? "secondary"
                              : "success"
                          }
                        >
                          {r.status === "consumed"
                            ? `Created ${r.createdPart?.ttUniquePartNumber || ""}`.trim()
                            : r.status === "approved"
                            ? "Approved — awaiting stock"
                            : "Rejected"}
                        </Badge>
                        <p className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtDate(r.reviewedAt)}
                          {r.reviewedBy ? ` · ${r.reviewedBy}` : ""}
                        </p>
                        {r.reviewRemarks ? (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={r.reviewRemarks}
                          >
                            {r.reviewRemarks}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title="Edit this request"
                      disabled={r.status === "consumed"}
                      onClick={() => setEditingReq(r)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>

      {editingReq && (
        <EditRequestDialog
          request={editingReq}
          onClose={() => setEditingReq(null)}
          onSaved={(updated) => {
            setRequests((list) =>
              // a status change moves the row out of the tab currently shown
              updated.status === (tab === "approved" ? updated.status : tab) ||
              (tab === "approved" && ["approved", "consumed"].includes(updated.status))
                ? list.map((x) => (x._id === updated._id ? updated : x))
                : list.filter((x) => x._id !== updated._id)
            );
            onApproved?.();
          }}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Edit part popup — ADMIN ONLY
 * ------------------------------------------------------------------ */
const EDIT_FIELDS = [
  { key: "ttUniquePartNumber", label: "TT part number", mono: true },
  { key: "itemDescription", label: "Description", full: true },
  { key: "manufacturerPartNumber", label: "Manufacturer part no." },
  { key: "typeOfPart", label: "Type of part" },
  { key: "companyCode", label: "Company code" },
  { key: "category", label: "Category" },
  { key: "partTypeBatchNo", label: "Part type / batch no." },
  { key: "hsnCode", label: "HSN code" },
  { key: "unit", label: "Unit" },
];

function EditPartDialog({ part, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const base = {};
    EDIT_FIELDS.forEach((f) => {
      base[f.key] = part?.[f.key] ?? "";
    });
    base.isAlternatePart = Boolean(part?.isAlternatePart);
    base.remarks = part?.remarks ?? "";
    return base;
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!String(form.itemDescription || "").trim()) {
      toast.error("Description is required");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(`/parts/${part._id}`, form);
      toast.success("Part updated");
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the part");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        {/* sticky header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Edit part</h2>
            <p className="break-all text-xs text-muted-foreground">
              {part.ttUniquePartNumber} · stock {part.quantityInStock ?? 0}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {EDIT_FIELDS.map((f) => (
              <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </label>
                <Input
                  value={form[f.key] ?? ""}
                  className={f.mono ? "font-mono-tech" : ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks
              </label>
              <Input value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={form.isAlternatePart}
                onChange={(e) => set("isAlternatePart", e.target.checked)}
              />
              This is an alternate part
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Parts() {
  const { can } = useAuth();
  const isApprover = can?.("part.approve");

  const [parts, setParts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState({ key: "ttUniquePartNumber", dir: "asc" });
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/parts", { params: search ? { search } : {} });
        setParts(data);
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not load parts");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, reloadKey]);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );

  const sortedParts = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return parts;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...parts].sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [parts, sort]);

  const SortIcon = ({ colKey }) => {
    if (sort.key !== colKey) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3 text-accent" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3 text-accent" />
    );
  };

  const colCount = COLUMNS.length + (isApprover ? 1 : 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Parts master</h1>
          <p className="mt-1 text-sm text-muted-foreground">{parts.length} part(s) shown</p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search part number or description"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Approvals are visible to the admin only. */}
      {isApprover && <PartApprovals onApproved={() => setReloadKey((k) => k + 1)} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Master part database</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {COLUMNS.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`${col.width} ${
                      col.align === "right" ? "text-right" : "text-left"
                    } select-none`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-0.5 font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {col.label}
                      <SortIcon colKey={col.key} />
                    </button>
                  </TableHead>
                ))}
                {isApprover && <TableHead className="w-[80px] text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={colCount}>Loading…</TableEmpty>}
              {!loading && parts.length === 0 && (
                <TableEmpty colSpan={colCount}>No parts found.</TableEmpty>
              )}
              {!loading &&
                sortedParts.map((p) => (
                  <TableRow key={p._id}>
                    <TableCell>
                      <span className="id-chip">{p.ttUniquePartNumber}</span>
                    </TableCell>
                    <TableCell
                      className="overflow-hidden text-ellipsis whitespace-nowrap"
                      title={p.itemDescription}
                    >
                      {p.itemDescription}
                    </TableCell>
                    <TableCell className="font-mono-tech text-xs text-muted-foreground">
                      {p.manufacturerPartNumber || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.category}</TableCell>
                    <TableCell
                      className="overflow-hidden text-ellipsis whitespace-nowrap"
                      title={p.vendors?.map((v) => v.companyName).join(" / ")}
                    >
                      {p.vendors && p.vendors.length > 0 ? (
                        p.vendors.map((v) => v.companyName).join(" / ")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono-tech">{p.quantityInStock}</TableCell>
                    <TableCell>
                      {p.isAlternatePart ? (
                        <Badge variant="warning">Alternate</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isApprover && (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && (
        <EditPartDialog
          part={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) =>
            setParts((list) => list.map((p) => (p._id === updated._id ? { ...p, ...updated } : p)))
          }
        />
      )}
    </div>
  );
}
