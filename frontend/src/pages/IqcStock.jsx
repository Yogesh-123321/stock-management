import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import api from "@/lib/api";
import IqcReportForm from "@/components/IqcReportForm";
import { ClipboardList, ClipboardCheck, XCircle, CheckCircle2, X, Search } from "lucide-react";

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

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
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
                <ul className="space-y-2">
                  {visibleEntries.map((e) => (
                    <li key={e._id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
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