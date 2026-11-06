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
import { SortableHead, useSort } from "@/components/SortableHead";
import { useAuth } from "@/lib/auth";
import {
  PackageOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  History,
  Undo2,
  RotateCcw,
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

// Quantities can be decimal (metres, kilograms, ...). Rounding to 4 places keeps
// float noise like 0.1 * 3 = 0.30000000000000004 out of the screens and payloads.
const r4 = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

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
    const take = r4(Math.min(b.remaining, remaining));
    if (take > 0) {
      breakdown.push({ batchCode: b.batchCode, quantity: take });
      remaining = r4(remaining - take);
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
 * Popup panel the person can resize: drag the left / right / bottom
 * edges or the bottom corners (the popup stays centred, so a side drag
 * grows both sides). Double-click the bottom-right grip to reset.
 * ------------------------------------------------------------------ */
function ResizablePanel({ defaultWidth = 960, children }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: null, h: null });

  const startDrag = (dir) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = rect.width;
    const sh = rect.height;
    const clampW = (v) => Math.max(360, Math.min(window.innerWidth - 32, v));
    const clampH = (v) => Math.max(320, Math.min(window.innerHeight - 32, v));
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const move = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      setSize((prev) => ({
        w: dir.includes("e") ? clampW(sw + 2 * dx) : dir.includes("w") ? clampW(sw - 2 * dx) : prev.w ?? sw,
        h: dir.includes("s") ? clampH(sh + dy) : prev.h,
      }));
    };
    const up = () => {
      document.body.style.userSelect = prevSelect;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const handle = "absolute z-30 touch-none";
  return (
    <div
      ref={ref}
      className="relative flex min-h-[320px] min-w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
      style={{
        width: size.w ?? `min(${defaultWidth}px, 100%)`,
        height: size.h ?? undefined,
        maxHeight: "calc(100vh - 2rem)",
      }}
    >
      {children}
      <div onPointerDown={startDrag("e")} className={`${handle} right-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-accent/30`} />
      <div onPointerDown={startDrag("w")} className={`${handle} left-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-accent/30`} />
      <div onPointerDown={startDrag("s")} className={`${handle} bottom-0 left-4 right-4 h-1.5 cursor-ns-resize hover:bg-accent/30`} />
      <div onPointerDown={startDrag("sw")} className={`${handle} bottom-0 left-0 h-4 w-4 cursor-nesw-resize`} />
      <div
        onPointerDown={startDrag("se")}
        onDoubleClick={() => setSize({ w: null, h: null })}
        title="Drag to resize · double-click to reset"
        className={`${handle} bottom-0 right-0 flex h-4 w-4 cursor-nwse-resize items-end justify-end p-0.5 text-muted-foreground`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
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
  // Code this edit gets when it is issued (KIT_05-A, KIT_05-B …). Shown
  // pre-filled from the server; typing over it makes it a custom code.
  // A saved edit that already carries a custom code keeps it.
  const [issueCode, setIssueCode] = useState(isDraft ? issue.issueCode || "" : "");
  const [codeCustom, setCodeCustom] = useState(isDraft && !!issue.issueCode);
  const [codeRefresh, setCodeRefresh] = useState(0);
  // What this edit is for — asked when a NEW edit is opened:
  //   "partial" -> issue only a few parts (every "Qty issuing" starts at 0)
  //   "full"    -> re-issue the complete kit
  // A saved edit being resumed keeps what it was saved with (older saved
  // edits, which had no mode, behave as "full").
  const [editMode, setEditMode] = useState(isDraft ? issue.editMode || "full" : null);
  // A saved edit resumes with the quantities it was saved with; a new edit
  // starts empty and is filled in once the mode is chosen (see chooseMode).
  const [issueQtyOverrides, setIssueQtyOverrides] = useState(() => {
    const init = {};
    if (isDraft) {
      (issue.lines || []).forEach((l) => {
        init[l.ttUniquePartNumber] = String(l.qtyIssued);
      });
    }
    return init;
  });
  // Parts ticked "Mark completed" — closed even though the required qty is not
  // met (e.g. discontinued midway). Saved with the edit; every later kit then
  // shows the part as completed. A saved edit resumes with what it had.
  const [manualComplete, setManualComplete] = useState(() => {
    const init = {};
    if (isDraft) {
      (issue.lines || []).forEach((l) => {
        if (l.manuallyCompleted) init[l.ttUniquePartNumber] = true;
      });
    }
    return init;
  });
  // Why each part was closed — compulsory for every ticked part.
  const [completeRemarks, setCompleteRemarks] = useState(() => {
    const init = {};
    if (isDraft) {
      (issue.lines || []).forEach((l) => {
        if (l.manuallyCompleted) init[l.ttUniquePartNumber] = l.manuallyCompletedReason || "";
      });
    }
    return init;
  });
  // Parts added on this edit that weren't part of the original issue.
  const [extraLines, setExtraLines] = useState([]);
  const [addingPart, setAddingPart] = useState(false);

  // Per-part totals already issued across EVERY earlier version of this
  // kit's edit chain (Kit 1 + Kit 1A + ... ), not just the entry this
  // dialog was opened from — see getKitIssueChainTotals. Falls back to
  // the immediate entry's own qty (the old behaviour) until this loads,
  // and stays on that fallback if the fetch fails.
  // Shape: { chain, kit } — `kit` = everything already issued of this kit
  // (every earlier issue + its edits, matched by template or kit code), shown
  // as "Prev. issued"; `chain` = this edit chain only, used to measure what a
  // PARTIAL edit is still short by.
  const [previousTotals, setPreviousTotals] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get(`/kits/issues/${issue._id}/previous-quantities`)
      .then(({ data }) => {
        if (cancelled) return;
        // Older servers answered with the flat chain map only.
        const chain = data?.chain ?? data ?? {};
        const kit = data?.kit ?? chain;
        setPreviousTotals({ chain, kit, completed: data?.completed ?? [], completedDetails: data?.completedDetails ?? {} });
      })
      .catch(() => {
        if (!cancelled) setPreviousTotals({ chain: {}, kit: {}, completed: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [issue._id]);

  useEffect(() => {
    if (codeCustom) return undefined;
    let cancelled = false;
    api
      .get(`/kits/issues/${issue._id}/next-edit-code`)
      .then(({ data }) => {
        if (!cancelled) setIssueCode(data?.issueCode || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue._id, codeRefresh]);

  const onCodeChange = (value) => {
    setIssueCode(value);
    const custom = value.trim() !== "";
    setCodeCustom(custom);
    if (!custom) setCodeRefresh((n) => n + 1); // emptied -> back to the suggestion
  };

  const qtyNum = Number(quantity) || 0;

  const preview = useMemo(
    () =>
      (issue.lines || []).map((l) => {
        const available = l.part?.quantityInStock ?? 0;
        const required = r4((l.qtyPerKit || 0) * qtyNum);
        const ok = available >= required;
        const defaultToIssue = Math.min(available, required);
        // Once loaded, a part that was never issued before is 0 (not the qty
        // saved on this very entry); until then fall back to the entry's own.
        const loaded = previousTotals !== null;
        const kitPrevious = loaded ? previousTotals.kit?.[l.ttUniquePartNumber] ?? 0 : l.qtyIssued;
        const chainPrevious = loaded ? previousTotals.chain?.[l.ttUniquePartNumber] ?? 0 : l.qtyIssued;
        return {
          ttUniquePartNumber: l.ttUniquePartNumber,
          itemDescription: l.part?.itemDescription || l.itemDescription,
          // Note / remarks on this part's row of the kit template.
          remarks: l.templateRemarks || "",
          qtyPerKit: l.qtyPerKit,
          unit: l.part?.unit || "",
          required,
          available,
          ok,
          defaultToIssue,
          // Everything already issued of this kit once loaded; the immediate
          // entry's own qty as a fallback while that's in flight.
          previouslyIssued: kitPrevious,
          chainPreviouslyIssued: chainPrevious,
        };
      }),
    [issue.lines, qtyNum, previousTotals]
  );

  const hasShortfall = preview.some((p) => !p.ok);

  const qtyToIssueFor = (p) => {
    const override = issueQtyOverrides[p.ttUniquePartNumber];
    return override === undefined || override === "" ? p.defaultToIssue : Number(override);
  };
  const setQtyToIssueFor = (code, value) =>
    setIssueQtyOverrides((prev) => ({ ...prev, [code]: value }));

  const { sort, toggle, apply } = useSort();
  const sortedPreview = apply(preview, {
    partNo: (p) => p.ttUniquePartNumber,
    description: (p) => p.itemDescription,
    qtyPerKit: (p) => Number(p.qtyPerKit),
    unit: (p) => p.unit,
    required: (p) => Number(p.required),
    previouslyIssued: (p) => Number(p.previouslyIssued ?? 0),
    available: (p) => Number(p.available),
    issuing: (p) => Number(qtyToIssueFor(p)),
    status: (p) => (p.ok ? 1 : 0),
  });

  // Picking a mode (re)sets every "Qty issuing": all zero for a few parts,
  // or back to the full-kit defaults (what stock allows) for a complete
  // re-issue. Parts added on this edit are left alone.
  const chooseMode = (mode) => {
    setEditMode(mode);
    if (mode === "partial") {
      const zeros = {};
      (issue.lines || []).forEach((l) => {
        zeros[l.ttUniquePartNumber] = "0";
      });
      setIssueQtyOverrides(zeros);
    } else {
      setIssueQtyOverrides({});
    }
  };
  const isPartial = editMode === "partial";

  // Where each part stands once THIS edit is counted: what was already issued
  // of the kit + what is being issued now, against what is required.
  //   completed  -> already complete, or this edit completes it
  //   over       -> would push the issued total ABOVE what is required
  //   short      -> still missing some
  const lineState = (p) => {
    const issuing = Number(qtyToIssueFor(p)) || 0;
    const prev = Number(p.previouslyIssued) || 0;
    const total = r4(prev + issuing);
    const required = Number(p.required) || 0;
    if (required > 0 && total > required + 1e-9) {
      return { kind: "over", issuing, prev, total, over: r4(total - required) };
    }
    if (required > 0 && total >= required - 1e-9) {
      return { kind: "completed", issuing, prev, total, already: prev >= required - 1e-9 };
    }
    // Closed by hand: ticked on this edit, or on an earlier entry of this kit.
    if (manualComplete[p.ttUniquePartNumber]) {
      return { kind: "completed", issuing, prev, total, already: false, manual: true, thisEdit: true };
    }
    if ((previousTotals?.completed || []).includes(p.ttUniquePartNumber)) {
      return { kind: "completed", issuing, prev, total, already: true, manual: true };
    }
    return { kind: "short", issuing, prev, total, short: r4(required - total) };
  };

  const lineKinds = preview.map((p) => lineState(p).kind);
  const overIssueCount = lineKinds.filter((k) => k === "over").length;
  const completedCount = lineKinds.filter((k) => k === "completed").length;

  // Parts getting a quantity > 0 in this edit (original lines + added parts).
  const partsIssuingCount =
    preview.filter((p) => qtyToIssueFor(p) > 0).length + extraLines.filter((l) => Number(l.qty) > 0).length;

  const submit = async (e) => {
    e.preventDefault();
    if (!editMode) {
      toast.error("Choose whether to re-issue the complete kit or only a few parts");
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
    if (isPartial && partsIssuingCount === 0) {
      toast.error("Enter a quantity for at least one part — or choose to re-issue the complete kit");
      return;
    }

    // A remark is compulsory for every part marked completed.
    const missingRemark = preview.find(
      (p) => manualComplete[p.ttUniquePartNumber] && !(completeRemarks[p.ttUniquePartNumber] || "").trim()
    );
    if (missingRemark) {
      toast.error(`Enter a remark for ${missingRemark.ttUniquePartNumber} — a reason is required to mark it completed`);
      return;
    }

    const linesPayload = [];
    for (const p of preview) {
      const q = qtyToIssueFor(p);
      if (!Number.isFinite(q) || q < 0) {
        toast.error(`Qty being issued for ${p.ttUniquePartNumber} must be a number of 0 or more`);
        return;
      }
      if (q > p.available) {
        toast.error(
          `Qty being issued for ${p.ttUniquePartNumber} (${q}) can't exceed available stock (${p.available})`
        );
        return;
      }
      linesPayload.push({
        ttUniquePartNumber: p.ttUniquePartNumber,
        qtyIssued: q,
        manuallyCompleted: !!manualComplete[p.ttUniquePartNumber],
        manuallyCompletedReason: manualComplete[p.ttUniquePartNumber]
          ? (completeRemarks[p.ttUniquePartNumber] || "").trim()
          : "",
      });
    }

    const extraItemsPayload = [];
    for (const l of extraLines) {
      const q = Number(l.qty);
      if (!Number.isFinite(q) || q < 0) {
        toast.error(`Qty for added part ${l.ttUniquePartNumber} must be a number of 0 or more`);
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
        editMode,
        // "" = let the server pick the next -A / -B when it is issued
        issueCode: codeCustom ? issueCode.trim() : "",
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
      <ResizablePanel defaultWidth={1024}>
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
          {!editMode && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">What do you want to issue in this edit?</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-mono-tech">{sourceLabel}</span> has already been issued. Pick one — you can
                  change it afterwards.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => chooseMode("partial")}
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <p className="text-sm font-semibold">Just a few parts</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Every quantity starts at 0. Fill in only the parts you're sending now, or add new parts.
                    Parts you leave at 0 stay as already issued — they aren't counted as short.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => chooseMode("full")}
                  className="rounded-lg border border-border p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
                >
                  <p className="text-sm font-semibold">Re-issue the complete kit</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Every part is pre-filled with the full kit quantity (as far as stock allows) and deducted
                    again from stock, on top of what was issued before.
                  </p>
                </button>
              </div>
            </div>
          )}

          <div className={editMode ? undefined : "hidden"}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{isPartial ? "Issuing just a few parts" : "Re-issuing the complete kit"}</Badge>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => chooseMode(isPartial ? "full" : "partial")}
            >
              {isPartial ? "Re-issue the complete kit instead" : "Issue just a few parts instead"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Issue to vendor
              </label>
              <VendorSearchSelect value={vendor} onSelect={setVendor} placeholder="Start typing the vendor name…" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Kit code (editable)
              </label>
              <Input
                className="font-mono-tech"
                maxLength={40}
                value={issueCode}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="Assigned when issued"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {codeCustom
                  ? "Custom code — used as typed."
                  : "Next code in this kit's series. Type to change it."}
              </p>
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
              {overIssueCount > 0 && (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {overIssueCount} part{overIssueCount === 1 ? "" : "s"} will be over-issued
                </Badge>
              )}
              {completedCount > 0 && (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {completedCount} part{completedCount === 1 ? "" : "s"} complete
                </Badge>
              )}
              {isPartial ? (
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Issuing {partsIssuingCount} part(s) only — everything else stays as already issued
                </Badge>
              ) : hasShortfall ? (
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

            <div className="rounded-lg border border-border">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[12%]" />
                  <col className="w-[19%]" />
                  <col className="w-[8%]" />
                  <col className="w-[6%]" />
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="bg-secondary [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-secondary [&_th]:shadow-[0_1px_0_rgba(0,0,0,0.18)]">
                  <tr className="border-b border-border">
                    <SortableHead label="TT part #" sortKey="partNo" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Description" sortKey="description" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Qty/kit" sortKey="qtyPerKit" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Unit" sortKey="unit" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Required" sortKey="required" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Prev. issued" sortKey="previouslyIssued" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Available" sortKey="available" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Qty issuing" sortKey="issuing" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                    <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-1.5 py-1.5 leading-tight h-auto" />
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                  {sortedPreview.map((p) => {
                    const st = lineState(p);
                    return (
                    <tr
                      key={p.ttUniquePartNumber}
                      className={
                        "border-b border-border " +
                        (st.kind === "completed"
                          ? "!bg-green-100 dark:!bg-green-950/40"
                          : st.kind === "over"
                            ? "!bg-amber-100 dark:!bg-amber-950/40"
                            : "")
                      }
                    >
                      <td className="break-all px-1.5 py-1.5 text-xs font-mono-tech">{p.ttUniquePartNumber}</td>
                      <td className="break-words px-1.5 py-1.5 text-xs">
                        {p.itemDescription || "—"}
                        {p.remarks && (
                          <div className="mt-0.5 whitespace-pre-wrap text-[10px] italic text-muted-foreground" title="Note on the kit template">
                            Note: {p.remarks}
                          </div>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-xs text-right font-mono-tech">{p.qtyPerKit}</td>
                      <td className="break-words px-1.5 py-1.5 text-xs text-muted-foreground">{p.unit || "—"}</td>
                      <td className="px-1.5 py-1.5 text-xs text-right font-mono-tech">{p.required}</td>
                      <td className="px-1.5 py-1.5 text-xs text-right font-mono-tech text-muted-foreground">
                        {p.previouslyIssued}
                      </td>
                      <td className="px-1.5 py-1.5 text-xs text-right font-mono-tech">{p.available}</td>
                      <td className="px-1.5 py-1.5">
                        <Input
                          type="number"
                          min="0"
                          max={p.available}
                          step="any"
                          className="h-7 w-full font-mono-tech text-xs text-right"
                          value={issueQtyOverrides[p.ttUniquePartNumber] ?? String(p.defaultToIssue)}
                          onChange={(e) => setQtyToIssueFor(p.ttUniquePartNumber, e.target.value)}
                        />
                      </td>
                      <td className="px-1.5 py-1.5">
                        {st.kind === "over" ? (
                          <Badge
                            variant="warning"
                            className="gap-1"
                            title={`${st.prev} already issued + ${st.issuing} issuing = ${st.total}, but only ${p.required} required`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            Over-issue +{st.over}
                          </Badge>
                        ) : st.kind === "completed" ? (
                          <Badge
                            variant="success"
                            className="gap-1"
                            title={
                              st.thisEdit
                                ? "Marked completed manually on this edit"
                                : st.manual
                                ? "Marked completed manually earlier — no more needed"
                                : st.already
                                ? `Already complete — ${st.prev} of ${p.required} issued earlier`
                                : `${st.prev} issued earlier + ${st.issuing} now = ${p.required} required`
                            }
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Completed
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1" title={`${st.prev} issued earlier + ${st.issuing} now of ${p.required} required`}>
                            <XCircle className="h-3 w-3" />
                            Short {st.short}
                          </Badge>
                        )}
                        {/* Close the part out by hand, even if the required qty is not met. */}
                        {!(st.manual && !st.thisEdit) && st.kind !== "over" && !(st.kind === "completed" && !st.manual) && (
                          <label
                            className="mt-1 flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
                            title="Mark this part completed even though the required quantity was not met (e.g. discontinued). Later kits will show it as completed."
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={!!manualComplete[p.ttUniquePartNumber]}
                              onChange={(e) =>
                                setManualComplete((prev) => ({ ...prev, [p.ttUniquePartNumber]: e.target.checked }))
                              }
                            />
                            Mark completed
                          </label>
                        )}
                        {manualComplete[p.ttUniquePartNumber] && !(st.manual && !st.thisEdit) && (
                          <Input
                            className="mt-1 h-7 px-1.5 text-[11px]"
                            placeholder="Remark (required) — why?"
                            maxLength={300}
                            required
                            value={completeRemarks[p.ttUniquePartNumber] || ""}
                            onChange={(e) =>
                              setCompleteRemarks((prev) => ({ ...prev, [p.ttUniquePartNumber]: e.target.value }))
                            }
                          />
                        )}
                        {st.manual && !st.thisEdit && (
                          <div className="mt-1 whitespace-pre-wrap text-[10px] italic text-muted-foreground">
                            {(() => {
                              const d = previousTotals?.completedDetails?.[p.ttUniquePartNumber];
                              if (!d) return "Marked completed earlier";
                              return `Marked completed${d.issueCode ? ` in ${d.issueCode}` : ""}${d.by ? ` by ${d.by}` : ""}${
                                d.reason ? `: ${d.reason}` : ""
                              }`;
                            })()}
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
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
                            unit: p.unit || "",
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
                            {l.available}{l.unit ? ` ${l.unit}` : ""} in stock
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max={l.available}
                              step="any"
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
          </div>
        </form>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-kit-issue-form" disabled={submitting || !editMode}>
            <Save className="mr-1.5 h-4 w-4" />
            {submitting ? "Saving…" : isDraft ? "Save changes" : "Save edited kit"}
          </Button>
        </div>
      </ResizablePanel>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Read-only look at one kit issue — its snapshot lines, exactly as
 * recorded at issue time. Opened by clicking a row in the Issued kits
 * tab below.
 * ------------------------------------------------------------------ */
// True when the part is complete as of this entry: earlier issued + issued here
// reaches the required quantity. A part finished in kit 12 therefore stays
// "Completed" in every later entry of the kit (12-A, 12-B ...).
// How far the part's issued total is ABOVE what the kit requires, counting
// everything issued by earlier entries plus this entry:
//   (earlier issued + issued here) - required
// It does NOT matter whether this entry issued anything: a part that earlier
// entries already over-issued stays flagged. When the same part sits on more
// than one line of the entry, the lines are added together first.
export function lineOverIssue(l, allLines) {
  const same = (allLines && allLines.length
    ? allLines.filter((x) => x.ttUniquePartNumber === l.ttUniquePartNumber)
    : [l]);
  const prev = Number(l.qtyPreviouslyIssued || 0);
  const issued = same.reduce((n, x) => n + Number(x.qtyIssued || 0), 0);
  const required = same.reduce((n, x) => n + Number(x.qtyRequired || 0), 0);
  const over = Math.round((prev + issued - required) * 1e4) / 1e4;
  return required > 0 && over > 1e-9 ? over : 0;
}

// A part closed by hand (manually completed on this entry, or on an earlier
// entry of the same kit) counts as completed even when the quantity falls short.
export function lineManuallyCompleted(l) {
  return !!(l && (l.manuallyCompleted || l.manuallyCompletedEarlier));
}

export function lineCompletedHere(l) {
  if (lineManuallyCompleted(l)) return true;
  const prev = Number(l.qtyPreviouslyIssued || 0);
  const issued = Number(l.qtyIssued || 0);
  const required = Number(l.qtyRequired || 0);
  return required > 0 && prev + issued >= required - 1e-6;
}

function KitIssuePreviewDialog({ issue, onClose, onEdit, onRevert, onRevertAll }) {
  const lines = issue.lines || [];
  const { sort, toggle, apply } = useSort();
  const sortedLines = apply(lines, {
    partNo: (l) => l.ttUniquePartNumber,
    description: (l) => l.part?.itemDescription || l.itemDescription,
    qtyPerKit: (l) => Number(l.qtyPerKit),
    unit: (l) => l.part?.unit,
    required: (l) => Number(l.qtyRequired),
    prevIssued: (l) => Number(l.qtyPreviouslyIssued || 0),
    issued: (l) => Number(l.qtyIssued),
    batches: (l) => formatBatchBreakdown(l.batchBreakdown),
    short: (l) => Number(l.qtyShort || 0),
  });
  const [downloading, setDownloading] = useState(false);

  // This issued kit — who it went to, who issued it, every material — as Excel.
  const downloadContents = async () => {
    setDownloading(true);
    await downloadXlsx(`/kits/issues/${issue._id}/export`, issueXlsxName(issue));
    setDownloading(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <ResizablePanel defaultWidth={896}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-accent" />
              {issue.kitName}
              {issue.revertedAt && (
                <Badge variant="destructive" className="gap-1">
                  <RotateCcw className="h-3 w-3" />
                  Reverted
                </Badge>
              )}
              {issue.hasShortage && lines.some((l) => (l.qtyShort || 0) > 0 && !lineManuallyCompleted(l)) && (
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

          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-secondary [&_th]:shadow-[0_1px_0_rgba(0,0,0,0.18)]">
                <tr className="border-b border-border">
                  <SortableHead label="TT part #" sortKey="partNo" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Description" sortKey="description" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Qty/kit" sortKey="qtyPerKit" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Unit" sortKey="unit" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Required" sortKey="required" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Prev. issued" sortKey="prevIssued" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Issued" sortKey="issued" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Batches" sortKey="batches" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                  <SortableHead label="Short" sortKey="short" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                      This issue has no lines.
                    </td>
                  </tr>
                )}
                {sortedLines.map((l) => {
                  // Part is complete as of this entry (prev. issued + issued >= required),
                  // including when it was already completed by an earlier kit.
                  const completedHere = lineCompletedHere(l);
                  // Issued more than required once earlier issues are counted.
                  const overBy = lineOverIssue(l, lines);
                  return (
                  <tr
                    key={l._id}
                    className={
                      "border-b border-border " +
                      (overBy > 0
                        ? "!bg-amber-100 dark:!bg-amber-950/40"
                        : completedHere
                          ? "!bg-green-100 dark:!bg-green-950/40"
                          : "")
                    }
                  >
                    <td className="px-2.5 py-1.5 text-xs font-mono-tech">{l.ttUniquePartNumber}</td>
                    <td className="px-2.5 py-1.5 text-xs">
                      {l.part?.itemDescription || l.itemDescription || "—"}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{l.qtyPerKit}</td>
                    <td className="px-2.5 py-1.5 text-xs">{l.part?.unit || "—"}</td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">{l.qtyRequired}</td>
                    <td
                      className="px-2.5 py-1.5 text-xs text-right font-mono-tech text-muted-foreground"
                      title="Already issued of this part by earlier issues of this kit (same kit code), before this entry"
                    >
                      {l.qtyPreviouslyIssued ?? 0}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                      {l.qtyIssued}
                      {Number(l.qtyReverted) > 0 && (
                        <div
                          className="text-[10px] text-muted-foreground"
                          title={(l.reverts || [])
                            .map((r) => `${r.quantity} on ${fmtDateTime(r.at)}${r.by ? ` by ${r.by}` : ""}${r.reason ? ` — ${r.reason}` : ""}`)
                            .join("\n")}
                        >
                          {l.qtyReverted} reverted
                        </div>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                      {formatBatchBreakdown(l.batchBreakdown)}
                    </td>
                    <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                      {lineManuallyCompleted(l) && !(overBy > 0) ? (
                        <span
                          className="font-semibold text-green-700 dark:text-green-400"
                          title={
                            l.manuallyCompleted
                              ? `Marked completed manually${l.manuallyCompletedBy ? ` by ${l.manuallyCompletedBy}` : ""}${
                                  l.manuallyCompletedAt ? ` on ${fmtDateTime(l.manuallyCompletedAt)}` : ""
                                }${l.manuallyCompletedReason ? ` — ${l.manuallyCompletedReason}` : ""}`
                              : "Marked completed manually on an earlier entry of this kit"
                          }
                        >
                          Completed (manual)
                          {l.qtyShort > 0 && l.manuallyCompleted && (
                            <div className="text-[10px] font-normal text-muted-foreground">{l.qtyShort} short, closed</div>
                          )}
                        </span>
                      ) : l.qtyShort > 0 ? (
                        <span className="text-destructive">{l.qtyShort}</span>
                      ) : overBy > 0 ? (
                        <span
                          className="font-semibold text-amber-700 dark:text-amber-400"
                          title={`${l.qtyPreviouslyIssued || 0} issued earlier + ${l.qtyIssued || 0} issued here, but the kit only requires ${l.qtyRequired}${
                            lines.filter((x) => x.ttUniquePartNumber === l.ttUniquePartNumber).length > 1
                              ? " on this line (this part is on several lines — totals are combined)"
                              : ""
                          }`}
                        >
                          Over-issue +{overBy}
                        </span>
                      ) : completedHere ? (
                        <span
                          className="font-semibold text-green-700 dark:text-green-400"
                          title={`${l.qtyPreviouslyIssued || 0} previously issued + ${l.qtyIssued || 0} issued here ≥ ${l.qtyRequired} required`}
                        >
                          Completed
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                  );
                })}
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
          {onRevertAll && (
            <Button
              type="button"
              variant="outline"
              onClick={onRevertAll}
              disabled={!!issue.revertedAt || !lines.some((l) => Number(l.qtyIssued) > 0)}
              title="Put every part back into main stock and mark the kit Reverted"
            >
              <RotateCcw className="mr-1.5 h-4 w-4 text-destructive" />
              Revert entire kit
            </Button>
          )}
          {onRevert && (
            <Button type="button" variant="outline" onClick={onRevert} disabled={!lines.some((l) => Number(l.qtyIssued) > 0)}>
              <Undo2 className="mr-1.5 h-4 w-4 text-destructive" />
              Revert stock
            </Button>
          )}
          {onEdit && (
            <Button type="button" onClick={onEdit}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Edit — saves to Saved kits
            </Button>
          )}
        </div>
      </ResizablePanel>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Revert stock from an ISSUED kit: tick the parts to take back (or "all"),
 * adjust the quantity per part if only some should come back, and they are
 * added straight back into main stock. Replaces the old one-line-at-a-time
 * prompt.
 * ------------------------------------------------------------------ */
function RevertStockDialog({ issue, onClose, onDone }) {
  const [caps, setCaps] = useState(null); // lineId -> { maxRevert, alreadyReturned }
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState({}); // lineId -> quantity string ("" = not picked)
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/kits/issues/${issue._id}/revertable`);
        if (!alive) return;
        setCaps(Object.fromEntries((data.lines || []).map((l) => [String(l.lineId), l])));
      } catch (err) {
        if (alive) toast.error(err.response?.data?.message || "Could not check what can be reverted");
        // Fall back to the issued quantities; the server still enforces the real limit.
        if (alive) {
          setCaps(
            Object.fromEntries(
              (issue.lines || []).map((l) => [String(l._id), { lineId: l._id, maxRevert: Number(l.qtyIssued) || 0, alreadyReturned: 0 }])
            )
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [issue]);

  const lines = issue.lines || [];
  const maxOf = (l) => Number(caps?.[String(l._id)]?.maxRevert ?? l.qtyIssued ?? 0);
  const selectable = lines.filter((l) => maxOf(l) > 0);
  const term = filter.trim().toLowerCase();
  const shown = term
    ? lines.filter((l) =>
        `${l.ttUniquePartNumber} ${l.part?.itemDescription || l.itemDescription || ""}`.toLowerCase().includes(term)
      )
    : lines;

  const isPicked = (l) => picked[String(l._id)] !== undefined;
  const pickedLines = selectable.filter(isPicked);
  const allPicked = selectable.length > 0 && pickedLines.length === selectable.length;

  const toggleOne = (l) =>
    setPicked((cur) => {
      const next = { ...cur };
      const id = String(l._id);
      if (next[id] !== undefined) delete next[id];
      else next[id] = String(maxOf(l));
      return next;
    });

  const toggleAll = () =>
    setPicked(allPicked ? {} : Object.fromEntries(selectable.map((l) => [String(l._id), String(maxOf(l))])));

  const setQty = (l, v) => setPicked((cur) => ({ ...cur, [String(l._id)]: v }));

  // Validate every ticked quantity.
  const problems = pickedLines
    .map((l) => {
      const q = Number(picked[String(l._id)]);
      if (!(q > 0)) return `${l.ttUniquePartNumber}: enter a quantity above 0`;
      if (q > maxOf(l) + 1e-9) return `${l.ttUniquePartNumber}: at most ${maxOf(l)}`;
      return null;
    })
    .filter(Boolean);
  const totalUnits = pickedLines.reduce((n, l) => n + (Number(picked[String(l._id)]) || 0), 0);

  // Any change to the selection cancels a pending confirmation.
  useEffect(() => {
    setConfirming(false);
  }, [picked]);

  const submit = async () => {
    if (!pickedLines.length || problems.length) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/kits/issues/${issue._id}/revert`, {
        lines: pickedLines.map((l) => ({ lineId: l._id, quantity: Number(picked[String(l._id)]) })),
        reason,
      });
      toast.success(data?.message || "Stock reverted");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not revert the stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <ResizablePanel defaultWidth={860}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-base font-semibold">
              <Undo2 className="h-4 w-4 text-destructive" />
              Revert stock from this kit
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {issue.kitName} ·{" "}
              <span className="font-mono-tech">{issue.issueCode || "—"}</span>
              {issue.vendor?.companyName ? ` · issued to ${issue.vendor.companyName}` : ""}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Tick the parts to take back — or use <b>Select all</b>. The quantity you enter goes back
            into the main stock (and into the batch it was drawn from).
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={allPicked}
                disabled={loading || selectable.length === 0}
                onChange={toggleAll}
              />
              Select all ({selectable.length})
            </label>
            <Input
              className="h-8 w-56"
              placeholder="Find a part"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/70">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-8 px-2.5 py-1.5" />
                  <th className="px-2.5 py-1.5">TT part #</th>
                  <th className="px-2.5 py-1.5">Description</th>
                  <th className="px-2.5 py-1.5 text-right">Issued</th>
                  <th className="px-2.5 py-1.5">Batches</th>
                  <th className="px-2.5 py-1.5 text-right">Revert qty</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                      Checking what can be reverted…
                    </td>
                  </tr>
                )}
                {!loading && shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                      No parts match.
                    </td>
                  </tr>
                )}
                {!loading &&
                  shown.map((l) => {
                    const max = maxOf(l);
                    const disabled = max <= 0;
                    const on = isPicked(l);
                    const returned = Number(caps?.[String(l._id)]?.alreadyReturned || 0);
                    return (
                      <tr
                        key={l._id}
                        className={`border-b border-border last:border-0 ${on ? "bg-primary/5" : ""} ${
                          disabled ? "opacity-50" : ""
                        }`}
                      >
                        <td className="px-2.5 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={on}
                            disabled={disabled}
                            onChange={() => toggleOne(l)}
                          />
                        </td>
                        <td className="px-2.5 py-1.5 text-xs font-mono-tech">{l.ttUniquePartNumber}</td>
                        <td className="px-2.5 py-1.5 text-xs">
                          {l.part?.itemDescription || l.itemDescription || "—"}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-xs font-mono-tech">
                          {l.qtyIssued}
                          {returned > 0 && (
                            <div className="text-[10px] text-muted-foreground">{returned} returned by vendor</div>
                          )}
                          {Number(l.qtyReverted) > 0 && (
                            <div className="text-[10px] text-muted-foreground">{l.qtyReverted} reverted earlier</div>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                          {formatBatchBreakdown(l.batchBreakdown)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right">
                          {disabled ? (
                            <span className="text-[11px] text-muted-foreground">
                              {Number(l.qtyIssued) > 0 ? "all returned" : "nothing issued"}
                            </span>
                          ) : on ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                className="h-8 w-24 text-right font-mono-tech"
                                value={picked[String(l._id)]}
                                onChange={(e) => setQty(l, e.target.value)}
                              />
                              <button
                                type="button"
                                className="text-[11px] text-primary hover:underline"
                                onClick={() => setQty(l, String(max))}
                                title="Revert everything issued on this line"
                              >
                                max {max}
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">max {max}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Reason (optional)
            </label>
            <Textarea
              rows={2}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Kit not sent after all / issued to the wrong vendor"
            />
          </div>

          {confirming && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4" /> Are you sure?
              </div>
              <p className="mt-1 text-xs text-foreground">
                {pickedLines.length} part{pickedLines.length === 1 ? "" : "s"} (
                {Math.round(totalUnits * 1000) / 1000} units) will be taken off{" "}
                <b>{issue.issueCode || issue.kitName}</b> and added back to the main stock. This changes
                stock and cannot be undone from here.
              </p>
            </div>
          )}

          {problems.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {problems.slice(0, 4).map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {pickedLines.length
              ? `${pickedLines.length} part${pickedLines.length === 1 ? "" : "s"} · ${
                  Math.round(totalUnits * 1000) / 1000
                } units will go back to stock`
              : "Nothing selected"}
          </p>
          <div className="flex gap-2">
            {confirming ? (
              <>
                <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={saving}>
                  No, go back
                </Button>
                <Button type="button" variant="destructive" onClick={submit} disabled={saving}>
                  {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
                  {saving ? "Reverting…" : "Yes, revert now"}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirming(true)}
                  disabled={saving || !pickedLines.length || problems.length > 0}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  {allPicked ? "Revert all parts" : "Revert selected"}
                </Button>
              </>
            )}
          </div>
        </div>
      </ResizablePanel>
    </div>
  );
}

/* Confirmation for "Revert entire kit" — nothing happens until the user says yes. */
function RevertWholeKitDialog({ issue, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const issued = (issue.lines || []).filter((l) => Number(l.qtyIssued) > 0);
  const units = Math.round(issued.reduce((n, l) => n + Number(l.qtyIssued), 0) * 1000) / 1000;

  const confirm = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/kits/issues/${issue._id}/revert`, { all: true, reason });
      toast.success(data?.message || "Kit reverted");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not revert this kit");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold">Revert the entire kit?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <b className="text-foreground">{issue.kitName}</b>{" "}
              <span className="font-mono-tech">({issue.issueCode || "—"})</span>
              {issue.vendor?.companyName ? ` issued to ${issue.vendor.companyName}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          All <b>{issued.length}</b> part{issued.length === 1 ? "" : "s"} (<b>{units}</b> units) will be added back
          to the main stock and this kit will be marked <b>Reverted</b>. This changes stock and cannot be
          undone from here.
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reason (optional)
          </label>
          <Textarea
            rows={2}
            value={reason}
            maxLength={300}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Kit not sent after all / issued to the wrong vendor"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            No, keep it
          </Button>
          <Button type="button" variant="destructive" onClick={confirm} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
            {saving ? "Reverting…" : "Yes, revert entire kit"}
          </Button>
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
function KitsPanel({
  reloadKey,
  canManage,
  canIssue = true,
  onEdited,
  activeDraftId,
  onResume,
  onChanged,
  onCount,
}) {
  const [tab, setTab] = useState("issued");

  // ---- Issued kits state ----
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [issues, setIssues] = useState([]);
  const [busyIssueId, setBusyIssueId] = useState(null);
  const [editingIssue, setEditingIssue] = useState(null);
  const [previewingIssue, setPreviewingIssue] = useState(null);
  const [revertingIssue, setRevertingIssue] = useState(null);
  const [revertingWhole, setRevertingWhole] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // ---- Saved kits (drafts) state ----
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [busyDraftId, setBusyDraftId] = useState(null);

  const issueSort = useSort();
  const sortedIssues = issueSort.apply(issues, {
    date: (i) => (i.createdAt ? new Date(i.createdAt).getTime() : null),
    kit: (i) => i.kitName,
    code: (i) => i.issueCode,
    vendor: (i) => i.vendor?.companyName,
    qty: (i) => Number(i.quantity),
    issuedBy: (i) => i.issuedBy,
  });
  const draftSort = useSort();
  const sortedDrafts = draftSort.apply(drafts, {
    date: (d) => (d.updatedAt ? new Date(d.updatedAt).getTime() : null),
    kit: (d) => d.kitName,
    vendor: (d) => d.vendor?.companyName,
    qty: (d) => Number(d.quantity),
    savedBy: (d) => d.issuedBy,
  });

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
  // Opens the confirmation; nothing is reverted until the user confirms there.
  const revertWholeKit = (issue) => {
    if (!(issue.lines || []).some((l) => Number(l.qtyIssued) > 0)) {
      toast.error("Nothing on this kit is left to revert");
      return;
    }
    setRevertingWhole(issue);
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
                  <SortableHead label="Date" sortKey="date" sort={issueSort.sort} onSort={issueSort.toggle} className="w-[110px]" />
                  <SortableHead label="Kit" sortKey="kit" sort={issueSort.sort} onSort={issueSort.toggle} />
                  <SortableHead label="Code" sortKey="code" sort={issueSort.sort} onSort={issueSort.toggle} className="w-[170px]" />
                  <SortableHead label="Vendor" sortKey="vendor" sort={issueSort.sort} onSort={issueSort.toggle} />
                  <SortableHead label="Qty" sortKey="qty" sort={issueSort.sort} onSort={issueSort.toggle} className="w-[60px]" align="right" />
                  <SortableHead label="Issued by" sortKey="issuedBy" sort={issueSort.sort} onSort={issueSort.toggle} className="w-[130px]" />
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
                  sortedIssues.map((iss) => (
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
                          {iss.revertedAt && (
                            <Badge
                              variant="destructive"
                              className="gap-1"
                              title={`Whole kit reverted to stock on ${fmtDateTime(iss.revertedAt)}${iss.revertedBy ? ` by ${iss.revertedBy}` : ""}`}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Reverted
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
                              title={
                                iss.revertedAt
                                  ? "This kit has already been fully reverted"
                                  : "Revert entire kit — put every part back into main stock and mark the kit Reverted"
                              }
                              onClick={() => revertWholeKit(iss)}
                              disabled={
                                !!iss.revertedAt ||
                                !iss.lines?.some((l) => Number(l.qtyIssued) > 0) ||
                                busyIssueId !== null
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              title="Revert stock — pick parts (or all) to put back into main stock"
                              onClick={() => setRevertingIssue(iss)}
                              disabled={!iss.lines?.some((l) => Number(l.qtyIssued) > 0) || busyIssueId !== null}
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
              Revert stock lets you pick one, several or all parts of an issued kit and puts them back
              into the main stock. Edit never changes the entry
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
                  <SortableHead label="Last saved" sortKey="date" sort={draftSort.sort} onSort={draftSort.toggle} className="w-[110px]" />
                  <SortableHead label="Kit" sortKey="kit" sort={draftSort.sort} onSort={draftSort.toggle} />
                  <SortableHead label="Vendor" sortKey="vendor" sort={draftSort.sort} onSort={draftSort.toggle} />
                  <SortableHead label="Qty" sortKey="qty" sort={draftSort.sort} onSort={draftSort.toggle} className="w-[60px]" align="right" />
                  <SortableHead label="Saved by" sortKey="savedBy" sort={draftSort.sort} onSort={draftSort.toggle} className="w-[130px]" />
                  <TableHead className="w-[150px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingDrafts && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
                {!loadingDrafts && drafts.length === 0 && (
                  <TableEmpty colSpan={6}>
                    {canIssue
                      ? 'No saved kits — use "Save for later" above to keep progress on a kit you\'re not ready to issue yet.'
                      : 'No saved kits yet — use "Save kit" above to save one.'}
                  </TableEmpty>
                )}
                {!loadingDrafts &&
                  sortedDrafts.map((d) => (
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
                          {d.issueCode && (
                            <Badge variant="outline" className="font-mono-tech">
                              Code: {d.issueCode}
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
                          {canIssue && (
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
                          )}
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
              since nothing is deducted from stock until it's actually issued
              {canIssue ? "." : " — and only someone with the issue-kit right can issue it."}
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
          onRevertAll={
            canManage || canIssue
              ? () => {
                  const iss = previewingIssue;
                  setPreviewingIssue(null);
                  revertWholeKit(iss);
                }
              : undefined
          }
          onRevert={
            canManage || canIssue
              ? () => {
                  const iss = previewingIssue;
                  setPreviewingIssue(null);
                  setRevertingIssue(iss);
                }
              : undefined
          }
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

      {revertingWhole && (
        <RevertWholeKitDialog
          issue={revertingWhole}
          onClose={() => setRevertingWhole(null)}
          onDone={() => loadIssues()}
        />
      )}
      {revertingIssue && (
        <RevertStockDialog
          issue={revertingIssue}
          onClose={() => setRevertingIssue(null)}
          onDone={() => loadIssues()}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function IssueKit() {
  const { can } = useAuth();
  const canManage = can?.("kit.manage");
  // Save-only users (kit.save without kit.issue) can save and view kits but
  // never issue them — the backend enforces the same on the issue routes.
  const canIssue = can?.("kit.issue");
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
  // Code this kit gets when issued. Pre-filled from the chosen template's kit
  // code (KIT_05); typing over it makes it a custom code, and a custom code
  // is what gets sent. Left alone, the server assigns the code at issue time.
  const [issueCode, setIssueCode] = useState("");
  const [codeCustom, setCodeCustom] = useState(false);
  const [codeRefresh, setCodeRefresh] = useState(0);
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

  // Everything already ISSUED from the chosen template (every earlier kit and
  // its edits, all vendors). Drives the "Prev. issued" column, so while the
  // next kit is being filled in you can see how much of each part has already
  // gone out. Drafts aren't included — they haven't deducted anything.
  const [issueHistory, setIssueHistory] = useState([]);
  useEffect(() => {
    if (!templateId) {
      setIssueHistory([]);
      return undefined;
    }
    let cancelled = false;
    api
      .get(`/kits/${templateId}/issues`)
      .then(({ data }) => {
        if (!cancelled) setIssueHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setIssueHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, reloadKey]);

  // Suggested code for the chosen template (its kit code, or KIT_05-2 … when
  // that one is already taken). Not applied over a code the person typed or
  // one saved on a resumed kit.
  useEffect(() => {
    if (!templateId) {
      setIssueCode("");
      setCodeCustom(false);
      return undefined;
    }
    if (codeCustom) return undefined;
    let cancelled = false;
    api
      .get(`/kits/${templateId}/next-code`)
      .then(({ data }) => {
        if (!cancelled) setIssueCode(data?.issueCode || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, codeRefresh]);

  const chooseTemplate = (id) => {
    setCodeCustom(false);
    setIssueCode("");
    setTemplateId(id);
  };

  const onCodeChange = (value) => {
    setIssueCode(value);
    const custom = value.trim() !== "";
    setCodeCustom(custom);
    if (!custom) setCodeRefresh((n) => n + 1); // emptied -> back to the suggestion
  };

  const issuableItems = useMemo(
    () => (template?.items || []).filter((it) => !it.dnp),
    [template]
  );

  const qtyNum = Number(quantity) || 0;

  // part number -> qty already issued, over every earlier issue of this kit —
  // and the same restricted to the vendor currently chosen on the form.
  const vendorId = vendor?._id ? String(vendor._id) : "";
  const { issuedByPart, issuedToVendorByPart } = useMemo(() => {
    const all = {};
    const toVendor = {};
    for (const issue of issueHistory) {
      const issueVendorId = String(issue.vendor?._id || issue.vendor || "");
      for (const line of issue.lines || []) {
        const key = line.ttUniquePartNumber;
        if (!key) continue;
        const qty = Number(line.qtyIssued) || 0;
        all[key] = r4((all[key] || 0) + qty);
        if (vendorId && issueVendorId === vendorId) toVendor[key] = r4((toVendor[key] || 0) + qty);
      }
    }
    return { issuedByPart: all, issuedToVendorByPart: toVendor };
  }, [issueHistory, vendorId]);

  const preview = useMemo(
    () =>
      issuableItems.map((it) => {
        const required = r4((it.qtyPerKit || 0) * qtyNum);
        const available = it.matchedPart?.quantityInStock ?? 0;
        const ok = !!it.matchedPart && available >= required;
        const defaultToIssue = Math.min(available, required);
        return {
          ...it,
          required,
          available,
          ok,
          defaultToIssue,
          previouslyIssued: issuedByPart[it.ttUniquePartNumber] || 0,
          previouslyIssuedToVendor: issuedToVendorByPart[it.ttUniquePartNumber] || 0,
        };
      }),
    [issuableItems, qtyNum, issuedByPart, issuedToVendorByPart]
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

  const { sort, toggle, apply } = useSort();
  const sortedPreview = apply(preview, {
    partNo: (p) => p.ttUniquePartNumber,
    description: (p) => p.matchedPart?.itemDescription,
    qtyPerKit: (p) => Number(p.qtyPerKit),
    unit: (p) => p.matchedPart?.unit,
    required: (p) => Number(p.required),
    previouslyIssued: (p) => Number(p.previouslyIssued ?? 0),
    available: (p) => Number(p.available),
    issuing: (p) => Number(qtyToIssueFor(p)),
    batches: (p) => formatBatchBreakdown(previewBatchBreakdown(p.batches, qtyToIssueFor(p))),
    status: (p) => (p.ok ? 1 : 0),
  });

  const resetAfterIssue = () => {
    setQuantity("1");
    setVendor(null);
    setRemarks("");
    setTemplateId("");
    setTemplate(null);
    setIssueQtyOverrides({});
    setDraftId(null);
    setIssueCode("");
    setCodeCustom(false);
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
    // A code saved on the kit stays; otherwise show the suggestion again.
    setIssueCode(draft.issueCode || "");
    setCodeCustom(!!draft.issueCode);
    if (!draft.issueCode) setCodeRefresh((n) => n + 1);
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
      if (!Number.isFinite(q) || q < 0) {
        toast.error(`Qty for ${p.ttUniquePartNumber} must be a number of 0 or more`);
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
        issueCode: codeCustom ? issueCode.trim() : "",
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
    if (!canIssue) {
      toast.error("You can save kits but not issue them — ask someone with the issue-kit right");
      return;
    }
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
      if (!Number.isFinite(q) || q < 0) {
        toast.error(`Qty being issued for ${p.ttUniquePartNumber} must be a number of 0 or more`);
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
            issueCode: codeCustom ? issueCode.trim() : "",
          })
        : await api.post(`/kits/${template._id}/issue`, {
            quantity: qtyNum,
            vendor: vendor._id,
            remarks,
            lines: linesPayload,
            issueCode: codeCustom ? issueCode.trim() : "",
          });
      const shortLines = (data.lines || []).filter((l) => (l.qtyShort || 0) > 0);
      if (shortLines.length > 0) {
        toast.error(
          `Issued ${qtyNum} × "${template.kitName}" — ${shortLines.length} part(s) were short and only partially deducted`,
          { duration: 6000 }
        );
      } else {
        toast.success(
          `Issued ${qtyNum} × "${template.kitName}" as ${data.issueCode || "—"} to ${data.vendor?.companyName || "the vendor"}`
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
        {canIssue
          ? 'Pick a kit template, enter the quantity, and it\'s checked against live stock before anything is deducted. Issuing can take a while — use "Save for later" to keep your progress and come back to it, then issue it once everything\'s ready.'
          : "Pick a kit template, enter the quantity and save it. You can save and view kits here; issuing a kit to a vendor needs the issue-kit right, so someone with that right will issue your saved kit."}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display flex items-center gap-2">
            {canIssue ? "Issue a kit" : "Save a kit"}
            {draftId && (
              <Badge variant="warning" className="gap-1">
                <FolderClock className="h-3 w-3" />
                Continuing a saved kit
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {canIssue
              ? "A short kit is still issued — whatever stock is available gets deducted, and any shortfall is logged against the kit's issue history for follow-up. Not ready yet? Save it — nothing is deducted from stock until you actually issue it."
              : "Saving a kit never deducts anything from stock."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kit template
                </label>
                <Select value={templateId} onValueChange={chooseTemplate}>
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
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kit code (editable)
                </label>
                <Input
                  className="font-mono-tech"
                  maxLength={40}
                  value={issueCode}
                  onChange={(e) => onCodeChange(e.target.value)}
                  placeholder={templateId ? "Loading…" : "Choose a kit first"}
                  disabled={!templateId}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {!templateId
                    ? "Taken from the kit's own code."
                    : codeCustom
                    ? "Custom code — used as typed."
                    : issueCode
                    ? `From the kit's code. Edits become ${issueCode}-A, ${issueCode}-B …`
                    : "From the kit's code."}
                </p>
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
                  {issueHistory.length > 0 && (
                    <span className="text-muted-foreground">
                      · “Prev. issued” counts {issueHistory.length} earlier issue
                      {issueHistory.length === 1 ? "" : "s"} of this kit
                    </span>
                  )}
                </div>

                <div className="max-h-[65vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-secondary [&_th]:shadow-[0_1px_0_rgba(0,0,0,0.18)]">
                      <tr className="border-b border-border">
                        <SortableHead label="TT part #" sortKey="partNo" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Description" sortKey="description" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Qty/kit" sortKey="qtyPerKit" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Unit" sortKey="unit" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Required" sortKey="required" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Prev. issued" sortKey="previouslyIssued" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Available" sortKey="available" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Qty issuing" sortKey="issuing" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Batches" sortKey="batches" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                        <SortableHead label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-2.5 py-1.5 h-auto whitespace-nowrap" />
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                      {sortedPreview.map((p) => {
                        // Earlier issues of this kit + what is being issued now, against what is required.
                        const issuingNow = Number(qtyToIssueFor(p)) || 0;
                        const overBy = r4((Number(p.previouslyIssued) || 0) + issuingNow - (Number(p.required) || 0));
                        const isOver = p.required > 0 && overBy > 1e-9;
                        return (
                        <tr
                          key={p._id}
                          className={"border-b border-border " + (isOver ? "!bg-amber-100 dark:!bg-amber-950/40" : "")}
                        >
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
                          <td className="px-2.5 py-1.5 text-xs">{p.matchedPart?.unit || "—"}</td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.required}
                          </td>
                          <td
                            className="px-2.5 py-1.5 text-xs text-right font-mono-tech"
                            title="Total of this part already issued across every earlier issue of this kit"
                          >
                            {p.previouslyIssued}
                            {vendor && p.previouslyIssuedToVendor > 0 && (
                              <div className="text-[10px] font-sans text-muted-foreground">
                                {p.previouslyIssuedToVendor} to {vendor.companyName || "this vendor"}
                              </div>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.available}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max={p.available}
                              step="any"
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
                            {isOver ? (
                              <Badge
                                variant="warning"
                                className="gap-1"
                                title={`${p.previouslyIssued} already issued + ${issuingNow} issuing = ${r4(
                                  (Number(p.previouslyIssued) || 0) + issuingNow
                                )}, but only ${p.required} required`}
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Over-issue +{overBy}
                              </Badge>
                            ) : p.ok ? (
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
                        );
                      })}
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
                {savingDraft
                  ? "Saving…"
                  : draftId
                    ? "Update saved kit"
                    : canIssue
                      ? "Save for later"
                      : "Save kit"}
              </Button>
              {canIssue && (
                <Button type="submit" disabled={submitting || savingDraft || !template}>
                  <Send className="mr-1.5 h-4 w-4" />
                  {submitting ? "Issuing…" : "Issue kit"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <KitsPanel
        reloadKey={reloadKey}
        canManage={canManage}
        canIssue={canIssue}
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
          {canIssueRnd ? "Issue kit & R&D stock" : canIssue ? "Issue kit" : "Saved kits"}
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