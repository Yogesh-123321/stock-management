import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import api from "@/lib/api";
import { fetchReceivedTotal } from "@/lib/receivedTotal";
import { useAutoExtractOnUpload } from "@/lib/useAutoExtractOnUpload";
import { findMismatches } from "@/lib/documentVerify";
import DocumentMismatchWarning from "@/components/DocumentMismatchWarning";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";
import {
  UploadCloud,
  SkipForward,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";

const TAX_INVOICE_SCHEMA = {
  invoiceNumber: { required: true, regex: "docNumber" },
  invoiceQuantity: { regex: "decimal2", message: "Numbers only, up to 2 decimal places" },
};

// AI-read fields off the uploaded tax invoice, checked against what's
// typed into this step (and the vendor already selected).
const TAX_INVOICE_DOC_MAPPING = [
  { extractedKey: "vendorName", enteredKey: "vendorName", label: "Vendor name", type: "text" },
  { extractedKey: "invoiceNumber", enteredKey: "invoiceNumber", label: "Invoice number", type: "text" },
  { extractedKey: "invoiceDate", enteredKey: "invoiceDate", label: "Invoice date", type: "text" },
  { extractedKey: "totalQuantity", enteredKey: "invoiceQuantity", label: "Total quantity", type: "number" },
];

// purchaseOrder here is whichever PO/PI document anchors this delivery (the
// "primary" one — PO if uploaded, otherwise the PI).
export default function TaxInvoiceStep({
  vendor,
  purchaseOrder,
  deliveryDocs = [],
  expectedQuantities = {},
  enteredQuantity = 0,
  // The "Receive material" session this delivery belongs to — used to pull
  // back the exact lines logged in Step 4 so they can still be corrected
  // (quantity fixed, or a line removed entirely) right up until the tax
  // invoice is uploaded.
  sessionId = null,
  onUploaded,
  onSkip,
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceQuantity, setInvoiceQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const v = useFormValidation(TAX_INVOICE_SCHEMA);

  // Auto-fetch details off the file the moment it's picked, and fill in
  // whatever's still blank; any field the person already typed that
  // disagrees is surfaced as a warning below (see TAX_INVOICE_DOC_MAPPING).
  const { status: aiStatus, fields: aiFields } = useAutoExtractOnUpload(file, { documentType: "taxInvoice" });
  const aiAppliedFileRef = useRef(null);

  useEffect(() => {
    if (aiStatus !== "done" || !aiFields || !file) return;
    if (aiAppliedFileRef.current === file) return;
    aiAppliedFileRef.current = file;
    if (!invoiceNumber.trim() && aiFields.invoiceNumber) setInvoiceNumber(aiFields.invoiceNumber);
    if (!invoiceDate && aiFields.invoiceDate) setInvoiceDate(aiFields.invoiceDate);
    if (invoiceQuantity === "" && aiFields.totalQuantity != null) setInvoiceQuantity(String(aiFields.totalQuantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiStatus, aiFields, file]);

  const aiMismatches =
    aiStatus === "done"
      ? findMismatches(
          aiFields,
          { vendorName: vendor?.companyName, invoiceNumber, invoiceDate, invoiceQuantity },
          TAX_INVOICE_DOC_MAPPING
        )
      : [];

  const { po: poQty = null, pi: piQty = null } = expectedQuantities;
  const docQtys = [
    { label: "Purchase order", qty: poQty },
    { label: "Proforma invoice", qty: piQty },
  ].filter((d) => d.qty != null);

  // Everything ever booked against this PO/PI — including part receipts made on
  // earlier days — not just what was entered in this session.
  const [priorTotal, setPriorTotal] = useState(0);

  // The lines actually logged in Step 4 for THIS delivery — fetched by
  // receivingSession (the reliable link, since most deliveries never get a
  // PO/PI attached to key off of instead — see StockEntryStep). Shown below
  // as an editable list so a wrong quantity can be fixed, or a line
  // dropped, before the invoice is uploaded and they move on to IQC stock.
  const [sessionEntries, setSessionEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [rowBusyId, setRowBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

  const docsKey = useMemo(
    () =>
      [...deliveryDocs, purchaseOrder]
        .map((d) => (typeof d === "string" ? d : d?._id))
        .filter(Boolean)
        .join(","),
    [deliveryDocs, purchaseOrder]
  );

  useEffect(() => {
    let cancelled = false;
    const ids = docsKey ? docsKey.split(",") : [];
    if (ids.length === 0) {
      setPriorTotal(0);
      return undefined;
    }
    fetchReceivedTotal(ids).then(({ entries }) => {
      if (cancelled) return;
      // Lines logged under this same session are counted separately via
      // sessionEntries below, so they're excluded here to avoid double-
      // counting them into priorTotal.
      const prior = sessionId
        ? entries.filter((e) => String(e.receivingSession || "") !== String(sessionId))
        : entries;
      setPriorTotal(prior.reduce((sum, e) => sum + Number(e.quantityReceived || 0), 0));
    });
    return () => {
      cancelled = true;
    };
  }, [docsKey, sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    setEntriesLoading(true);
    api
      .get("/stock-entries", { params: { receivingSession: sessionId } })
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setSessionEntries([...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
      })
      .catch(() => {
        if (!cancelled) setSessionEntries([]);
      })
      .finally(() => {
        if (!cancelled) setEntriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const enteredTotal = useMemo(
    () => sessionEntries.reduce((sum, e) => sum + Number(e.quantityReceived || 0), 0),
    [sessionEntries]
  );
  const receivedTotal = priorTotal + enteredTotal;

  const startEdit = (e) => {
    setEditingId(e._id);
    setEditValue(String(e.quantityReceived));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };
  const handleEditEntryQty = async (entry, rawValue) => {
    const qty = Number(rawValue);
    if (!rawValue || Number.isNaN(qty) || qty <= 0) {
      toast.error("Enter a valid quantity greater than 0");
      return;
    }
    if (qty === Number(entry.quantityReceived)) {
      cancelEdit();
      return;
    }
    setRowBusyId(entry._id);
    try {
      const { data } = await api.patch(`/stock-entries/${entry._id}`, { quantityReceived: qty });
      setSessionEntries((prev) => prev.map((e) => (e._id === entry._id ? { ...e, ...data } : e)));
      toast.success("Quantity updated");
      cancelEdit();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the quantity");
    } finally {
      setRowBusyId(null);
    }
  };
  const handleDeleteEntry = async (entry) => {
    if (
      !window.confirm(
        `Remove this line — ${entry.part?.ttUniquePartNumber || "part"}, qty ${entry.quantityReceived}?`
      )
    ) {
      return;
    }
    setRowBusyId(entry._id);
    try {
      await api.delete(`/stock-entries/${entry._id}`);
      setSessionEntries((prev) => prev.filter((e) => e._id !== entry._id));
      toast.success("Entry removed");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not remove the entry");
    } finally {
      setRowBusyId(null);
    }
  };

  const invQty = invoiceQuantity === "" ? null : Number(invoiceQuantity);
  const allQtys = [...docQtys.map((d) => d.qty), Number(receivedTotal)];
  if (invQty != null) allQtys.push(invQty);
  const willClose = docQtys.length > 0 && allQtys.every((q) => q === allQtys[0]);
  const expectedQty = docQtys.length > 0 ? docQtys[0].qty : null;
  const pendingQty = expectedQty == null ? null : expectedQty - receivedTotal;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Attach the tax invoice file, or skip if it hasn't arrived yet");
      return;
    }
    if (!v.validateAll({ invoiceNumber, invoiceQuantity })) {
      toast.error("Fix the highlighted field before uploading");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("vendor", vendor._id);
      if (purchaseOrder?._id) fd.append("purchaseOrder", purchaseOrder._id);
      fd.append("invoiceNumber", invoiceNumber);
      if (invoiceDate) fd.append("invoiceDate", invoiceDate);
      if (invoiceQuantity !== "") fd.append("invoiceQuantity", invoiceQuantity);
      fd.append("notes", notes);
      fd.append("document", file);

      const { data } = await api.post("/tax-invoices", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Tax invoice uploaded");
      if (data?.iqcPending?.count > 0) {
        toast.success(
          `${data.iqcPending.totalQuantity} unit(s) across ${data.iqcPending.count} line(s) moved to IQC stock — awaiting inspection`
        );
      }
      const rec = data?.reconciliation;
      if (rec?.documentsClosed) {
        toast.success("Quantities matched — PO/PI closed automatically");
      } else if (purchaseOrder) {
        toast(rec?.reason || "PO/PI left open", { icon: "⚠️" });
      }

      // Kick off the same embeddings-based line-item match used on the
      // Documents page (getTaxInvoiceLineMatch), so a difference between
      // what the invoice lists and what was actually entered into stock
      // surfaces right away instead of only when someone later opens that
      // dialog manually.
      if (data?._id) {
        api
          .get(`/tax-invoices/${data._id}/line-match`)
          .then(({ data: match }) => {
            const diffCount = (match.matches || []).filter((m) => m.differences?.length > 0).length;
            const unmatched = (match.unmatchedInvoiceLines?.length || 0) + (match.unmatchedStockEntries?.length || 0);
            if (diffCount > 0 || unmatched > 0) {
              toast(
                `Line-item check: ${diffCount} line(s) differ from stock entry, ${unmatched} unmatched — review in Documents`,
                { icon: "⚠️", duration: 6000 }
              );
            } else if ((match.matches || []).length > 0) {
              toast.success("Line-item check: invoice matches stock entry");
            }
          })
          .catch(() => {
            // Best-effort only — line matching needs a readable PDF and a
            // configured AI provider; silently skip if either isn't there.
          });
      }

      onUploaded();
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 5 · Tax invoice</CardTitle>
        <CardDescription>
          Once stock entry is done, upload the tax invoice for this delivery from <strong>{vendor.companyName}</strong>.
          Uploading moves the lines entered into <strong>IQC stock</strong> — they are inspected separately from the
          Parts master (MISC stock → IQC stock) and reach main stock once accepted. If the invoice hasn't arrived
          yet, skip for now — receiving is still marked complete. When the invoice, PO/PI and the stock entered all agree on quantity, the PO and PI
          are closed automatically.
        </CardDescription>
      </CardHeader>

      {(entriesLoading || sessionEntries.length > 0) && (
        <CardContent className="pt-0 space-y-2">
          <Label className="text-xs text-muted-foreground">
            Stock entered for this delivery
            {sessionEntries.length > 0
              ? ` (${sessionEntries.length} ${sessionEntries.length === 1 ? "line" : "lines"})`
              : ""}
          </Label>
          {entriesLoading && sessionEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading entered stock…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Part no.</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[110px] text-right">Qty</TableHead>
                  <TableHead className="w-[90px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionEntries.map((e) => {
                  const editable = !e.stockApplied && e._id;
                  const isEditing = editingId === e._id;
                  const isBusy = rowBusyId === e._id;
                  return (
                    <TableRow key={e._id}>
                      <TableCell className="font-mono text-xs">{e.part?.ttUniquePartNumber}</TableCell>
                      <TableCell className="truncate max-w-0" title={e.part?.itemDescription}>
                        {e.part?.itemDescription}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {isEditing ? (
                          <Input
                            autoFocus
                            type="number"
                            min="0.001"
                            step="any"
                            value={editValue}
                            onChange={(ev) => setEditValue(ev.target.value)}
                            className="h-7 w-20 ml-auto px-1.5 text-right text-xs"
                            disabled={isBusy}
                          />
                        ) : (
                          `+${e.quantityReceived}`
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!editable ? null : isEditing ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditEntryQty(e, editValue)}
                              disabled={isBusy}
                              className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                              title="Save"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={isBusy}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                              title="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(e)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Edit quantity"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(e)}
                              disabled={isBusy}
                              className="text-destructive hover:text-destructive/80 disabled:opacity-50"
                              title="Remove entry"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}

      <form onSubmit={handleSubmit}>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Tax invoice number</Label>
            <Input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              onBlur={() => v.handleBlur("invoiceNumber", invoiceNumber, { invoiceNumber, invoiceQuantity })}
              placeholder="INV-2026-0142"
            />
            <FieldError error={v.fieldError("invoiceNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label>Invoice date</Label>
            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Total quantity on the invoice</Label>
            <Input
              type="number"
              min="0"
              value={invoiceQuantity}
              onChange={(e) => setInvoiceQuantity(e.target.value)}
              onBlur={() => v.handleBlur("invoiceQuantity", invoiceQuantity, { invoiceNumber, invoiceQuantity })}
              placeholder={String(receivedTotal || "")}
            />
            <FieldError error={v.fieldError("invoiceQuantity")} />
          </div>
          <div className="space-y-1.5">
            <Label>File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {aiStatus === "loading" && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading document to check the details…
              </p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {aiMismatches.length > 0 && (
            <div className="sm:col-span-2">
              <DocumentMismatchWarning mismatches={aiMismatches} documentLabel="the uploaded tax invoice" />
            </div>
          )}

          {purchaseOrder && (
            <div
              className={
                "sm:col-span-2 rounded-md border p-3 text-sm " +
                (docQtys.length === 0
                  ? "border-border"
                  : willClose
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-amber-300 bg-amber-50 text-amber-900")
              }
            >
              <div className="flex items-start gap-2">
                {docQtys.length > 0 &&
                  (willClose ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  ))}
                <div className="space-y-1">
                  <p className="font-medium">
                    Total received against this PO/PI: {receivedTotal}
                    {docQtys.map((d) => ` · ${d.label}: ${d.qty}`)}
                    {invQty != null ? ` · Invoice: ${invQty}` : ""}
                  </p>
                  {priorTotal > 0 && (
                    <p className="text-xs">Includes receipts booked on earlier days for the same PO/PI.</p>
                  )}
                  <p className="text-xs">
                    {docQtys.length === 0
                      ? "No quantity recorded on the PO/PI — they will stay open."
                      : willClose
                      ? "All quantities match — the PO and PI will be closed when you upload."
                      : pendingQty != null && pendingQty > 0
                      ? `${pendingQty} still pending — the PO and PI stay open so the balance can be received later.`
                      : "Quantities don't match — the PO and PI will stay open so the difference can be settled."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-between">
          <Button type="button" variant="secondary" onClick={onSkip} disabled={submitting}>
            <SkipForward className="h-4 w-4 mr-2" />
            Not received yet — skip
          </Button>
          <Button type="submit" disabled={submitting}>
            <UploadCloud className="h-4 w-4 mr-2" />
            {submitting ? "Uploading..." : "Upload & continue"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}