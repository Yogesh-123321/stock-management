import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import VendorSearchSelect from "@/components/VendorSearchSelect";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import IssueRndStockPanel from "@/components/IssueRndStockPanel";
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
  PackageOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  History,
  Undo2,
  Pencil,
  X,
  Plus,
  Trash2,
  Save,
  FolderClock,
  PlayCircle,
  FilePenLine,
  FlaskConical,
  Download,
  Loader2,
} from "lucide-react";

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

// Downloads an .xlsx from a GET endpoint. The filename is chosen here rather
// than read from Content-Disposition, which browsers hide on cross-origin
// requests (the frontend and backend live on different domains in prod).
async function downloadXlsx(path, filename) {
  try {
    const res = await api.get(path, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    // With responseType "blob" an error body arrives as a Blob — read it
    // so the server's message (e.g. "Please sign in") still shows up.
    let msg = "Could not download the Excel file";
    try {
      const text = await err.response?.data?.text?.();
      if (text) msg = JSON.parse(text).message || msg;
    } catch {
      /* keep the default message */
    }
    toast.error(msg);
    return false;
  }
}

// File name for one issued kit's Excel download, e.g. kit-issue-ABC11A.xlsx
const issueXlsxName = (issue) =>
  `kit-issue-${String(issue.issueCode || issue.kitName || "kit").replace(/[^A-Za-z0-9._-]+/g, "_")}.xlsx`;

// Client-side mirror of the backend's FIFO batch walk (see
// utils/batchAllocation.js) — used only to preview, before a kit is
// actually issued, which batch(es) a line's qty will be drawn from.
// `batches` is a snapshot from when the template was last loaded, so
// this is indicative, not authoritative — the backend re-computes the
// real breakdown against live stock the moment the kit is actually
// issued.
function previewBatchBreakdown(batches, qty) {
  let remaining = Number(qty) || 0;
  const breakdown = [];
  for (const b of batches || []) {
    if (remaining <= 0) break;
    if (b.remaining <= 0) continue;
    const take = Math.min(b.remaining, remaining);
    if (take > 0) {
      breakdown.push({ batchCode: b.batchCode, quantity: take });
      remaining -= take;
    }
  }
  if (remaining > 0) breakdown.push({ batchCode: null, quantity: remaining });
  return breakdown;
}

// Renders a batch breakdown (from either previewBatchBreakdown or the
// batchBreakdown a real kit issue line already has) as "B1: 10, B2: 2".
function formatBatchBreakdown(breakdown) {
  if (!breakdown || breakdown.length === 0) return "—";
  return breakdown.map((b) => `${b.batchCode || "No batch"}: ${b.quantity}`).join(", ");
}

/* ------------------------------------------------------------------ *
 * Edit an already-issued kit — never touches the entry it was opened
 * from. Saving does NOT issue anything: it stores the edited version as a
 * saved kit (a draft, nothing deducted from stock), which is then issued
 * from the "Saved kits" tab — that's when it takes the next code in the
 * kit's edit series (ABC11 -> ABC11A -> ABC11B, ...). The same dialog is
 * reused to keep editing such a saved edit (`issue.status === "draft"`),
 * which just updates it in place. Prefilled from the issue's own snapshot
 * lines, whose `part` is populated with live stock (see getKitIssues /
 * getKitDrafts), so no separate template fetch is needed here.
 * ------------------------------------------------------------------ */
function EditKitIssueDialog({ issue, onClose, onSaved }) {
  // true = re-opened from the Saved kits tab to keep editing a saved edit.
  const isDraft = issue.status === "draft";
  const sourceLabel = isDraft
    ? issue.editedFrom?.issueCode || issue.editedFrom?.kitName || issue.kitName
    : issue.issueCode || issue.kitName;
  const [quantity, setQuantity] = useState(String(issue.quantity || 1));
  const [vendor, setVendor] = useState(issue.vendor || null);
  const [remarks, setRemarks] = useState(issue.remarks || "");
  const [submitting, setSubmitting] = useState(false);
  const [issueQtyOverrides, setIssueQtyOverrides] = useState(() => {
    const init = {};
    (issue.lines || []).forEach((l) => {
      init[l.ttUniquePartNumber] = String(l.qtyIssued);
    });
    return init;
  });
  // Parts added on this edit that weren't part of the original issue.
  const [extraLines, setExtraLines] = useState([]);
  const [addingPart, setAddingPart] = useState(false);

  const qtyNum = Number(quantity) || 0;

  const preview = useMemo(
    () =>
      (issue.lines || []).map((l) => {
        const available = l.part?.quantityInStock ?? 0;
        const required = (l.qtyPerKit || 0) * qtyNum;
        const ok = available >= required;
        const defaultToIssue = Math.min(available, required);
        return {
          ttUniquePartNumber: l.ttUniquePartNumber,
          itemDescription: l.part?.itemDescription || l.itemDescription,
          qtyPerKit: l.qtyPerKit,
          required,
          available,
          ok,
          defaultToIssue,
          previouslyIssued: l.qtyIssued,
        };
      }),
    [issue.lines, qtyNum]
  );

  const hasShortfall = preview.some((p) => !p.ok);

  const qtyToIssueFor = (p) => {
    const override = issueQtyOverrides[p.ttUniquePartNumber];
    return override === undefined || override === "" ? p.defaultToIssue : Number(override);
  };
  const setQtyToIssueFor = (code, value) =>
    setIssueQtyOverrides((prev) => ({ ...prev, [code]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!qtyNum || qtyNum < 1) {
      toast.error("Quantity must be a whole number of at least 1");
      return;
    }
    if (!vendor) {
      toast.error("Select the vendor this kit is being issued to");
      return;
    }

    const linesPayload = [];
    for (const p of preview) {
      const q = qtyToIssueFor(p);
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        toast.error(`Qty being issued for ${p.ttUniquePartNumber} must be a whole number of 0 or more`);
        return;
      }
      if (q > p.available) {
        toast.error(
          `Qty being issued for ${p.ttUniquePartNumber} (${q}) can't exceed available stock (${p.available})`
        );
        return;
      }
      linesPayload.push({ ttUniquePartNumber: p.ttUniquePartNumber, qtyIssued: q });
    }

    const extraItemsPayload = [];
    for (const l of extraLines) {
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        toast.error(`Qty for added part ${l.ttUniquePartNumber} must be a whole number of 0 or more`);
        return;
      }
      if (q > l.available) {
        toast.error(
          `Qty for ${l.ttUniquePartNumber} (${q}) can't exceed available stock (${l.available})`
        );
        return;
      }
      if (q > 0) {
        extraItemsPayload.push({ ttUniquePartNumber: l.ttUniquePartNumber });
        linesPayload.push({ ttUniquePartNumber: l.ttUniquePartNumber, qtyIssued: q });
      }
    }

    setSubmitting(true);
    try {
      const body = {
        quantity: qtyNum,
        vendor: vendor._id,
        remarks,
        lines: linesPayload,
        extraItems: extraItemsPayload,
      };
      // First save creates the saved kit; later saves update it in place.
      const { data } = isDraft
        ? await api.patch(`/kits/drafts/${issue._id}`, body)
        : await api.post(`/kits/issues/${issue._id}/edit`, body);
      toast.success(data.message || "Saved — issue it from the Saved kits tab");
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the edited kit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Pencil className="h-4 w-4 text-accent" />
              {isDraft ? "Edit saved kit" : "Edit issued kit"} — {sourceLabel}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-mono-tech">{sourceLabel}</span> stays exactly as it is — saving here
              never changes it and deducts nothing from stock. Your edit is kept in the{" "}
              <span className="font-medium">Saved kits</span> tab; issue it from there when you're
              ready.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form id="edit-kit-issue-form" onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Issue to vendor
              </label>
              <VendorSearchSelect value={vendor} onSelect={setVendor} placeholder="Start typing the vendor name…" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Quantity to issue
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                className="font-mono-tech"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks (optional)
              </label>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {hasShortfall ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Short on stock for {qtyNum || 0} kit(s) — will issue with shortfall logged
                </Badge>
              ) : (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Stock covers {qtyNum || 0} kit(s)
                </Badge>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/70">
                  <tr className="border-b border-border">
                    {[
                      "TT part #",
                      "Description",
                      "Qty/kit",
                      "Required",
                      isDraft ? "Last saved" : "Previously issued",
                      "Available",
                      "Qty issuing",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                  {preview.map((p) => (
                    <tr key={p.ttUniquePartNumber} className="border-b border-border">
                      <td className="px-2.5 py-1.5 text-xs font-mono-tech">{p.ttUniquePartNumber}</td>
                      <td className="px-2.5 py-1.5 text-xs">{p.itemDescription || "—"}</td>
                      <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{p.qtyPerKit}</td>
                      <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{p.required}</td>
                      <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech text-muted-foreground">
                        {p.previouslyIssued}
                      </td>
                      <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{p.available}</td>
                      <td className="px-2.5 py-1.5">
                        <Input
                          type="number"
                          min="0"
                          max={p.available}
                          step="1"
                          className="h-7 w-20 ml-auto font-mono-tech text-xs text-right"
                          value={issueQtyOverrides[p.ttUniquePartNumber] ?? String(p.defaultToIssue)}
                          onChange={(e) => setQtyToIssueFor(p.ttUniquePartNumber, e.target.value)}
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        {p.ok ? (
                          <Badge variant="success" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            OK
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Short
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Additional parts (not on the original issue)
                </p>
                {!addingPart && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setAddingPart(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add a part
                  </Button>
                )}
              </div>

              {addingPart && (
                <div className="flex items-start gap-2 rounded-md border border-dashed border-border p-2">
                  <div className="min-w-0 flex-1">
                    <AlternatePartPicker
                      value={null}
                      placeholder="Search a part to add to this issue…"
                      onChange={(p) => {
                        if (!p) return;
                        const already =
                          preview.some((pr) => pr.ttUniquePartNumber === p.ttUniquePartNumber) ||
                          extraLines.some((l) => l.ttUniquePartNumber === p.ttUniquePartNumber);
                        if (already) {
                          toast.error(`${p.ttUniquePartNumber} is already on this issue`);
                          return;
                        }
                        setExtraLines((prev) => [
                          ...prev,
                          {
                            _key: Math.random().toString(36).slice(2),
                            ttUniquePartNumber: p.ttUniquePartNumber,
                            itemDescription: p.itemDescription,
                            available: p.quantityInStock ?? 0,
                            qty: "1",
                          },
                        ]);
                        setAddingPart(false);
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setAddingPart(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {extraLines.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                      {extraLines.map((l) => (
                        <tr key={l._key} className="border-b border-border">
                          <td className="px-2.5 py-1.5 text-xs font-mono-tech">{l.ttUniquePartNumber}</td>
                          <td className="px-2.5 py-1.5 text-xs">{l.itemDescription || "—"}</td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech text-muted-foreground whitespace-nowrap">
                            {l.available} in stock
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max={l.available}
                              step="1"
                              className="h-7 w-20 ml-auto font-mono-tech text-xs text-right"
                              value={l.qty}
                              onChange={(e) =>
                                setExtraLines((prev) =>
                                  prev.map((x) => (x._key === l._key ? { ...x, qty: e.target.value } : x))
                                )
                              }
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Remove this added part"
                              onClick={() =>
                                setExtraLines((prev) => prev.filter((x) => x._key !== l._key))
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </form>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-kit-issue-form" disabled={submitting}>
            <Save className="mr-1.5 h-4 w-4" />
            {submitting ? "Saving…" : isDraft ? "Save changes" : "Save edited kit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Read-only look at one kit issue — its snapshot lines, exactly as
 * recorded at issue time. Opened by clicking a row in the Issued kits
 * tab below.
 * ------------------------------------------------------------------ */
function KitIssuePreviewDialog({ issue, onClose, onEdit }) {
  const lines = issue.lines || [];
  const [downloading, setDownloading] = useState(false);

  // This issued kit — who it went to, who issued it, every material — as Excel.
  const downloadContents = async () => {
    setDownloading(true);
    await downloadXlsx(`/kits/issues/${issue._id}/export`, issueXlsxName(issue));
    setDownloading(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-accent" />
              {issue.kitName}
              {issue.hasShortage && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Shortage
                </Badge>
              )}
              {issue.isEditable === false && (
                <Badge variant="secondary" className="gap-1">
                  View only
                </Badge>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span
                className="inline-block break-all rounded border border-border bg-[hsl(220_20%_97%)] px-1.5 py-0.5 font-mono-tech text-xs tracking-wide"
                title={issue.issueCode || ""}
              >
                {issue.issueCode || "—"}
              </span>{" "}
              {issue.editedFrom ? "— an edited entry; the one it came from is untouched" : "— original issue"}
              {issue.isEditable === false
                ? " — this entry has since been edited and is now locked; only its latest edit can be edited further"
                : ""}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Vendor
              </p>
              <p>{issue.vendor?.companyName || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Issued
              </p>
              <p>
                {fmtDateTime(issue.createdAt)} by {issue.issuedBy || "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Quantity
              </p>
              <p className="font-mono-tech">{issue.quantity}</p>
            </div>
            {issue.kitCode && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kit code
                </p>
                <p className="break-all font-mono-tech text-xs">{issue.kitCode}</p>
              </div>
            )}
          </div>

          {issue.remarks && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Remarks
              </p>
              <p className="text-sm text-muted-foreground">{issue.remarks}</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{lines.length} line(s) on this issue</p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/70">
                <tr className="border-b border-border">
                  {["TT part #", "Description", "Qty/kit", "Required", "Issued", "Batches", "Short"].map((h) => (
                    <th
                      key={h}
                      className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                      This issue has no lines.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l._id} className="border-b border-border">
                    <td className="px-2.5 py-1.5 text-xs font-mono-tech">{l.ttUniquePartNumber}</td>
                    <td className="px-2.5 py-1.5 text-xs">
                      {l.part?.itemDescription || l.itemDescription || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{l.qtyPerKit}</td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{l.qtyRequired}</td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{l.qtyIssued}</td>
                    <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                      {formatBatchBreakdown(l.batchBreakdown)}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                      {l.qtyShort > 0 ? (
                        <span className="text-destructive">{l.qtyShort}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="outline" onClick={downloadContents} disabled={downloading}>
            {downloading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {downloading ? "Preparing…" : "Download Excel"}
          </Button>
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Edit — saves to Saved kits
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One panel, two tabs: "Issued kits" (kits already deducted from
 * stock — edit/undo live here) and "Saved kits" (drafts still in
 * progress — nothing here has touched stock yet). Replaces the two
 * previously-separate cards with a single tabbed table.
 * ------------------------------------------------------------------ */
function KitsPanel({ reloadKey, canManage, onEdited, activeDraftId, onResume, onChanged, onCount }) {
  const [tab, setTab] = useState("issued");

  // ---- Issued kits state ----
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [issues, setIssues] = useState([]);
  const [busyIssueId, setBusyIssueId] = useState(null);
  const [editingIssue, setEditingIssue] = useState(null);
  const [previewingIssue, setPreviewingIssue] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // ---- Saved kits (drafts) state ----
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [busyDraftId, setBusyDraftId] = useState(null);

  const loadIssues = useCallback(async () => {
    setLoadingIssues(true);
    try {
      const { data } = await api.get("/kits/issues", { params: { limit: 25 } });
      setIssues(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load recent kit issues");
    } finally {
      setLoadingIssues(false);
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const { data } = await api.get("/kits/drafts", { params: { limit: 25 } });
      const list = Array.isArray(data) ? data : [];
      setDrafts(list);
      onCount?.(list.length);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load saved kits");
    } finally {
      setLoadingDrafts(false);
    }
  }, [onCount]);

  useEffect(() => {
    loadIssues();
    loadDrafts();
  }, [loadIssues, loadDrafts, reloadKey]);

  // One issued kit as an Excel slip (materials, vendor, issued by).
  const downloadIssue = async (iss) => {
    setDownloadingId(iss._id);
    await downloadXlsx(`/kits/issues/${iss._id}/export`, issueXlsxName(iss));
    setDownloadingId(null);
  };

  // -- Issued kits actions --
  const revertLine = async (issue) => {
    const lines = issue.lines || [];
    if (lines.length === 0) return;
    let line = lines[0];
    if (lines.length > 1) {
      const choice = window.prompt(
        `This issue has ${lines.length} parts:\n` +
          lines.map((l, i) => `${i + 1}. ${l.ttUniquePartNumber} (${l.qtyIssued} unit(s))`).join("\n") +
          "\n\nEnter the number of the line to revert:"
      );
      const idx = Number(choice) - 1;
      if (!choice || !Number.isInteger(idx) || idx < 0 || idx >= lines.length) return;
      line = lines[idx];
    } else {
      const ok = window.confirm(
        `Revert ${line.ttUniquePartNumber} (${line.qtyIssued} unit(s)) from this issue? Stock will be restored.`
      );
      if (!ok) return;
    }
    setBusyIssueId(line._id);
    try {
      await api.delete(`/kits/issues/${issue._id}/lines/${line._id}`);
      toast.success("Line reverted — stock restored");
      loadIssues();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not revert this line");
    } finally {
      setBusyIssueId(null);
    }
  };

  // -- Saved kits actions --
  const issueNow = async (draft) => {
    const ok = window.confirm(
      `Issue "${draft.kitName}" now, using what's currently saved on it? Stock will be deducted.`
    );
    if (!ok) return;
    setBusyDraftId(draft._id);
    try {
      const { data } = await api.post(`/kits/drafts/${draft._id}/issue`, {});
      const shortCount = (data.lines || []).filter((l) => (l.qtyShort || 0) > 0).length;
      if (shortCount > 0) {
        toast.error(
          `Issued as ${data.issueCode} — ${shortCount} part(s) were short and only partially deducted`,
          { duration: 6000 }
        );
      } else {
        toast.success(data.message || `Issued as ${data.issueCode}`);
      }
      onChanged?.(draft._id);
      loadDrafts();
      loadIssues();
      setTab("issued");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not issue this saved kit");
    } finally {
      setBusyDraftId(null);
    }
  };

  const discard = async (draft) => {
    const ok = window.confirm(`Discard the saved kit "${draft.kitName}"? This can't be undone.`);
    if (!ok) return;
    setBusyDraftId(draft._id);
    try {
      await api.delete(`/kits/drafts/${draft._id}`);
      toast.success("Saved kit discarded");
      onChanged?.(draft._id);
      loadDrafts();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not discard this saved kit");
    } finally {
      setBusyDraftId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display flex items-center gap-2">
          <PackageOpen className="h-4 w-4" />
          Kits
        </CardTitle>
        <CardDescription>
          Issued kits have already been deducted from stock. Saved kits are still in progress — nothing
          is deducted until one of those is actually issued.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="issued" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              Issued kits
            </TabsTrigger>
            <TabsTrigger value="saved" className="gap-1.5">
              <FolderClock className="h-3.5 w-3.5" />
              Saved kits
              {drafts.length > 0 && (
                <Badge variant="warning" className="ml-1">
                  {drafts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ---------------- Issued kits ---------------- */}
          <TabsContent value="issued">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Date</TableHead>
                  <TableHead>Kit</TableHead>
                  <TableHead className="w-[170px]">Code</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="w-[60px] text-right">Qty</TableHead>
                  <TableHead className="w-[130px]">Issued by</TableHead>
                  <TableHead className="w-[60px] text-center">Excel</TableHead>
                  {canManage && <TableHead className="w-[100px] text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingIssues && <TableEmpty colSpan={canManage ? 8 : 7}>Loading…</TableEmpty>}
                {!loadingIssues && issues.length === 0 && (
                  <TableEmpty colSpan={canManage ? 8 : 7}>No kits issued yet.</TableEmpty>
                )}
                {!loadingIssues &&
                  issues.map((iss) => (
                    <TableRow
                      key={iss._id}
                      className="cursor-pointer hover:bg-secondary/40"
                      title="Click to preview this kit issue"
                      onClick={() => setPreviewingIssue(iss)}
                    >
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(iss.createdAt)}
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <p className="truncate font-medium">{iss.kitName}</p>
                        {iss.kitCode && (
                          <p className="truncate text-xs text-muted-foreground font-mono-tech">
                            {iss.kitCode}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <span
                            className="inline-block break-all rounded border border-border bg-[hsl(220_20%_97%)] px-1.5 py-0.5 font-mono-tech text-xs tracking-wide"
                            title={
                              (iss.editedFrom
                                ? "An edited entry — the one it came from is untouched. "
                                : "Original issue. ") + (iss.issueCode || "")
                            }
                          >
                            {iss.issueCode || "—"}
                          </span>
                          {iss.isEditable === false && (
                            <Badge
                              variant="secondary"
                              className="gap-1"
                              title="This entry has been edited — view only from here on"
                            >
                              View only
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="truncate">{iss.vendor?.companyName || "—"}</TableCell>
                      <TableCell className="text-right font-mono-tech">{iss.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">
                        {iss.issuedBy || "—"}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Download this kit's issued materials as Excel"
                          onClick={() => downloadIssue(iss)}
                          disabled={downloadingId !== null}
                        >
                          {downloadingId === iss._id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              title={
                                iss.isEditable === false
                                  ? "Superseded by a later edit — view only, can no longer be edited"
                                  : "Edit — saves your changes as a saved kit; this entry stays untouched"
                              }
                              onClick={() => setEditingIssue(iss)}
                              disabled={busyIssueId !== null || iss.isEditable === false}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              title="Revert a line from this issue"
                              onClick={() => revertLine(iss)}
                              disabled={!iss.lines?.length || busyIssueId !== null}
                            >
                              <Undo2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Undo reverts one line's quantity back onto the part's stock. Edit never changes the entry
              itself — it saves your changes as a new kit under Saved kits; issue it from there and it
              becomes the next entry (e.g. ABC11 → ABC11A → ABC11B) so the original stays as
              permanent history. Open a part's own history from the Parts master for full line-by-line
              control when an issue has several parts.
            </p>
          </TabsContent>

          {/* ---------------- Saved kits ---------------- */}
          <TabsContent value="saved">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Last saved</TableHead>
                  <TableHead>Kit</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="w-[60px] text-right">Qty</TableHead>
                  <TableHead className="w-[130px]">Saved by</TableHead>
                  <TableHead className="w-[150px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingDrafts && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
                {!loadingDrafts && drafts.length === 0 && (
                  <TableEmpty colSpan={6}>
                    No saved kits — use "Save for later" above to keep progress on a kit you're not ready
                    to issue yet.
                  </TableEmpty>
                )}
                {!loadingDrafts &&
                  drafts.map((d) => (
                    <TableRow key={d._id} className={d._id === activeDraftId ? "bg-secondary/40" : ""}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDateTime(d.updatedAt)}
                      </TableCell>
                      <TableCell className="overflow-hidden">
                        <p className="truncate font-medium">{d.kitName}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {d._id === activeDraftId && (
                            <Badge variant="warning" className="gap-1">
                              Open in form
                            </Badge>
                          )}
                          {d.editedFrom && (
                            <Badge variant="secondary" className="gap-1">
                              <Pencil className="h-3 w-3" />
                              Edit of {d.editedFrom.issueCode || d.editedFrom.kitName}
                            </Badge>
                          )}
                          {d.hasShortage && (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Short as saved
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="truncate">{d.vendor?.companyName || "Not chosen yet"}</TableCell>
                      <TableCell className="text-right font-mono-tech">{d.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate">
                        {d.issuedBy || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title={
                              d.editedFrom
                                ? "Continue editing this saved edit"
                                : "Continue editing — loads this back into the form above"
                            }
                            // A saved edit of an issued kit re-opens in the edit screen (it can
                            // carry added parts); an ordinary saved kit goes back to the form.
                            onClick={() => (d.editedFrom ? setEditingIssue(d) : onResume?.(d))}
                            disabled={busyDraftId !== null}
                          >
                            <FilePenLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Issue now, using what's saved"
                            onClick={() => issueNow(d)}
                            disabled={busyDraftId !== null}
                          >
                            <PlayCircle className="h-3.5 w-3.5 text-success" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Discard this saved kit"
                            onClick={() => discard(d)}
                            disabled={busyDraftId !== null}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              A saved kit can be updated any number of times — each save just overwrites it in place,
              since nothing is deducted from stock until it's actually issued.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>

      {editingIssue && (
        <EditKitIssueDialog
          issue={editingIssue}
          onClose={() => setEditingIssue(null)}
          onSaved={() => {
            loadIssues();
            loadDrafts();
            setTab("saved"); // the edit lives under Saved kits until it's issued
            onEdited?.();
          }}
        />
      )}

      {previewingIssue && (
        <KitIssuePreviewDialog
          issue={previewingIssue}
          onClose={() => setPreviewingIssue(null)}
          onEdit={
            canManage && previewingIssue.isEditable !== false
              ? () => {
                  const iss = previewingIssue;
                  setPreviewingIssue(null);
                  setEditingIssue(iss);
                }
              : undefined
          }
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function IssueKit() {
  const { can } = useAuth();
  const canManage = can?.("kit.manage");
  // Issuing R&D stock is admin-only (part.approve) — same right the
  // backend checks on PATCH /parts/:id/rnd-stock — so only they see that tab.
  const canIssueRnd = can?.("part.approve");
  const [mainTab, setMainTab] = useState("kit"); // "kit" | "rnd"

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [template, setTemplate] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [quantity, setQuantity] = useState("1");
  const [vendor, setVendor] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [shortages, setShortages] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  // Set once this form is either loaded from, or saved as, a saved
  // (draft) kit — every further "Save" updates that same saved kit in
  // place, and "Issue kit" commits it, instead of starting a fresh one.
  const [draftId, setDraftId] = useState(null);
  // Per-item override for "qty actually being issued", keyed by
  // ttUniquePartNumber. A part with no entry here just falls back to the
  // auto default (min of available stock and required qty) shown in the
  // input. Cleared whenever a new template is chosen or after a submit.
  const [issueQtyOverrides, setIssueQtyOverrides] = useState({});
  // Per-line overrides to apply once a template finishes (re)loading as
  // part of resuming a saved kit — set synchronously in resumeDraft, read
  // and cleared once the template's items have arrived. A ref rather than
  // state so it's never stale by the time the fetch below resolves.
  const pendingResumeRef = useRef(null);

  useEffect(() => {
    api
      .get("/kits", { params: { activeOnly: 1 } })
      .then(({ data }) => setTemplates(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.response?.data?.message || "Could not load kit templates"));
  }, []);

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      return;
    }
    setLoadingTemplate(true);
    setShortages(null);
    setIssueQtyOverrides({});
    api
      .get(`/kits/${templateId}`)
      .then(({ data }) => {
        setTemplate(data);
        if (pendingResumeRef.current) {
          setIssueQtyOverrides(pendingResumeRef.current);
          pendingResumeRef.current = null;
        }
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not load that kit template");
        setTemplate(null);
        pendingResumeRef.current = null;
      })
      .finally(() => setLoadingTemplate(false));
  }, [templateId]);

  const issuableItems = useMemo(
    () => (template?.items || []).filter((it) => !it.dnp),
    [template]
  );

  const qtyNum = Number(quantity) || 0;

  const preview = useMemo(
    () =>
      issuableItems.map((it) => {
        const required = (it.qtyPerKit || 0) * qtyNum;
        const available = it.matchedPart?.quantityInStock ?? 0;
        const ok = !!it.matchedPart && available >= required;
        const defaultToIssue = Math.min(available, required);
        return { ...it, required, available, ok, defaultToIssue };
      }),
    [issuableItems, qtyNum]
  );

  const hasShortfall = preview.some((p) => !p.ok);

  // The qty currently shown/used for a row: whatever the user typed for
  // that part, or the auto default (min of available, required) if they
  // haven't touched it yet.
  const qtyToIssueFor = (p) => {
    const override = issueQtyOverrides[p.ttUniquePartNumber];
    return override === undefined || override === "" ? p.defaultToIssue : Number(override);
  };

  const setQtyToIssueFor = (ttUniquePartNumber, value) => {
    setIssueQtyOverrides((prev) => ({ ...prev, [ttUniquePartNumber]: value }));
  };

  const resetAfterIssue = () => {
    setQuantity("1");
    setVendor(null);
    setRemarks("");
    setTemplateId("");
    setTemplate(null);
    setIssueQtyOverrides({});
    setDraftId(null);
    pendingResumeRef.current = null;
  };

  // Loads a saved kit back into the form above so editing can continue —
  // used both from "Continue editing" in the Saved kits tab, and after
  // this same form saves a brand-new draft for the first time.
  const resumeDraft = (draft) => {
    const overrides = {};
    (draft.lines || []).forEach((l) => {
      overrides[l.ttUniquePartNumber] = String(l.qtyIssued);
    });
    pendingResumeRef.current = overrides;
    setDraftId(draft._id);
    setQuantity(String(draft.quantity || 1));
    setVendor(draft.vendor || null);
    setRemarks(draft.remarks || "");
    setShortages(null);
    const nextTemplateId = draft.kitTemplate?._id || draft.kitTemplate || "";
    if (nextTemplateId === templateId) {
      // Same template already loaded — the fetch effect won't re-fire,
      // so apply the overrides directly instead of leaving them pending.
      setIssueQtyOverrides(overrides);
      pendingResumeRef.current = null;
    } else {
      setTemplateId(nextTemplateId);
    }
    toast.success(`Resumed "${draft.kitName}" — continue below, then save or issue it`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Called when a saved kit is issued or discarded from the Saved kits
  // tab below. If that was the one currently open in this form, clear
  // the form so it doesn't keep pointing at a draft that's gone.
  const handleDraftListChange = (affectedDraftId) => {
    setReloadKey((k) => k + 1);
    if (draftId && affectedDraftId === draftId) {
      resetAfterIssue();
    }
  };

  // Saves (or updates) this kit's progress without touching stock. A qty
  // above what's currently available isn't blocked here — the whole point
  // of saving is that stock may still arrive before it's actually issued.
  const saveDraft = async () => {
    if (!template) {
      toast.error("Choose a kit template first");
      return;
    }
    const linesPayload = [];
    for (const p of preview) {
      const q = qtyToIssueFor(p);
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        toast.error(`Qty for ${p.ttUniquePartNumber} must be a whole number of 0 or more`);
        return;
      }
      linesPayload.push({ ttUniquePartNumber: p.ttUniquePartNumber, qtyIssued: q });
    }

    setSavingDraft(true);
    try {
      const payload = {
        quantity: qtyNum || 1,
        vendor: vendor?._id || null,
        remarks,
        lines: linesPayload,
      };
      const { data } = draftId
        ? await api.patch(`/kits/drafts/${draftId}`, payload)
        : await api.post(`/kits/${template._id}/draft`, payload);
      setDraftId(data._id);
      toast.success(data.message || "Saved");
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save this kit");
    } finally {
      setSavingDraft(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!template) {
      toast.error("Choose a kit template first");
      return;
    }
    if (!qtyNum || qtyNum < 1) {
      toast.error("Quantity must be a whole number of at least 1");
      return;
    }
    if (!vendor) {
      toast.error("Select the vendor this kit is being issued to");
      return;
    }
    if (vendor.status !== "approved") {
      toast.error("This vendor is still awaiting approval — it can't be issued to yet");
      return;
    }
    if ((vendor.activeStatus || "active") === "inactive") {
      toast.error("This vendor is marked inactive — it can't be issued to");
      return;
    }

    // Validate the per-line qty-to-issue overrides before sending: each
    // must be a non-negative whole number and can never exceed what's
    // actually in stock for that part.
    const linesPayload = [];
    for (const p of preview) {
      const q = qtyToIssueFor(p);
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        toast.error(`Qty being issued for ${p.ttUniquePartNumber} must be a whole number of 0 or more`);
        return;
      }
      if (q > p.available) {
        toast.error(
          `Qty being issued for ${p.ttUniquePartNumber} (${q}) can't exceed available stock (${p.available})`
        );
        return;
      }
      linesPayload.push({ ttUniquePartNumber: p.ttUniquePartNumber, qtyIssued: q });
    }

    setSubmitting(true);
    setShortages(null);
    try {
      const { data } = draftId
        ? await api.post(`/kits/drafts/${draftId}/issue`, {
            quantity: qtyNum,
            vendor: vendor._id,
            remarks,
            lines: linesPayload,
          })
        : await api.post(`/kits/${template._id}/issue`, {
            quantity: qtyNum,
            vendor: vendor._id,
            remarks,
            lines: linesPayload,
          });
      const shortLines = (data.lines || []).filter((l) => (l.qtyShort || 0) > 0);
      if (shortLines.length > 0) {
        toast.error(
          `Issued ${qtyNum} × "${template.kitName}" — ${shortLines.length} part(s) were short and only partially deducted`,
          { duration: 6000 }
        );
      } else {
        toast.success(
          `Issued ${qtyNum} × "${template.kitName}" to ${data.vendor?.companyName || "the vendor"}`
        );
      }
      resetAfterIssue();
      if (shortLines.length > 0) setShortages(shortLines);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not issue this kit");
    } finally {
      setSubmitting(false);
    }
  };

  const kitIssueSection = (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Pick a kit template, enter the quantity, and it's checked against live stock before anything
        is deducted. Issuing can take a while — use "Save for later" to keep your progress and come
        back to it, then issue it once everything's ready.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display flex items-center gap-2">
            Issue a kit
            {draftId && (
              <Badge variant="warning" className="gap-1">
                <FolderClock className="h-3 w-3" />
                Continuing a saved kit
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            A short kit is still issued — whatever stock is available gets deducted, and any
            shortfall is logged against the kit's issue history for follow-up. Not ready yet? Save it —
            nothing is deducted from stock until you actually issue it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kit template
                </label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a kit…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        {t.kitName} {t.kitCode ? `(${t.kitCode})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templates.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No active kit templates yet — ask an admin to create one under "Templates".
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quantity to issue
                </label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="font-mono-tech"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Issue to vendor
                </label>
                <VendorSearchSelect
                  value={vendor}
                  onSelect={setVendor}
                  placeholder="Start typing the vendor name…"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Remarks (optional)
                </label>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>

            {loadingTemplate && (
              <p className="text-sm text-muted-foreground">Loading kit items…</p>
            )}

            {!loadingTemplate && template && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {hasShortfall ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Short on stock for {qtyNum || 0} kit(s) — will issue with shortfall logged
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Stock covers {qtyNum || 0} kit(s)
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    {issuableItems.length} issuable item(s)
                    {template.items.length !== issuableItems.length
                      ? ` · ${template.items.length - issuableItems.length} DNP (excluded)`
                      : ""}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/70">
                      <tr className="border-b border-border">
                        {["TT part #", "Description", "Qty/kit", "Required", "Available", "Qty issuing", "Batches", "Status"].map(
                          (h) => (
                            <th
                              key={h}
                              className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                      {preview.map((p) => (
                        <tr key={p._id} className="border-b border-border">
                          <td className="px-2.5 py-1.5 text-xs font-mono-tech">
                            {p.ttUniquePartNumber}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs">
                            {p.matchedPart?.itemDescription || (
                              <span className="text-amber-700">not in parts master</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.qtyPerKit}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.required}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.available}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max={p.available}
                              step="1"
                              className="h-7 w-20 ml-auto font-mono-tech text-xs text-right"
                              value={
                                issueQtyOverrides[p.ttUniquePartNumber] ?? String(p.defaultToIssue)
                              }
                              onChange={(e) => setQtyToIssueFor(p.ttUniquePartNumber, e.target.value)}
                            />
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                            {formatBatchBreakdown(previewBatchBreakdown(p.batches, qtyToIssueFor(p)))}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {p.ok ? (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <XCircle className="h-3 w-3" />
                                Short
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {shortages && shortages.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Kit issued, but {shortages.length} part(s) were short — only available stock was
                  deducted:
                </p>
                <ul className="ml-5 list-disc space-y-0.5 text-muted-foreground">
                  {shortages.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono-tech">{s.ttUniquePartNumber}</span> — needed{" "}
                      {s.qtyRequired}, issued {s.qtyIssued} (short {s.qtyShort})
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-muted-foreground">
                  This shortfall is recorded against the kit issue — see the kit's issue history.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {draftId && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto text-xs text-muted-foreground"
                  onClick={resetAfterIssue}
                  disabled={submitting || savingDraft}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear form (keeps it saved)
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={savingDraft || submitting || !template}
                onClick={saveDraft}
              >
                <Save className="mr-1.5 h-4 w-4" />
                {savingDraft ? "Saving…" : draftId ? "Update saved kit" : "Save for later"}
              </Button>
              <Button type="submit" disabled={submitting || savingDraft || !template}>
                <Send className="mr-1.5 h-4 w-4" />
                {submitting ? "Issuing…" : "Issue kit"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <KitsPanel
        reloadKey={reloadKey}
        canManage={canManage}
        onEdited={() => setReloadKey((k) => k + 1)}
        activeDraftId={draftId}
        onResume={resumeDraft}
        onChanged={handleDraftListChange}
        onCount={setDraftCount}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <PackageOpen className="h-5 w-5" />
          {canIssueRnd ? "Issue kit & R&D stock" : "Issue kit"}
          {draftCount > 0 && (
            <Badge variant="warning" className="gap-1">
              <FolderClock className="h-3 w-3" />
              {draftCount} saved
            </Badge>
          )}
        </h1>
      </div>

      {canIssueRnd ? (
        <Tabs value={mainTab} onValueChange={setMainTab}>
          <TabsList>
            <TabsTrigger value="kit" className="gap-1.5">
              <PackageOpen className="h-3.5 w-3.5" />
              Kit issue
            </TabsTrigger>
            <TabsTrigger value="rnd" className="gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              Issue R&amp;D stock
            </TabsTrigger>
          </TabsList>

          <TabsContent value="kit">{kitIssueSection}</TabsContent>
          <TabsContent value="rnd">
            <IssueRndStockPanel />
          </TabsContent>
        </Tabs>
      ) : (
        kitIssueSection
      )}
    </div>
  );
}