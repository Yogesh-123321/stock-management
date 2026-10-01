import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import SearchableSelect from "@/components/ui/SearchableSelect";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import IqcReportForm from "@/components/IqcReportForm";
import IqcReferenceViewer from "@/components/IqcReferenceViewer";
import { ClipboardList, ClipboardCheck, ListChecks, XCircle, CheckCircle2, X, Search } from "lucide-react";

const TABS = [
  { key: "in_iqc_stock", label: "IQC stock", description: "Awaiting an IQC report — not yet in main stock." },
  {
    key: "rejected",
    label: "Rejected stock",
    description:
      "Failed IQC — kept out of main stock permanently. Includes any part of a delivery that wasn't approved, with the reason.",
  },
  { key: "accepted", label: "Accepted stock", description: "Passed IQC — credited to main stock. Newest 300 inspections." },
];

const TAB_ICON = { in_iqc_stock: ClipboardList, rejected: XCircle, accepted: CheckCircle2 };

const fmtWhen = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/*
  Bulk IQC report — lives inside the IQC stock window (not a page of its own).
  The selected lines are all checked against ONE template and approved in
  full in a single go. Anything that needs a partial approval or a rejection
  (quantity + reason per line) still goes through "Fill IQC report" on the
  individual line.
*/
function BulkIqcPanel({ selected, templates, onDone, onCancel }) {
  const { user } = useAuth();
  const [templateId, setTemplateId] = useState("");
  const [items, setItems] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedTemplate = templates.find((t) => t._id === templateId) || null;

  const templateOptions = useMemo(
    () =>
      templates.map((t) => ({
        value: t._id,
        label: t.materialName,
        sublabel: `${t.parameters?.length || 0} parameter${(t.parameters?.length || 0) === 1 ? "" : "s"}`,
      })),
    [templates]
  );

  useEffect(() => {
    setItems(
      (selectedTemplate?.parameters || []).map((p) => ({
        name: p.name,
        specification: p.specification || "",
        unit: p.unit || "",
        checked: false,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, templates]);

  const allChecked = items.length > 0 && items.every((it) => it.checked);
  const toggleItem = (idx) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)));

  const handleSubmit = async () => {
    if (!templateId) {
      toast.error("Choose an IQC template first");
      return;
    }
    if (!allChecked) {
      toast.error("Check every point on the IQC report first");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post("/stock-entries/iqc-report/bulk", {
        entryIds: selected.map((e) => e._id),
        templateId,
        items,
      });
      const ok = data.approved?.length || 0;
      const bad = data.failed?.length || 0;
      if (ok) toast.success(`${ok} line${ok === 1 ? "" : "s"} approved and added to main stock`);
      if (bad) toast.error(`${bad} line${bad === 1 ? "" : "s"} could not be approved: ${data.failed[0].message}`);
      onDone?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not submit the bulk IQC report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ListChecks className="h-4 w-4" />
        Bulk IQC report — {selected.length} line{selected.length === 1 ? "" : "s"}
      </div>

      <div className="max-h-32 overflow-y-auto rounded border border-border bg-card px-2.5 py-1.5">
        <ul className="space-y-0.5 text-xs">
          {selected.map((e) => (
            <li key={e._id} className="flex justify-between gap-3">
              <span className="truncate">
                <span className="font-mono">{e.part?.ttUniquePartNumber}</span>
                <span className="ml-1.5 text-muted-foreground">{e.part?.itemDescription}</span>
              </span>
              <span className="shrink-0 font-mono-tech">{e.quantityReceived}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Checklist template</Label>
        <SearchableSelect
          options={templateOptions}
          value={templateId}
          onChange={setTemplateId}
          placeholder="Choose an IQC template…"
          searchPlaceholder="Search templates…"
          emptyText="No template matches."
          contentClassName="z-[200]"
        />
      </div>

      {(items.length > 0 || selectedTemplate?.referenceFileUrl) && (
        <div className={selectedTemplate?.referenceFileUrl ? "grid gap-3 sm:grid-cols-2" : ""}>
          {items.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Check every point ({items.filter((i) => i.checked).length}/{items.length})
              </Label>
              <ul className="space-y-1.5">
                {items.map((it, idx) => (
                  <li key={idx} className="flex items-start gap-2 rounded border border-border bg-card px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      checked={it.checked}
                      onChange={() => toggleItem(idx)}
                      id={`bulk-iqc-${idx}`}
                    />
                    <label htmlFor={`bulk-iqc-${idx}`} className="text-sm leading-tight">
                      <span className="font-medium">{it.name}</span>
                      {(it.specification || it.unit) && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {it.specification}
                          {it.specification && it.unit ? " " : ""}
                          {it.unit}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selectedTemplate?.referenceFileUrl && (
            <div className="space-y-1.5">
              <Label className="text-xs">Compare against reference</Label>
              <IqcReferenceViewer
                url={selectedTemplate.referenceFileUrl}
                label={`Reference — ${selectedTemplate.materialName}`}
                fileLabel={selectedTemplate.referenceFileName}
                height="320px"
              />
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The full received quantity of every line above will be approved and added to main stock. For a partial
        approval or a rejection, use “Fill IQC report” on that line instead.
        {user?.name && (
          <>
            {" "}
            Recorded under <span className="font-medium text-foreground">{user.name}</span>.
          </>
        )}
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleSubmit} disabled={submitting || !templateId || !allChecked}>
          {submitting ? "Approving…" : `Approve ${selected.length} line${selected.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

/*
  IQC stock approve / reject window.

  No longer a page of its own (there is no sidebar entry any more) — it opens
  as a dialog over the Parts master when "IQC stock" is picked from the
  "MISC stock" column dropdown.

  onClose   - called when the window is dismissed
  onChanged - called once on close if at least one line was accepted or
              rejected while it was open, so the Parts master can refresh
              its stock figures
*/
export default function IqcStock({ onClose, onChanged }) {
  const [tab, setTab] = useState("in_iqc_stock");
  const [entries, setEntries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openEntryId, setOpenEntryId] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const changedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, templatesRes] = await Promise.all([
        api.get("/stock-entries/iqc-stock", { params: { status: tab } }),
        api.get("/iqc-templates"),
      ]);
      setEntries(Array.isArray(entriesRes.data) ? entriesRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
    } catch {
      setEntries([]);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  // Selection belongs to the tab it was made on.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkOpen(false);
  }, [tab]);

  const handleClose = () => {
    if (changedRef.current) onChanged?.();
    onClose?.();
  };

  // Escape closes the window, like the other dialogs on the Parts master.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResolved = (updatedEntry) => {
    changedRef.current = true;
    setOpenEntryId(null);
    // The line no longer belongs on this tab (it's now accepted/rejected).
    setEntries((prev) => prev.filter((e) => e._id !== updatedEntry._id));
  };

  const handleBulkDone = (result) => {
    const done = new Set(result?.approved || []);
    if (done.size > 0) {
      changedRef.current = true;
      setEntries((prev) => prev.filter((e) => !done.has(e._id)));
    }
    // Lines that failed stay selected so they can be retried.
    setSelectedIds((prev) => new Set([...prev].filter((id) => !done.has(id))));
    if (!(result?.failed?.length > 0)) setBulkOpen(false);
  };

  const toggleSelected = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const activeTab = TABS.find((t) => t.key === tab);

  // Client-side search over the lines already loaded for the active tab.
  // Every space-separated word has to match somewhere in the line (part
  // number, description, manufacturer part no., vendor, inspector).
  const visibleEntries = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return entries;
    return entries.filter((e) => {
      const haystack = [
        e.part?.ttUniquePartNumber,
        e.part?.itemDescription,
        e.part?.manufacturerPartNumber,
        e.vendor?.companyName,
        e.iqcReport?.inspectedBy,
        e.iqcReport?.rejectionReason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [entries, search]);
  const isSearching = search.trim() !== "";

  // Lines ticked for the bulk report (only ones still on this tab).
  const selectedEntries = useMemo(() => entries.filter((e) => selectedIds.has(e._id)), [entries, selectedIds]);
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((e) => selectedIds.has(e._id));
  const toggleAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleEntries.forEach((e) => next.delete(e._id));
      else visibleEntries.forEach((e) => next.add(e._id));
      return next;
    });

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-accent" />
              IQC stock
            </h2>
            <p className="text-xs text-muted-foreground">
              Material that has passed the tax invoice step. Anyone can inspect it — the person who submits an IQC
              report is recorded against that material.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {TABS.map((t) => {
                const Icon = TAB_ICON[t.key];
                return (
                  <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
                    <Icon className="h-4 w-4 mr-1.5" />
                    {t.label}
                  </Button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search part no., description or vendor"
                className="pl-9 pr-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {isSearching && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{activeTab.label}</CardTitle>
              <CardDescription>
                {activeTab.description}
                {isSearching && !loading && entries.length > 0 && (
                  <span className="ml-1">
                    · Showing {visibleEntries.length} of {entries.length}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Nothing here right now.</p>
              ) : visibleEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No line matches "{search.trim()}".
                </p>
              ) : tab !== "in_iqc_stock" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Part no.</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      {tab === "rejected" && <TableHead>Reason</TableHead>}
                      <TableHead>Inspected by</TableHead>
                      <TableHead>Inspected on</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleEntries.map((e) => (
                      <TableRow key={e._id}>
                        <TableCell className="font-mono text-xs">{e.part?.ttUniquePartNumber}</TableCell>
                        <TableCell className="truncate max-w-[240px]" title={e.part?.itemDescription}>
                          {e.part?.itemDescription}
                        </TableCell>
                        <TableCell>{e.vendor?.companyName}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {e.quantityReceived}
                          {e.iqcReport?.originalQuantity > e.quantityReceived && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              of {e.iqcReport.originalQuantity}
                            </span>
                          )}
                        </TableCell>
                        {tab === "rejected" && (
                          <TableCell
                            className="max-w-[220px] text-xs"
                            title={e.iqcReport?.rejectionReason || ""}
                          >
                            <span className="line-clamp-2">{e.iqcReport?.rejectionReason || "—"}</span>
                          </TableCell>
                        )}
                        <TableCell>{e.iqcReport?.inspectedBy || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtWhen(e.iqcReport?.inspectedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border accent-primary"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                      Select all{isSearching ? " shown" : ""} ({visibleEntries.length})
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={selectedEntries.length === 0 || bulkOpen}
                      onClick={() => setBulkOpen(true)}
                    >
                      <ListChecks className="h-4 w-4 mr-1.5" />
                      Bulk IQC report{selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ""}
                    </Button>
                  </div>

                  {bulkOpen && selectedEntries.length > 0 && (
                    <BulkIqcPanel
                      selected={selectedEntries}
                      templates={templates}
                      onDone={handleBulkDone}
                      onCancel={() => setBulkOpen(false)}
                    />
                  )}

                <ul className="space-y-2">
                  {visibleEntries.map((e) => (
                    <li key={e._id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
                          checked={selectedIds.has(e._id)}
                          onChange={() => toggleSelected(e._id)}
                          title="Select for bulk IQC report"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5 mr-1.5">
                              {e.part?.ttUniquePartNumber}
                            </span>
                            {e.part?.itemDescription}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {e.vendor?.companyName} · Qty received: {e.quantityReceived}
                          </p>
                        </div>
                        <Badge variant="warning">In IQC stock</Badge>
                      </div>

                      <div className="mt-2">
                        {openEntryId === e._id ? (
                          <IqcReportForm
                            entry={e}
                            templates={templates}
                            onDone={handleResolved}
                            onCancel={() => setOpenEntryId(null)}
                          />
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={() => setOpenEntryId(e._id)}>
                            <ClipboardCheck className="h-4 w-4 mr-1.5" />
                            Fill IQC report
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={handleClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}