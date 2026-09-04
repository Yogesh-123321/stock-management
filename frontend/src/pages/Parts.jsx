import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  ShieldAlert,
  Clock,
  GitBranchPlus,
  PackagePlus,
  Pencil,
  Trash2,
  Copy,
  Columns3,
  X,
  Save,
  Plus,
  ArrowRight,
} from "lucide-react";

/**
 * Column descriptor for the Parts master table.
 */
const COLUMNS = [
  {
    key: "ttUniquePartNumber",
    label: "TT part number",
    width: "w-[120px]",
    align: "left",
    sortValue: (p) => (p.ttUniquePartNumber || "").toLowerCase(),
  },
  {
    key: "itemDescription",
    label: "Description",
    // No fixed width — this column takes whatever space the others leave
    // behind, and its cells wrap instead of truncating (see the row
    // render below), so the full description is always visible without
    // a horizontal scrollbar.
    width: "w-auto",
    align: "left",
    sortValue: (p) => (p.itemDescription || "").toLowerCase(),
  },
  {
    key: "manufacturerPartNumber",
    label: "Mfr part no.",
    width: "w-[120px]",
    align: "left",
    sortValue: (p) => (p.manufacturerPartNumber || "").toLowerCase(),
  },
  {
    key: "category",
    label: "Category",
    width: "w-[90px]",
    align: "left",
    sortValue: (p) => (p.category || "").toLowerCase(),
  },
  {
    key: "vendors",
    label: "Vendor(s)",
    width: "w-[150px]",
    align: "left",
    sortValue: (p) =>
      (p.vendors && p.vendors.length ? p.vendors[0].companyName : "").toLowerCase(),
  },
  {
    key: "quantityInStock",
    label: "Stock qty",
    width: "w-[80px]",
    align: "right",
    sortValue: (p) => Number(p.quantityInStock ?? 0),
  },
  {
    key: "isAlternatePart",
    label: "Alternate?",
    width: "w-[95px]",
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
 * Raise a new / alternate part number request from the Parts master —
 * shown when a search comes up empty and the user holds "part.request".
 * Mirrors the flow in the Receive material section, minus the stock
 * quantity (nothing is booked here — it just queues an approval).
 * ------------------------------------------------------------------ */
function NewPartRequestDialog({ initialSearch = "", onClose, onCreated }) {
  const { user } = useAuth();
  const [isAlternate, setIsAlternate] = useState(false);
  const [alternateSearch, setAlternateSearch] = useState("");
  const [alternateOfPart, setAlternateOfPart] = useState(null);
  const [searchingAlternate, setSearchingAlternate] = useState(false);
  const [form, setForm] = useState({
    itemDescription: initialSearch || "",
    manufacturerPartNumber: "",
    typeOfPart: "",
    companyCode: "",
    category: "",
    partTypeBatchNo: "",
  });
  const [proposedQuantity, setProposedQuantity] = useState("");
  const [requestRemarks, setRequestRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const term = alternateSearch.trim();
    if (!term) {
      setAlternateOfPart(null);
      return undefined;
    }
    setSearchingAlternate(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: term } });
        setAlternateOfPart(data[0] || null);
      } catch {
        setAlternateOfPart(null);
      } finally {
        setSearchingAlternate(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [alternateSearch]);

  const submit = async (e) => {
    e.preventDefault();
    if (
      !form.itemDescription.trim() ||
      !form.companyCode.trim() ||
      !form.category.trim() ||
      !form.partTypeBatchNo.trim()
    ) {
      toast.error("Item description, company code, category and part type/batch no. are required");
      return;
    }
    if (isAlternate && !alternateOfPart) {
      toast.error("Search for and select the part this is an alternate of");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/part-approvals", {
        requestType: isAlternate ? "alternate_part" : "new_part_number",
        newPart: form,
        alternateOfPartId: isAlternate ? alternateOfPart._id : null,
        searchTerm: initialSearch,
        proposedQuantity: proposedQuantity ? Number(proposedQuantity) : null,
        requestedBy: user?.name || user?.username || "",
        requestRemarks,
      });
      toast.success("Sent for approval — the admin will review it in the Parts approvals panel");
      onCreated?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not send the part for approval");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Request a new part number</h2>
            <p className="text-xs text-muted-foreground">
              Not in the master database yet — fill in the details and send it for approval.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2 mb-4">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              This part number has to be approved by the admin before it appears in the master. Nothing is
              added to the database until then.
            </p>
          </div>

          <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant={!isAlternate ? "default" : "outline"}
              className="flex-1 justify-start"
              onClick={() => setIsAlternate(false)}
            >
              <PackagePlus className="h-4 w-4 mr-2" />
              Brand-new part
            </Button>
            <Button
              type="button"
              variant={isAlternate ? "default" : "outline"}
              className="flex-1 justify-start"
              onClick={() => setIsAlternate(true)}
            >
              <GitBranchPlus className="h-4 w-4 mr-2" />
              Alternate of an existing part
            </Button>
          </div>

          {isAlternate && (
            <div className="space-y-1.5 mb-4">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Search the part this is an alternate of
              </label>
              <Input
                placeholder="Part number or description"
                value={alternateSearch}
                onChange={(e) => setAlternateSearch(e.target.value)}
              />
              {searchingAlternate && (
                <p className="text-xs text-muted-foreground">Searching…</p>
              )}
              {!searchingAlternate && alternateSearch.trim() && !alternateOfPart && (
                <p className="text-xs text-destructive">No match found for “{alternateSearch}”.</p>
              )}
              {alternateOfPart && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-mono bg-muted rounded px-1.5 py-0.5">
                    {alternateOfPart.ttUniquePartNumber}
                  </span>
                  {alternateOfPart.itemDescription}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Item description
              </label>
              <Input
                value={form.itemDescription}
                onChange={(e) => set("itemDescription", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Manufacturer part no. (optional)
              </label>
              <Input
                value={form.manufacturerPartNumber}
                onChange={(e) => set("manufacturerPartNumber", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Type of part (optional)
              </label>
              <Input
                value={form.typeOfPart}
                onChange={(e) => set("typeOfPart", e.target.value)}
                placeholder="PCB, MECHANICAL, ..."
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Company code
              </label>
              <Input
                value={form.companyCode}
                onChange={(e) => set("companyCode", e.target.value)}
                placeholder="TT"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Category
              </label>
              <Input
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="AY"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Part type / batch no.
              </label>
              <Input
                value={form.partTypeBatchNo}
                onChange={(e) => set("partTypeBatchNo", e.target.value)}
                placeholder="FAN"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Expected quantity (optional)
              </label>
              <Input
                type="number"
                min="1"
                value={proposedQuantity}
                onChange={(e) => setProposedQuantity(e.target.value)}
                placeholder="Booked later, after approval"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks for the approver (optional)
              </label>
              <Textarea
                rows={2}
                value={requestRemarks}
                onChange={(e) => setRequestRemarks(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              {submitting ? "Sending…" : "Send for approval"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * "My part requests" — visible to anyone holding "part.request" who is
 * NOT an approver, so they can track what they raised without seeing
 * the full admin queue.
 * ------------------------------------------------------------------ */
function MyPartRequests({ reloadKey, onRequestNew }) {
  const [tab, setTab] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = tab === "approved" ? "approved,consumed" : tab;
      const { data } = await api.get("/part-approvals", { params: { status, mine: 1 } });
      setRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load your requests");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

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
            My part number requests
            {tab === "pending" && requests.length > 0 && (
              <Badge variant="warning">{requests.length} waiting</Badge>
            )}
          </CardTitle>
          <CardDescription>
            New or alternate part numbers you've raised, and their approval status.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button type="button" size="sm" onClick={onRequestNew}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New part request
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Raised</TableHead>
              <TableHead>Proposed part</TableHead>
              <TableHead className="w-[150px]">Type</TableHead>
              <TableHead className="w-[220px] text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableEmpty colSpan={4}>Loading…</TableEmpty>}
            {!loading && requests.length === 0 && (
              <TableEmpty colSpan={4}>
                {tab === "pending" ? "Nothing waiting for approval." : `No ${tab} requests.`}
              </TableEmpty>
            )}
            {!loading &&
              requests.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell className="overflow-hidden">
                    <p className="truncate font-medium" title={r.newPart?.itemDescription}>
                      {r.newPart?.itemDescription}
                    </p>
                    <p className="truncate text-xs text-muted-foreground font-mono-tech">
                      {[r.newPart?.companyCode, r.newPart?.category, r.newPart?.partTypeBatchNo]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </TableCell>
                  <TableCell>
                    {r.requestType === "alternate_part" ? (
                      <Badge variant="secondary" className="gap-1">
                        <GitBranchPlus className="h-3 w-3" />
                        Alternate
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <PackagePlus className="h-3 w-3" />
                        New part
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        r.status === "rejected"
                          ? "destructive"
                          : r.status === "pending"
                          ? "warning"
                          : r.status === "consumed"
                          ? "secondary"
                          : "success"
                      }
                    >
                      {r.status === "pending"
                        ? "Awaiting approval"
                        : r.status === "consumed"
                        ? `Created ${r.createdPart?.ttUniquePartNumber || ""}`.trim()
                        : r.status === "approved"
                        ? "Approved"
                        : "Rejected"}
                    </Badge>
                    {r.reviewRemarks ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={r.reviewRemarks}>
                        {r.reviewRemarks}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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

/* ------------------------------------------------------------------ *
 * Part details popup — read-only, opened by clicking any row.
 * Fetches the full record (with alternate-part linkage populated) since
 * the master table list doesn't carry everything.
 * ------------------------------------------------------------------ */
const DETAIL_FIELDS = [
  { key: "ttUniquePartNumber", label: "TT part number", mono: true },
  { key: "itemDescription", label: "Description", full: true },
  { key: "manufacturerPartNumber", label: "Manufacturer part no.", mono: true },
  { key: "typeOfPart", label: "Type of part" },
  { key: "companyCode", label: "Company code" },
  { key: "category", label: "Category" },
  { key: "partTypeBatchNo", label: "Part type / batch no." },
  { key: "runningSerialNo", label: "Running serial no." },
  { key: "hsnCode", label: "HSN code" },
  { key: "unit", label: "Unit" },
];

function PartDetailsDialog({ partId, onClose }) {
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/parts/${partId}`)
      .then(({ data }) => {
        if (!cancelled) setPart(data);
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not load part details");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partId]);

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Part details</h2>
            {part && (
              <p className="break-all text-xs text-muted-foreground">
                {part.ttUniquePartNumber}
              </p>
            )}
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}

          {!loading && part && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {DETAIL_FIELDS.map((f) => (
                  <div key={f.key} className={f.full ? "sm:col-span-2" : ""}>
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </p>
                    <p className={`text-sm ${f.mono ? "font-mono-tech" : ""}`}>
                      {part[f.key] || "—"}
                    </p>
                  </div>
                ))}

                <div>
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Stock qty
                  </p>
                  <p className="font-mono-tech text-sm">{part.quantityInStock ?? 0}</p>
                </div>

                <div>
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Vendor(s)
                  </p>
                  <p className="text-sm">
                    {part.vendors && part.vendors.length > 0
                      ? part.vendors.map((v) => v.companyName).join(" / ")
                      : "—"}
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Alternate part
                  </p>
                  {part.isAlternatePart ? (
                    <p className="text-sm">
                      <Badge variant="warning" className="mr-2">
                        Alternate
                      </Badge>
                      {part.alternateOf?.ttUniquePartNumber
                        ? `of ${part.alternateOf.ttUniquePartNumber}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                  {part.alternateParts?.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Has alternates:{" "}
                      {part.alternateParts.map((p) => p.ttUniquePartNumber).join(", ")}
                    </p>
                  )}
                </div>

                {part.remarks && (
                  <div className="sm:col-span-2">
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Remarks
                    </p>
                    <p className="text-sm">{part.remarks}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Added {fmtDate(part.createdAt)}</span>
                <span>Last updated {fmtDate(part.updatedAt)}</span>
                {part.lastEditedBy && <span>Last edited by {part.lastEditedBy}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Duplicate part-number finder — groups the master by manufacturer
 * part number and surfaces any group with more than one TT part number.
 * ------------------------------------------------------------------ */
function DuplicatePartsDialog({ onClose, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [comparingGroup, setComparingGroup] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get("/parts/duplicates")
      .then(({ data }) => {
        if (!cancelled) setGroups(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not check for duplicate parts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the group list (and the open comparison view, if any) in sync
  // after an edit or delete performed from inside the comparison grid.
  const handlePartUpdated = (updated) => {
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        parts: g.parts.map((p) => (p._id === updated._id ? { ...p, ...updated } : p)),
      }))
    );
    setComparingGroup((g) =>
      g
        ? { ...g, parts: g.parts.map((p) => (p._id === updated._id ? { ...p, ...updated } : p)) }
        : g
    );
    onChanged?.();
  };

  const handlePartDeleted = (deletedId) => {
    setGroups((gs) =>
      gs
        .map((g) => ({
          ...g,
          parts: g.parts.filter((p) => p._id !== deletedId),
          count: g.parts.some((p) => p._id === deletedId) ? g.count - 1 : g.count,
        }))
        .filter((g) => g.parts.length > 1)
    );
    setComparingGroup((g) => {
      if (!g) return g;
      const remaining = g.parts.filter((p) => p._id !== deletedId);
      // Fewer than 2 left means there's nothing left to compare.
      return remaining.length > 1 ? { ...g, parts: remaining, count: remaining.length } : null;
    });
    onChanged?.();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Copy className="h-4 w-4 text-accent" />
              Duplicate part numbers
            </h2>
            <p className="text-xs text-muted-foreground">
              Same manufacturer part number entered under more than one TT part number.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Checking…</p>}

          {!loading && groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No duplicate manufacturer part numbers found.
            </p>
          )}

          {!loading && groups.length > 0 && (
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.manufacturerPartNumber} className="rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/60 px-3 py-2">
                    <p className="font-mono-tech text-sm font-semibold">
                      Mfr: {g.manufacturerPartNumber}
                    </p>
                    <div className="flex items-center gap-2">
                      <Badge variant="warning">{g.count} entries</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setComparingGroup(g)}
                      >
                        <Columns3 className="mr-1 h-3.5 w-3.5" />
                        Compare
                      </Button>
                    </div>
                  </div>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px]">TT part number</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="w-[190px]">Vendor(s)</TableHead>
                        <TableHead className="w-[90px] text-right">Stock qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.parts.map((p) => (
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
                          <TableCell
                            className="overflow-hidden text-ellipsis whitespace-nowrap"
                            title={p.vendors?.map((v) => v.companyName).join(" / ")}
                          >
                            {p.vendors && p.vendors.length > 0
                              ? p.vendors.map((v) => v.companyName).join(" / ")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono-tech">
                            {p.quantityInStock ?? 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {comparingGroup && (
        <PartComparisonDialog
          group={comparingGroup}
          onClose={() => setComparingGroup(null)}
          onPartUpdated={handlePartUpdated}
          onPartDeleted={handlePartDeleted}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Side-by-side comparison grid for one duplicate group — every field
 * laid out as a row, one column per TT part number so differences are
 * easy to scan. Rows where the values differ across parts are highlighted.
 * Each part column also carries Edit / Delete actions (admin only).
 * ------------------------------------------------------------------ */
const COMPARISON_FIELDS = [
  { key: "ttUniquePartNumber", label: "TT part number", mono: true },
  { key: "itemDescription", label: "Description" },
  { key: "manufacturerPartNumber", label: "Manufacturer part no.", mono: true },
  { key: "typeOfPart", label: "Type of part" },
  { key: "companyCode", label: "Company code" },
  { key: "category", label: "Category" },
  { key: "partTypeBatchNo", label: "Part type / batch no." },
  { key: "runningSerialNo", label: "Running serial no." },
  { key: "hsnCode", label: "HSN code" },
  { key: "unit", label: "Unit" },
  {
    key: "quantityInStock",
    label: "Stock qty",
    mono: true,
    format: (p) => p.quantityInStock ?? 0,
  },
  {
    key: "vendors",
    label: "Vendor(s)",
    format: (p) => (p.vendors?.length ? p.vendors.map((v) => v.companyName).join(" / ") : "—"),
  },
  {
    key: "isAlternatePart",
    label: "Alternate part?",
    format: (p) => (p.isAlternatePart ? "Yes" : "No"),
  },
  { key: "remarks", label: "Remarks", format: (p) => p.remarks || "—" },
  { key: "createdAt", label: "Added", format: (p) => fmtDate(p.createdAt) },
];

function PartComparisonDialog({ group, onClose, onPartUpdated, onPartDeleted }) {
  const { can } = useAuth();
  const isApprover = can?.("part.approve");
  const parts = group.parts;

  const [editingPart, setEditingPart] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (part) => {
    const ok = window.confirm(`Delete part ${part.ttUniquePartNumber}? This cannot be undone.`);
    if (!ok) return;
    setDeletingId(part._id);
    try {
      await api.delete(`/parts/${part._id}`);
      toast.success(`${part.ttUniquePartNumber} deleted`);
      onPartDeleted?.(part._id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not delete the part");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Columns3 className="h-4 w-4 text-accent" />
              Comparing {parts.length} entries
            </h2>
            <p className="font-mono-tech text-xs text-muted-foreground">
              Mfr: {group.manufacturerPartNumber}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-[160px] bg-card px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Field
                </th>
                {parts.map((p) => (
                  <th
                    key={p._id}
                    className="min-w-[200px] border-l border-border bg-secondary/60 px-3 py-2 text-left"
                  >
                    <span className="id-chip">{p.ttUniquePartNumber}</span>
                    {isApprover && (
                      <div className="mt-1.5 flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Edit part"
                          onClick={() => setEditingPart(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          title="Delete part"
                          disabled={deletingId === p._id}
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FIELDS.map((f) => {
                const values = parts.map((p) => (f.format ? f.format(p) : p[f.key] || "—"));
                const differs = new Set(values.map((v) => String(v))).size > 1;
                return (
                  <tr
                    key={f.key}
                    className={`border-t border-border ${differs ? "bg-accent/10" : ""}`}
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {f.label}
                      {differs && (
                        <span className="ml-1.5 text-accent" title="Values differ">
                          ●
                        </span>
                      )}
                    </td>
                    {values.map((v, i) => (
                      <td
                        key={parts[i]._id}
                        className={`border-l border-border px-3 py-2 align-top ${
                          f.mono ? "font-mono-tech" : ""
                        }`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {editingPart && (
        <EditPartDialog
          part={editingPart}
          onClose={() => setEditingPart(null)}
          onSaved={(updated) => {
            onPartUpdated?.(updated);
            setEditingPart(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Parts() {
  const { can } = useAuth();
  const isApprover = can?.("part.approve");
  const canRequest = can?.("part.request");

  const [parts, setParts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState({ key: "ttUniquePartNumber", dir: "asc" });
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showNewPartRequest, setShowNewPartRequest] = useState(false);
  const [myRequestsReloadKey, setMyRequestsReloadKey] = useState(0);

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

  const handleDelete = async (part) => {
    const ok = window.confirm(
      `Delete part ${part.ttUniquePartNumber}? This cannot be undone.`
    );
    if (!ok) return;
    setDeletingId(part._id);
    try {
      await api.delete(`/parts/${part._id}`);
      toast.success(`${part.ttUniquePartNumber} deleted`);
      setParts((list) => list.filter((p) => p._id !== part._id));
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not delete the part");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Parts master</h1>
          <p className="mt-1 text-sm text-muted-foreground">{parts.length} part(s) shown</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setShowDuplicates(true)}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Find duplicate part numbers
          </Button>
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
      </div>

      {/* Approvals are visible to the admin only. */}
      {isApprover && <PartApprovals onApproved={() => setReloadKey((k) => k + 1)} />}

      {/* Everyone who can raise a part request (but isn't an approver) gets a
          compact panel to track what they've submitted. */}
      {canRequest && !isApprover && (
        <MyPartRequests
          reloadKey={myRequestsReloadKey}
          onRequestNew={() => setShowNewPartRequest(true)}
        />
      )}

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
                {isApprover && <TableHead className="w-[110px] text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={colCount}>Loading…</TableEmpty>}
              {!loading && parts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {search.trim()
                        ? `No part matches “${search.trim()}”.`
                        : "No parts found."}
                    </p>
                    {canRequest && (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-3"
                        onClick={() => setShowNewPartRequest(true)}
                      >
                        <PackagePlus className="h-3.5 w-3.5 mr-1.5" />
                        {search.trim()
                          ? `Send "${search.trim()}" for approval as a new part`
                          : "Request a new part number"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                sortedParts.map((p) => (
                  <TableRow
                    key={p._id}
                    className="cursor-pointer"
                    onClick={() => setViewingId(p._id)}
                  >
                    <TableCell className="align-top py-2">
                      <span className="id-chip">{p.ttUniquePartNumber}</span>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal break-words py-2">
                      {p.itemDescription}
                    </TableCell>
                    <TableCell className="align-top py-2 font-mono-tech text-xs text-muted-foreground">
                      {p.manufacturerPartNumber || "—"}
                    </TableCell>
                    <TableCell className="align-top py-2 text-muted-foreground">{p.category}</TableCell>
                    <TableCell
                      className="align-top whitespace-normal break-words py-2"
                      title={p.vendors?.map((v) => v.companyName).join(" / ")}
                    >
                      {p.vendors && p.vendors.length > 0 ? (
                        p.vendors.map((v) => v.companyName).join(" / ")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top py-2 text-right font-mono-tech">
                      {p.quantityInStock}
                    </TableCell>
                    <TableCell className="align-top py-2">
                      {p.isAlternatePart ? (
                        <Badge variant="warning">Alternate</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isApprover && (
                      <TableCell className="align-top py-2 text-right">
                        <div
                          className="flex justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Edit part"
                            onClick={() => setEditing(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Delete part"
                            disabled={deletingId === p._id}
                            onClick={() => handleDelete(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
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

      {viewingId && (
        <PartDetailsDialog partId={viewingId} onClose={() => setViewingId(null)} />
      )}

      {showDuplicates && (
        <DuplicatePartsDialog
          onClose={() => setShowDuplicates(false)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}

      {showNewPartRequest && (
        <NewPartRequestDialog
          initialSearch={search.trim()}
          onClose={() => setShowNewPartRequest(false)}
          onCreated={() => setMyRequestsReloadKey((k) => k + 1)}
        />
      )}
    </div>
  );
}