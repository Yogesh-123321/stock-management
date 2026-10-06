import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import SearchableSelect from "@/components/ui/SearchableSelect";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CheckCircle2, XCircle, ClipboardList } from "lucide-react";
import IqcReferenceViewer from "@/components/IqcReferenceViewer";
import AlternatePartPicker from "@/components/AlternatePartPicker";

// One line's IQC checklist. Nothing is submitted until every point is
// checked. The inspector then enters how much of the received quantity they
// approve; whatever is left is rejected (moved to rejected stock) and must
// come with a reason.
const round3 = (n) => Math.round(n * 1000) / 1000;

export default function IqcReportForm({ entry, templates, onDone, onCancel }) {
  const { user } = useAuth();
  const [templateId, setTemplateId] = useState("");
  const [items, setItems] = useState([]);
  // The inspector can correct the stock entry itself (part, received
  // quantity, unit, rate, remarks) while doing the IQC. Whatever is left
  // here when the report is submitted becomes the final stock entry.
  const [part, setPart] = useState(entry?.part || null);
  const [recvQty, setRecvQty] = useState(String(entry?.quantityReceived ?? ""));
  const [unit, setUnit] = useState(entry?.unit || "");
  const [price, setPrice] = useState(entry?.price != null ? String(entry.price) : "");
  const [remarks, setRemarks] = useState(entry?.remarks || "");
  const recvNum = recvQty === "" ? NaN : Number(recvQty);
  const recvValid = Number.isFinite(recvNum) && recvNum > 0;
  const total = recvValid ? recvNum : 0;
  const [approvedQty, setApprovedQty] = useState(String(entry?.quantityReceived ?? ""));
  const prevTotalRef = useRef(Number(entry?.quantityReceived) || 0);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-select a template whose material name matches this part's own
  // description, when there's an obvious one — the operator can still
  // change it.
  useEffect(() => {
    if (!templates?.length) return;
    const desc = String(entry?.part?.itemDescription || "").toLowerCase().trim();
    const guess = desc ? templates.find((t) => t.materialName.toLowerCase().trim() === desc) : null;
    setTemplateId((guess || templates[0])._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, entry?._id]);

  const selectedTemplate = templates?.find((t) => t._id === templateId) || null;

  const templateOptions = useMemo(
    () =>
      (templates || []).map((t) => ({
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

  // A fresh line starts with everything approved, no reason, and the entry's
  // own details loaded for correction.
  useEffect(() => {
    setApprovedQty(String(entry?.quantityReceived ?? ""));
    setReason("");
    setPart(entry?.part || null);
    setRecvQty(String(entry?.quantityReceived ?? ""));
    setUnit(entry?.unit || "");
    setPrice(entry?.price != null ? String(entry.price) : "");
    setRemarks(entry?.remarks || "");
    prevTotalRef.current = Number(entry?.quantityReceived) || 0;
  }, [entry?._id, entry?.quantityReceived]);

  // Correcting the received quantity carries the approved quantity along
  // when it was still "approve everything", and never lets it exceed it.
  useEffect(() => {
    if (!recvValid) return;
    const prev = prevTotalRef.current;
    if (recvNum !== prev) {
      setApprovedQty((cur) => {
        const n = cur === "" ? NaN : Number(cur);
        return Number.isFinite(n) && n === prev ? String(recvNum) : n > recvNum ? String(recvNum) : cur;
      });
      prevTotalRef.current = recvNum;
    }
  }, [recvNum, recvValid]);

  // Only what actually differs from the entry is sent.
  const buildCorrections = () => {
    const c = {};
    const origPartId = entry?.part?._id || entry?.part || null;
    if (part?._id && String(part._id) !== String(origPartId)) c.partId = part._id;
    if (recvValid && round3(recvNum) !== round3(Number(entry?.quantityReceived) || 0)) c.quantityReceived = recvNum;
    if (unit.trim() !== (entry?.unit || "")) c.unit = unit.trim();
    const origPrice = entry?.price != null ? String(entry.price) : "";
    if (price.trim() !== origPrice) c.price = price.trim() === "" ? null : Number(price);
    if (remarks.trim() !== (entry?.remarks || "")) c.remarks = remarks.trim();
    return Object.keys(c).length > 0 ? c : null;
  };
  const priceValid = price.trim() === "" || (Number.isFinite(Number(price)) && Number(price) >= 0);

  const allChecked = items.length > 0 && items.every((it) => it.checked);

  const approvedNum = approvedQty === "" ? NaN : Number(approvedQty);
  const qtyValid = Number.isFinite(approvedNum) && approvedNum >= 0 && approvedNum <= total;
  const rejectedNum = qtyValid ? round3(total - approvedNum) : 0;
  const needsReason = qtyValid && rejectedNum > 0;
  const canSubmit = allChecked && recvValid && priceValid && qtyValid && (!needsReason || reason.trim().length > 0);

  const toggleItem = (idx) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)));
  };

  const handleSubmit = async () => {
    if (!allChecked) {
      toast.error("Check every point on the IQC report first");
      return;
    }
    if (!recvValid) {
      toast.error("Received quantity must be greater than 0");
      return;
    }
    if (!priceValid) {
      toast.error("Rate must be a number, 0 or more");
      return;
    }
    if (!qtyValid) {
      toast.error(`Approved quantity must be between 0 and ${total}`);
      return;
    }
    if (needsReason && !reason.trim()) {
      toast.error("Give a reason for rejecting the quantity that isn't approved");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/stock-entries/${entry._id}/iqc-report`, {
        templateId: templateId || undefined,
        items,
        acceptedQuantity: approvedNum,
        rejectionReason: needsReason ? reason.trim() : "",
        corrections: buildCorrections() || undefined,
      });
      const label = data?.part?.ttUniquePartNumber || part?.ttUniquePartNumber || entry.part?.ttUniquePartNumber || "Line";
      toast.success(
        rejectedNum === 0
          ? `${label} accepted — ${approvedNum} added to main stock`
          : approvedNum === 0
          ? `${label} rejected — ${total} moved to rejected stock`
          : `${label}: ${approvedNum} accepted, ${rejectedNum} moved to rejected stock`
      );
      onDone?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not submit the IQC report");
    } finally {
      setSubmitting(false);
    }
  };

  if (!templates || templates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        No IQC templates have been set up yet — ask an admin to add one under “IQC templates”. This line will stay
        in IQC stock until a report can be filled.
        {onCancel && (
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Close
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ClipboardList className="h-4 w-4" />
        IQC report
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

      {/* Comparison window: the checklist next to the template's reference
          image/PDF (when one was attached), so the inspector can look at
          the approved-sample photo/drawing while deciding to accept or
          reject what was actually received. */}
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
                      id={`iqc-${entry._id}-${idx}`}
                    />
                    <label htmlFor={`iqc-${entry._id}-${idx}`} className="text-sm leading-tight">
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

      <div className="space-y-2 rounded border border-border bg-card p-2.5">
        <Label className="text-xs">Stock entry details</Label>
        <p className="text-xs text-muted-foreground">
          Correct anything that was entered wrongly at stock entry. The final stock entry follows what is
          saved here, and the original values are kept in the IQC record.
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Part (search to change)</Label>
          <AlternatePartPicker value={part} onChange={setPart} placeholder="Search part number or description" />
          {!part && (
            <p className="text-xs text-muted-foreground">
              Nothing picked — the current part ({entry?.part?.ttUniquePartNumber || "—"}) is kept.
            </p>
          )}
          {part?.manufacturerPartNumber && (
            <p className="text-xs text-muted-foreground">
              Mfr. part no. <span className="font-mono text-foreground">{part.manufacturerPartNumber}</span>
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`iqc-recv-${entry._id}`} className="text-xs text-muted-foreground">
              Quantity received
            </Label>
            <Input
              id={`iqc-recv-${entry._id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="mt-1"
              value={recvQty}
              onChange={(e) => setRecvQty(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`iqc-unit-${entry._id}`} className="text-xs text-muted-foreground">
              Unit
            </Label>
            <Input
              id={`iqc-unit-${entry._id}`}
              maxLength={20}
              placeholder="PCS, KG, MTR…"
              className="mt-1"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`iqc-price-${entry._id}`} className="text-xs text-muted-foreground">
              Rate (per unit)
            </Label>
            <Input
              id={`iqc-price-${entry._id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              className="mt-1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
        </div>
        {!recvValid && <p className="text-xs text-destructive">Enter a received quantity greater than 0.</p>}
        {!priceValid && <p className="text-xs text-destructive">Rate must be a number, 0 or more.</p>}
        <div>
          <Label htmlFor={`iqc-remarks-${entry._id}`} className="text-xs text-muted-foreground">
            Remarks
          </Label>
          <Input
            id={`iqc-remarks-${entry._id}`}
            className="mt-1"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Quantity</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="mt-1 font-mono-tech text-sm">{total}</p>
          </div>
          <div>
            <Label htmlFor={`iqc-approved-${entry._id}`} className="text-xs text-muted-foreground">
              Quantity approved
            </Label>
            <Input
              id={`iqc-approved-${entry._id}`}
              type="number"
              inputMode="decimal"
              min="0"
              max={total}
              step="any"
              className="mt-1"
              value={approvedQty}
              onChange={(e) => setApprovedQty(e.target.value)}
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Rejected (rest)</p>
            <p
              className={`mt-1 flex items-center gap-1 font-mono-tech text-sm ${
                needsReason ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {needsReason ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {qtyValid ? rejectedNum : "—"}
            </p>
          </div>
        </div>

        {!qtyValid && (
          <p className="text-xs text-destructive">Enter a quantity between 0 and {total}.</p>
        )}

        {needsReason && (
          <div className="space-y-1.5">
            <Label htmlFor={`iqc-reason-${entry._id}`} className="text-xs">
              Reason for rejecting {rejectedNum} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id={`iqc-reason-${entry._id}`}
              rows={2}
              placeholder="e.g. damaged in transit, out of specification, wrong part supplied"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The {rejectedNum} rejected will be shown under Rejected stock with this reason.
            </p>
          </div>
        )}
      </div>

      {user?.name && (
        <p className="text-xs text-muted-foreground">
          This inspection will be recorded under <span className="font-medium text-foreground">{user.name}</span>.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" onClick={handleSubmit} disabled={submitting || !canSubmit}>
          {submitting ? "Submitting…" : "Submit IQC report"}
        </Button>
      </div>
    </div>
  );
}