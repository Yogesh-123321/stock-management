import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
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
import CategorySelect from "@/components/CategorySelect";
import PriceTrendChart from "@/components/PriceTrendChart";
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
  ChevronDown,
  ChevronUp,
  History,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  Download,
  Paperclip,
} from "lucide-react";

/**
 * Column descriptor for the Parts master table.
 */
const COLUMNS = [
  {
    key: "ttUniquePartNumber",
    label: "TT part number",
    width: "w-[130px]",
    align: "left",
    sortValue: (p) => (p.ttUniquePartNumber || "").toLowerCase(),
  },
  {
    key: "itemDescription",
    label: "Description",
    // No fixed width — every other column below is trimmed to a compact
    // fixed size, so this one absorbs whatever space is left over. Kept
    // on a single line (see the row render below); the table stays
    // within the viewport, so no horizontal scrollbar is needed either.
    width: "w-auto",
    align: "left",
    sortValue: (p) => (p.itemDescription || "").toLowerCase(),
  },
  {
    key: "manufacturerPartNumber",
    label: "Mfr part no.",
    width: "w-[95px]",
    align: "left",
    sortValue: (p) => (p.manufacturerPartNumber || "").toLowerCase(),
  },
  {
    key: "category",
    label: "Category",
    width: "w-[75px]",
    align: "left",
    sortValue: (p) => (p.category || "").toLowerCase(),
  },
  {
    key: "vendors",
    label: "Vendor(s)",
    width: "w-[110px]",
    align: "left",
    sortValue: (p) =>
      (p.vendors && p.vendors.length ? p.vendors[0].companyName : "").toLowerCase(),
  },
  {
    key: "quantityInStock",
    label: "Stock qty",
    width: "w-[65px]",
    align: "right",
    sortValue: (p) => Number(p.quantityInStock ?? 0),
  },
  {
    key: "totalQtyInKits",
    label: "Qty in kits",
    width: "w-[80px]",
    align: "right",
    sortValue: (p) => Number(p.totalQtyInKits ?? 0),
  },
  {
    key: "isAlternatePart",
    label: "Alternate?",
    width: "w-[80px]",
    align: "left",
    sortValue: (p) => (p.isAlternatePart ? 1 : 0),
  },
];

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtPrice = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


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
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price per unit" },
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
                {f.key === "category" ? (
                  <CategorySelect value={form.category} onChange={(v) => set("category", v)} />
                ) : f.key === "price" ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price ?? ""}
                    onChange={(e) => set("price", e.target.value)}
                  />
                ) : (
                  <Input value={form[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
                )}
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
    unit: "",
    price: "",
  });
  const [proposedQuantity, setProposedQuantity] = useState("");
  const [requestRemarks, setRequestRemarks] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [datasheetFile, setDatasheetFile] = useState(null);
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
      const fd = new FormData();
      fd.append("requestType", isAlternate ? "alternate_part" : "new_part_number");
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (isAlternate && alternateOfPart) fd.append("alternateOfPartId", alternateOfPart._id);
      fd.append("searchTerm", initialSearch || "");
      if (proposedQuantity) fd.append("proposedQuantity", String(Number(proposedQuantity)));
      fd.append("requestedBy", user?.name || user?.username || "");
      fd.append("requestRemarks", requestRemarks);
      if (photoFile) fd.append("photo", photoFile);
      if (datasheetFile) fd.append("datasheet", datasheetFile);

      await api.post("/part-approvals", fd, {
        headers: { "Content-Type": "multipart/form-data" },
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
                <p className="text-xs text-destructive">No match found for "{alternateSearch}".</p>
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
              <CategorySelect value={form.category} onChange={(v) => set("category", v)} />
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
                Unit (optional)
              </label>
              <Input
                value={form.unit}
                onChange={(e) => set("unit", e.target.value)}
                placeholder="PCS, KG, MTR, ..."
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Price per unit (optional)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="Rate per unit, e.g. 12.50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Expected quantity (optional)
              </label>
              <Input
                type="number"
                min="0.001"
                step="any"
                value={proposedQuantity}
                onChange={(e) => setProposedQuantity(e.target.value)}
                placeholder="Booked later, after approval — decimals allowed"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Part photo (JPEG, optional)
              </label>
              <Input
                type="file"
                accept="image/jpeg"
                onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Datasheet (PDF, optional)
              </label>
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setDatasheetFile(e.target.files?.[0] || null)}
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
                        : r.status === "consumed" || r.status === "approved"
                        ? `Created ${r.createdPart?.ttUniquePartNumber || ""}`.trim()
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
function PartApprovals({ onApproved, canRequest, onRequestNew }) {
  const [tab, setTab] = useState("pending"); // pending | approved | rejected
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [editingReq, setEditingReq] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

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
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
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
        </button>
        {!collapsed && (
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
            {canRequest && (
              <Button type="button" size="sm" onClick={onRequestNew}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                New part request
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      {!collapsed && (
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
                    {(r.newPart?.photoUrl || r.newPart?.datasheetUrl) && (
                      <p className="mt-0.5 flex gap-2 text-xs">
                        {r.newPart?.photoUrl && (
                          <a
                            href={r.newPart.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-muted-foreground"
                          >
                            Photo
                          </a>
                        )}
                        {r.newPart?.datasheetUrl && (
                          <a
                            href={r.newPart.datasheetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-muted-foreground"
                          >
                            Datasheet
                          </a>
                        )}
                      </p>
                    )}
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
                          {r.status === "consumed" || r.status === "approved"
                            ? `Created ${r.createdPart?.ttUniquePartNumber || ""}`.trim()
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
      )}

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
const fileNameFromUrl = (url) => (url ? String(url).split("/").pop() : "");

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
  { key: "price", label: "Price per unit" },
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
  const [stockQty, setStockQty] = useState(String(part?.quantityInStock ?? 0));
  const [photoFile, setPhotoFile] = useState(null);
  const [datasheetFile, setDatasheetFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!String(form.itemDescription || "").trim()) {
      toast.error("Description is required");
      return;
    }
    const nextStock = Number(stockQty);
    if (stockQty === "" || Number.isNaN(nextStock) || nextStock < 0) {
      toast.error("Stock quantity must be zero or a positive number");
      return;
    }
    setSaving(true);
    try {
      let data;
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ""));
      if (photoFile) fd.append("photo", photoFile);
      if (datasheetFile) fd.append("datasheet", datasheetFile);
      ({ data } = await api.patch(`/parts/${part._id}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      }));

      // The stock quantity is a separate field on purpose — it's adjusted
      // through its own endpoint (a delta), not the general part-edit one,
      // so manual corrections here can never be confused with quantity
      // that came from an actual stock entry.
      const currentStock = Number(data.quantityInStock ?? part.quantityInStock ?? 0);
      if (nextStock !== currentStock) {
        const delta = nextStock - currentStock;
        const res = await api.patch(`/parts/${part._id}/stock`, { quantity: delta });
        data = { ...data, quantityInStock: res.data.quantityInStock };
      }

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
                {f.key === "category" ? (
                  <CategorySelect value={form.category} onChange={(v) => set("category", v)} />
                ) : f.key === "price" ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price ?? ""}
                    onChange={(e) => set("price", e.target.value)}
                  />
                ) : (
                  <Input
                    value={form[f.key] ?? ""}
                    className={f.mono ? "font-mono-tech" : ""}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Stock quantity
              </label>
              <Input
                type="number"
                min="0"
                className="font-mono-tech"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Manually correct the quantity in stock. This does not go through a stock entry / tax invoice.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks
              </label>
              <Input value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Part photo (JPEG)
              </label>
              <Input type="file" accept="image/jpeg" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              {part?.photoUrl && !photoFile && (
                <p className="mt-1 text-xs text-muted-foreground truncate">
                  Current:{" "}
                  <a href={part.photoUrl} target="_blank" rel="noreferrer" className="underline">
                    {fileNameFromUrl(part.photoUrl)}
                  </a>{" "}
                  — choose a file to replace it.
                </p>
              )}
              {photoFile && (
                <p className="mt-1 text-xs text-warning truncate">
                  Will replace the current photo with {photoFile.name} on save.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Datasheet (PDF)
              </label>
              <Input
                type="file"
                accept="application/pdf"
                onChange={(e) => setDatasheetFile(e.target.files?.[0] || null)}
              />
              {part?.datasheetUrl && !datasheetFile && (
                <p className="mt-1 text-xs text-muted-foreground truncate">
                  Current:{" "}
                  <a href={part.datasheetUrl} target="_blank" rel="noreferrer" className="underline">
                    {fileNameFromUrl(part.datasheetUrl)}
                  </a>{" "}
                  — choose a file to replace it.
                </p>
              )}
              {datasheetFile && (
                <p className="mt-1 text-xs text-warning truncate">
                  Will replace the current datasheet with {datasheetFile.name} on save.
                </p>
              )}
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
  { key: "hsnCode", label: "HSN code" },
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price per unit" },
];

function PartDetailsDialog({ partId, onClose, onPartUpdated }) {
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

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
              {/* Photo pinned top-right; detail fields flow around it */}
              <div className="flow-root">
                <div className="float-right ml-4 mb-3 w-40">
                  {part.photoUrl ? (
                    <a
                      href={part.photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-fit"
                      title="Open full-size photo"
                    >
                      <img
                        src={part.photoUrl}
                        alt={part.itemDescription}
                        className="h-40 w-40 rounded border border-border object-cover"
                      />
                    </a>
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
                      No photo
                    </div>
                  )}
                </div>

                <div className="text-[0px]">
                {DETAIL_FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className={`inline-block w-full align-top pb-3 sm:w-1/2 sm:pr-3 ${
                      f.full ? "sm:w-full sm:pr-0" : ""
                    }`}
                  >
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {f.label}
                    </p>
                    <p className={`text-sm ${f.mono ? "font-mono-tech" : ""}`}>
                      {part[f.key] || "—"}
                    </p>
                  </div>
                ))}

                <div className="inline-block w-full align-top pb-3 sm:w-1/2 sm:pr-3">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Stock qty
                  </p>
                  <p className="font-mono-tech text-sm">{part.quantityInStock ?? 0}</p>
                </div>

                <div className="inline-block w-full align-top pb-3 sm:w-1/2 sm:pr-3">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Qty in kits
                  </p>
                  <p className="font-mono-tech text-sm">
                    {part.totalQtyInKits ?? 0}
                    {part.kitTemplateCount ? (
                      <span className="ml-1.5 text-xs font-sans text-muted-foreground">
                        issued via {part.kitTemplateCount} kit template(s)
                      </span>
                    ) : null}
                  </p>
                </div>

                <div className="inline-block w-full align-top pb-3 sm:w-1/2 sm:pr-3">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Vendor(s)
                  </p>
                  <p className="text-sm">
                    {part.vendors && part.vendors.length > 0
                      ? part.vendors.map((v) => v.companyName).join(" / ")
                      : "—"}
                  </p>
                </div>

                <div className="inline-block w-full align-top pb-3 sm:w-1/2 sm:pr-3">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Datasheet
                  </p>
                  {part.datasheetUrl ? (
                    <a
                      href={part.datasheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline"
                    >
                      {fileNameFromUrl(part.datasheetUrl)}
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </div>

                <div className="inline-block w-full align-top pb-3">
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
                  <div className="inline-block w-full align-top pb-3">
                    <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Remarks
                    </p>
                    <p className="text-sm">{part.remarks}</p>
                  </div>
                )}
              </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Added {fmtDate(part.createdAt)}</span>
                <span>Last updated {fmtDate(part.updatedAt)}</span>
                {part.lastEditedBy && <span>Last edited by {part.lastEditedBy}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={() => setShowHistory(true)} disabled={!part}>
            <History className="mr-1.5 h-3.5 w-3.5" />
            History
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {showHistory && part && (
        <PartHistoryDialog
          part={part}
          onClose={() => setShowHistory(false)}
          onPartChanged={(updated) => {
            setPart((p) => (p ? { ...p, ...updated } : p));
            onPartUpdated?.(updated);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Part history — two tabs:
 *  - Stock movements: the bank-statement style ledger of every time
 *    stock for this part moved (received / issued), newest on top.
 *  - Documents: a log of when the photo / datasheet were uploaded,
 *    replaced or removed, so a lost file can be traced back.
 *
 * The documents tab is fetched lazily (only once the user switches to
 * it) from a separate endpoint, since it's a different data source
 * (document/audit trail rather than stock-entries / kit-issues).
 * ------------------------------------------------------------------ */
function PartHistoryDialog({ part, onClose, onPartChanged }) {
  const [tab, setTab] = useState("stock"); // "stock" | "documents"

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
const [analysis, setAnalysis] = useState(null);
const [analysisLoading, setAnalysisLoading] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");
  const [docEntries, setDocEntries] = useState([]);
  const docsLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/parts/${part._id}/history`)
      .then(({ data }) => {
        if (!cancelled) setData(data);
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not load part history");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part._id]);
useEffect(() => {
  let cancelled = false;

  setAnalysisLoading(true);

  api
    .get(`/stock-entries/analysis/${part._id}`)
    .then(({ data }) => {
      if (!cancelled) setAnalysis(data);
    })
    .catch(() => {
      if (!cancelled) setAnalysis(null);
    })
    .finally(() => {
      if (!cancelled) setAnalysisLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [part._id]);
  // Documents tab loads lazily, the first time it's opened, rather than
  // up front alongside the stock ledger.
  useEffect(() => {
    if (tab !== "documents" || docsLoadedRef.current) return;
    docsLoadedRef.current = true;
    setDocsLoading(true);
    setDocsError("");
    api
      .get(`/parts/${part._id}/document-history`)
      .then(({ data }) => {
        setDocEntries(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        setDocEntries([]);
        setDocsError(err.response?.data?.message || "Could not load document history");
      })
      .finally(() => setDocsLoading(false));
  }, [tab, part._id]);

  const entries = data?.entries || [];

  // Receipt lines ("in") live in the stock-entries collection; kit issue
  // lines ("out") live on a KitIssue document instead, so each entryType
  // is deleted through its own endpoint. Both endpoints restore/undo the
  // stock they had applied, mirroring what the ledger already shows.
  const deleteEntry = async (entry) => {
    const isKitIssue = entry.entryType === "kit_issue";
    const ok = window.confirm(
      isKitIssue
        ? `Undo this kit issue line? ${entry.quantity} unit(s) will be added back to the current stock.`
        : entry.stockApplied
        ? `Delete this history line? ${entry.quantity} unit(s) will be removed from the current stock as well.`
        : "Delete this history line? It was still pending (invoice not uploaded) so stock is unaffected."
    );
    if (!ok) return;
    setDeletingId(entry._id);
    try {
      if (isKitIssue) {
        await api.delete(`/kits/issues/${entry.issueId}/lines/${entry.lineId}`);
      } else {
        await api.delete(`/stock-entries/${entry._id}`);
      }
      toast.success(isKitIssue ? "Kit issue line reverted — stock restored" : "History entry deleted");
      setData((d) => {
        if (!d) return d;
        const remainingEntries = d.entries.filter((e) => e._id !== entry._id);
        const closingBalance = isKitIssue
          ? (d.closingBalance ?? 0) + entry.quantity
          : entry.stockApplied
          ? Math.max(0, (d.closingBalance ?? 0) - entry.quantity)
          : d.closingBalance ?? 0;
        return { ...d, entries: remainingEntries, closingBalance };
      });
      onPartChanged?.({
        _id: part._id,
        quantityInStock: isKitIssue
          ? (data.closingBalance ?? 0) + entry.quantity
          : entry.stockApplied
          ? Math.max(0, (data.closingBalance ?? 0) - entry.quantity)
          : data.closingBalance ?? 0,
      });
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not delete this history entry");
    } finally {
      setDeletingId(null);
    }
  };

  const TABS = [
    { key: "stock", label: "Stock movements", icon: History },
    { key: "documents", label: "Documents", icon: Paperclip },
  ];

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Part history</h2>
            <p className="break-all text-xs text-muted-foreground">
              {part.ttUniquePartNumber} · {part.itemDescription}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* tab switcher */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-secondary/30 px-5 py-2">
          {TABS.map((t) => (
            <Button
              key={t.key}
              type="button"
              size="sm"
              variant={tab === t.key ? "default" : "outline"}
              onClick={() => setTab(t.key)}
            >
              <t.icon className="mr-1.5 h-3.5 w-3.5" />
              {t.label}
            </Button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "stock" && (
            <>
              {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}

              {!loading && data && (
                <>
                <Card className="mb-4 border-purple-500/30">
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Sparkles className="h-4 w-4" />
      AI Price Analyzer
    </CardTitle>
  </CardHeader>

  <CardContent>
    {analysisLoading ? (
      <p className="text-sm text-muted-foreground">
        Analysing purchase history...
      </p>
    ) : analysis && analysis.trend?.length ? (
      <>
        {/* AI insight */}
        <div className="mb-4 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-purple-600">
            <Sparkles className="h-3.5 w-3.5" />
            AI insight
          </div>
          <p className="text-sm leading-relaxed">{analysis.aiInsight || analysis.summary}</p>
        </div>

        {/* Indicators */}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Average price</div>
            <div className="font-semibold">₹{Number(analysis.avgPrice).toFixed(2)}</div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Median price</div>
            <div className="font-semibold">₹{Number(analysis.medianPrice).toFixed(2)}</div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Volatility</div>
            <div className="font-semibold">
              ±{Number(analysis.volatilityPercent).toFixed(1)}%
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                {analysis.volatilityPercent > 15 ? "high" : "low"}
              </span>
            </div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Trend</div>
            <div
              className={`font-semibold ${
                analysis.trendDirection === "rising"
                  ? "text-red-500"
                  : analysis.trendDirection === "falling"
                  ? "text-emerald-600"
                  : ""
              }`}
            >
              {analysis.trendDirection === "rising" && "▲ Rising"}
              {analysis.trendDirection === "falling" && "▼ Falling"}
              {analysis.trendDirection === "stable" && "● Stable"}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                {Math.abs(Number(analysis.momentumPercent)).toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Highest price</div>
            <div className="font-semibold">₹{analysis.highestPrice}</div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Lowest price</div>
            <div className="font-semibold">₹{analysis.lowestPrice}</div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Range (low → high)</div>
            <div className="font-semibold text-red-500">{analysis.increasePercent}%</div>
          </div>
          <div className="rounded border border-border p-2.5">
            <div className="text-[11px] text-muted-foreground">Latest vs average</div>
            <div className={`font-semibold ${analysis.latestVsAvgPercent > 0 ? "text-red-500" : "text-emerald-600"}`}>
              {analysis.latestVsAvgPercent > 0 ? "+" : ""}
              {Number(analysis.latestVsAvgPercent).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Trend chart */}
        <div className="mb-4 rounded-lg border border-border p-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Price trend
          </div>
          <PriceTrendChart data={analysis.trend} />
        </div>

        {/* Suggested vendor */}
        {analysis.suggestedVendor && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" />
              Suggested vendor for this purchase
            </div>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{analysis.suggestedVendor.vendor}</span>
              <Badge variant="success">Recommended</Badge>
              <span className="text-xs text-muted-foreground">
                Avg ₹{Number(analysis.suggestedVendor.avgPrice).toFixed(2)} · {analysis.suggestedVendor.count} purchase
                {analysis.suggestedVendor.count > 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-sm leading-relaxed">{analysis.suggestedVendor.reason}</p>
          </div>
        )}

        {/* Vendor comparison */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vendor comparison
          </div>
          {analysis.vendorAnalysis?.map((v) => {
            const isBest = analysis.bestVendor?.vendor === v.vendor;
            const isWorst = analysis.worstVendor?.vendor === v.vendor;
            return (
              <div
                key={v.vendor}
                className={`rounded border p-2.5 ${
                  isBest ? "border-emerald-500/40 bg-emerald-500/5" : isWorst ? "border-red-500/40 bg-red-500/5" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{v.vendor}</span>
                  {isBest && <Badge variant="success">Best pricing</Badge>}
                  {isWorst && <Badge variant="destructive">Highest pricing</Badge>}
                  {typeof v.vsAvgPercent === "number" && (
                    <span className="text-xs text-muted-foreground">
                      {v.vsAvgPercent > 0 ? "+" : ""}
                      {v.vsAvgPercent}% vs avg
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                  <span>Avg: ₹{Number(v.avgPrice).toFixed(2)}</span>
                  <span>Highest: ₹{v.highest}</span>
                  <span>Lowest: ₹{v.lowest}</span>
                  <span>Purchases: {v.count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </>
    ) : (
      <p className="text-sm text-muted-foreground">
        {analysis?.summary || "No analysis available."}
      </p>
    )}
  </CardContent>
</Card>
                  <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm">
                    
                    <div>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Current balance
                      </span>
                      <p className="font-mono-tech text-base font-semibold">
                        {data.closingBalance ?? 0}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      Received (in)
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpFromLine className="h-3.5 w-3.5" />
                      Issued (out)
                    </div>
                  </div>

                  {entries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No stock movements recorded for this part yet.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full table-fixed text-sm">
                        <colgroup>
                          <col className="w-[13%]" />
                          <col className="w-[27%]" />
                          <col className="w-[17%]" />
                          <col className="w-[11%]" />
                          <col className="w-[10%]" />
                          <col className="w-[11%]" />
                          <col className="w-[8%]" />
                          <col className="w-[3%]" />
                        </colgroup>
                        <thead className="bg-secondary/70">
                          <tr className="border-b border-border">
                            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Date
                            </th>
                            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              From / To
                            </th>
                            <th className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Reference
                            </th>
                            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Qty
                            </th>
                            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Price
                            </th>
                            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Amount
                            </th>
                            <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Balance
                            </th>
                            <th className="px-1 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {" "}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                          {entries.map((e) => (
                            <tr key={e._id} className="border-b border-border">
                              <td className="px-2 py-1.5 align-top text-xs text-muted-foreground">
                                {fmtDateTime(e.date)}
                              </td>
                              <td className="min-w-0 px-2 py-1.5 align-top">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  {e.direction === "out" ? (
                                    <ArrowUpFromLine className="h-3.5 w-3.5 shrink-0 text-destructive" />
                                  ) : (
                                    <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                  )}
                                  <span className="truncate" title={e.party?.name || ""}>
                                    {e.party?.name || "—"}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {e.type === "received" && !e.stockApplied && (
                                    <Badge variant="warning">Pending invoice</Badge>
                                  )}
                                  {e.type === "received" && e.batchCode && (
                                    <Badge variant="secondary" className="font-mono-tech">
                                      Batch {e.batchCode}
                                    </Badge>
                                  )}
                                  {e.type === "issued" &&
                                    (e.batchBreakdown || []).map((b, i) => (
                                      <Badge key={i} variant="secondary" className="font-mono-tech">
                                        {b.batchCode ? `Batch ${b.batchCode}` : "No batch"}: {b.quantity}
                                      </Badge>
                                    ))}
                                </div>
                                {e.remarks && (
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={e.remarks}>
                                    {e.remarks}
                                  </p>
                                )}
                              </td>
                              <td className="min-w-0 px-2 py-1.5 align-top text-xs text-muted-foreground">
                                <span
                                  className="block truncate"
                                  title={
                                    e.reference
                                      ? `${e.reference.type}${
                                          e.reference.number ? ` #${e.reference.number}` : ""
                                        }`
                                      : ""
                                  }
                                >
                                  {e.reference
                                    ? `${e.reference.type}${
                                        e.reference.number ? ` #${e.reference.number}` : ""
                                      }`
                                    : "—"}
                                </span>
                              </td>
                              <td
                                className={`px-2 py-1.5 align-top text-right font-mono-tech ${
                                  e.direction === "out" ? "text-destructive" : "text-emerald-600"
                                }`}
                              >
                                {e.direction === "out" ? "−" : "+"}
                                {e.quantity}
                                {part?.unit ? (
                                  <span className="ml-0.5 text-[10px] text-muted-foreground">{part.unit}</span>
                                ) : null}
                              </td>
                              <td className="px-2 py-1.5 align-top text-right font-mono-tech text-xs text-muted-foreground">
                                {/* The rate entered on this specific delivery, if any — falls
                                    back to the part's registered rate for older entries logged
                                    before per-entry pricing existed. */}
                                {fmtPrice(e.price ?? part?.price)}
                              </td>
                              <td className="px-2 py-1.5 align-top text-right font-mono-tech text-xs text-muted-foreground">
                                {(() => {
                                  const rate = e.price ?? part?.price;
                                  return rate != null ? fmtPrice(rate * e.quantity) : "—";
                                })()}
                              </td>
                              <td className="px-2 py-1.5 align-top text-right font-mono-tech font-semibold">
                                {e.balance}
                              </td>
                              <td className="px-1 py-1.5 align-top text-right">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  title="Delete this history entry"
                                  disabled={deletingId === e._id}
                                  onClick={() => deleteEntry(e)}
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {tab === "documents" && (
            <>
              {docsLoading && (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              )}

              {!docsLoading && docsError && (
                <p className="py-8 text-center text-sm text-destructive">{docsError}</p>
              )}

              {!docsLoading && !docsError && docEntries.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No photo or datasheet changes recorded for this part yet.
                </p>
              )}

              {!docsLoading && !docsError && docEntries.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/70">
                      <tr className="border-b border-border">
                        <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Date
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Field
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Action
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          File
                        </th>
                        <th className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          By
                        </th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                      {docEntries.map((e) => (
                        <tr key={e._id} className="border-b border-border">
                          <td className="px-2.5 py-1.5 align-top text-xs text-muted-foreground">
                            {fmtDateTime(e.date)}
                          </td>
                          <td className="px-2.5 py-1.5 align-top">
                            <Badge variant="secondary" className="capitalize">
                              {e.field}
                            </Badge>
                          </td>
                          <td className="px-2.5 py-1.5 align-top">
                            <Badge
                              variant={
                                e.action === "removed"
                                  ? "destructive"
                                  : e.action === "replaced"
                                  ? "warning"
                                  : "success"
                              }
                              className="capitalize"
                            >
                              {e.action}
                            </Badge>
                          </td>
                          <td className="px-2.5 py-1.5 align-top">
                            {e.url ? (
                              <a
                                href={e.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline text-sm"
                              >
                                {fileNameFromUrl(e.url)}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {e.previousUrl && (
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                was:{" "}
                                <a href={e.previousUrl} target="_blank" rel="noreferrer" className="underline">
                                  {fileNameFromUrl(e.previousUrl)}
                                </a>
                              </p>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 align-top text-xs text-muted-foreground">
                            {e.changedBy || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
  const [criteria, setCriteria] = useState([]);
  const [criterion, setCriterion] = useState("manufacturerPartNumber");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [comparingGroup, setComparingGroup] = useState(null);

  // Populates the dropdown. Falls back to just the original
  // manufacturer-number check if this call fails for some reason, so an
  // older backend (or a hiccup) doesn't leave the dropdown empty.
  useEffect(() => {
    api
      .get("/parts/duplicate-criteria")
      .then(({ data }) => {
        if (Array.isArray(data) && data.length) setCriteria(data);
      })
      .catch(() => {
        setCriteria([{ value: "manufacturerPartNumber", label: "Manufacturer part number (exact match)" }]);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    api
      .get("/parts/duplicates", { params: { criterion } })
      .then(({ data }) => {
        if (!cancelled) setGroups(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        const message = err.response?.data?.message || "Could not check for duplicate parts";
        if (!cancelled) {
          setGroups([]);
          setLoadError(message);
        }
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [criterion]);

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
              Parts that look like the same real-world item entered more than once.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-secondary/30 px-5 py-3">
          <span className="text-xs font-medium text-muted-foreground">Compare by</span>
          <Select value={criterion} onValueChange={setCriterion}>
            <SelectTrigger className="h-8 w-auto min-w-[220px] text-sm">
              <SelectValue />
            </SelectTrigger>
            {/* z-[200]: this dialog is z-[120] and Radix portals the list to
                document.body, so the shared default of z-50 would paint
                behind the dialog overlay (see CategorySelect.jsx for the
                same fix). */}
            <SelectContent className="z-[200]">
              {criteria.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  <span className="inline-flex items-center gap-1.5">
                    {c.value === "aiSimilarity" && <Sparkles className="h-3.5 w-3.5 text-accent" />}
                    {c.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {criterion === "aiSimilarity" && (
            <span className="text-xs text-muted-foreground">
              Uses AI to catch same-part descriptions worded differently — may take a moment.
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Checking…</p>}

          {!loading && loadError && (
            <p className="py-8 text-center text-sm text-destructive">{loadError}</p>
          )}

          {!loading && !loadError && groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No duplicates found on this criterion.
            </p>
          )}

          {!loading && !loadError && groups.length > 0 && (
            <div className="space-y-4">
              {groups.map((g, gIdx) => (
                <div key={`${g.criterion}-${gIdx}`} className="rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary/60 px-3 py-2">
                    <p className="truncate text-sm font-semibold" title={g.label}>
                      {g.label}
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
  { key: "hsnCode", label: "HSN code" },
  { key: "unit", label: "Unit" },
  { key: "price", label: "Price per unit", mono: true, format: (p) => (p.price ?? p.price === 0 ? p.price : "—") },
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
            <p className="truncate font-mono-tech text-xs text-muted-foreground" title={group.label}>
              {group.label}
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
  // True once the user has explicitly clicked a column header for the
  // current set of results. Until then, a multi-word search ("a b") shows
  // the server's relevance order (all-terms matches, then earlier-term-only
  // matches, then later-term-only matches) instead of being immediately
  // re-sorted back to plain alphabetical order.
  const [manualSort, setManualSort] = useState(false);
  const isMultiTermSearch = search.trim().split(/\s+/).filter(Boolean).length > 1;
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [showNewPartRequest, setShowNewPartRequest] = useState(false);
  const [myRequestsReloadKey, setMyRequestsReloadKey] = useState(0);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  // "Download parts" — admin only. Two separate CSVs (parts master +
  // part/vendor details), each saved as its own file, same as the
  // activity log's "Export CSV" button — never zipped together.
  const downloadPartsCsv = async () => {
    setDownloadingCsv(true);
    const today = new Date().toISOString().slice(0, 10);
    const files = [
      { url: "/parts/export/parts-csv", name: `parts-master-${today}.csv` },
      { url: "/parts/export/vendor-links-csv", name: `part-vendor-details-${today}.csv` },
    ];
    try {
      for (const file of files) {
        const { data } = await api.get(file.url, { responseType: "blob" });
        const blobUrl = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(blobUrl);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not download parts");
    } finally {
      setDownloadingCsv(false);
    }
  };

  // Guards against out-of-order responses: the debounce below only stops a
  // timer that hasn't fired *yet*, so if the user starts typing a search
  // before the initial (unfiltered, up to 5000-row) load has finished, both
  // requests end up in flight together. Without this guard, whichever one's
  // response lands last wins — so the slower unfiltered load can arrive
  // after the search's filtered results and silently replace them with the
  // full, unrelated parts list. Each fetch is tagged with an ever-increasing
  // id; a response is only applied if it's still the most recent one fired.
  const latestRequestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      const requestId = ++latestRequestId.current;
      setLoading(true);
      try {
        const { data } = await api.get("/parts", { params: search ? { search } : {} });
        if (requestId !== latestRequestId.current) return; // superseded — ignore
        setParts(data);
        // Fresh results for this search start in relevance order; a manual
        // column-sort choice only applies until the search text changes again.
        setManualSort(false);
      } catch (err) {
        if (requestId !== latestRequestId.current) return;
        toast.error(err.response?.data?.message || "Could not load parts");
      } finally {
        if (requestId === latestRequestId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, reloadKey]);

  const toggleSort = (key) => {
    setManualSort(true);
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  };

  const sortedParts = useMemo(() => {
    // A multi-word search the user hasn't manually re-sorted: keep the
    // server's relevance order (all-terms matches first, then partial
    // matches) rather than collapsing it back to a column sort.
    if (isMultiTermSearch && !manualSort) return parts;
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
  }, [parts, sort, isMultiTermSearch, manualSort]);

  const SortIcon = ({ colKey }) => {
    if (sort.key !== colKey) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return sort.dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3 text-accent" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3 text-accent" />
    );
  };

  const colCount = COLUMNS.length + 1 + (isApprover ? 1 : 0);

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
          {isApprover && (
            <Button
              type="button"
              variant="outline"
              onClick={downloadPartsCsv}
              disabled={downloadingCsv}
              title="Download the parts master and part/vendor details as CSV files"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {downloadingCsv ? "Preparing…" : "Download parts"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setShowDuplicates(true)}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Find duplicate part numbers
          </Button>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search part number, description or remarks"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Approvals are visible to the admin only. The admin can also raise a
          new part request straight from this section, so there's only one
          panel (not a separate "my requests" one) for admins to deal with. */}
      {isApprover && (
        <PartApprovals
          onApproved={() => setReloadKey((k) => k + 1)}
          canRequest={canRequest}
          onRequestNew={() => setShowNewPartRequest(true)}
        />
      )}

      {/* Everyone who can raise a part request but isn't an approver gets a
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
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[56px] text-left select-none">S.No</TableHead>
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
                        ? `No part matches "${search.trim()}".`
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
                sortedParts.map((p, idx) => (
                  <TableRow
                    key={p._id}
                    className="cursor-pointer"
                    onClick={() => setViewingId(p._id)}
                  >
                    <TableCell className="align-top py-1 text-muted-foreground font-mono-tech">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="align-top py-1">
                      <span
                        className="id-chip block max-w-full truncate"
                        title={p.ttUniquePartNumber}
                      >
                        {p.ttUniquePartNumber}
                      </span>
                    </TableCell>
                    <TableCell
                      className="align-top truncate py-1"
                      title={p.itemDescription}
                    >
                      {p.itemDescription}
                    </TableCell>
                    <TableCell
                      className="align-top truncate py-1 font-mono-tech text-xs text-muted-foreground"
                      title={p.manufacturerPartNumber || ""}
                    >
                      {p.manufacturerPartNumber || "—"}
                    </TableCell>
                    <TableCell className="align-top py-1 text-muted-foreground">{p.category}</TableCell>
                    <TableCell
                      className="align-top truncate py-1"
                      title={p.vendors?.map((v) => v.companyName).join(" / ")}
                    >
                      {p.vendors && p.vendors.length > 0 ? (
                        p.vendors.map((v) => v.companyName).join(" / ")
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top py-1 text-right font-mono-tech">
                      {p.quantityInStock}
                    </TableCell>
                    <TableCell
                      className="align-top py-1 text-right font-mono-tech text-muted-foreground"
                      title={
                        p.kitTemplateCount
                          ? `Issued via ${p.kitTemplateCount} kit template(s)`
                          : "Not yet issued in any kit"
                      }
                    >
                      {p.totalQtyInKits ?? 0}
                    </TableCell>
                    <TableCell className="align-top py-1">
                      {p.isAlternatePart ? (
                        <Badge variant="warning">Alternate</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isApprover && (
                      <TableCell className="align-top py-1 text-right">
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
        <PartDetailsDialog
          partId={viewingId}
          onClose={() => setViewingId(null)}
          onPartUpdated={(updated) =>
            setParts((list) => list.map((p) => (p._id === updated._id ? { ...p, ...updated } : p)))
          }
        />
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