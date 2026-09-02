import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { fetchReceivedTotal } from "@/lib/receivedTotal";
import { UploadCloud, SkipForward, AlertTriangle, CheckCircle2 } from "lucide-react";

// purchaseOrder here is whichever PO/PI document anchors this delivery (the
// "primary" one — PO if uploaded, otherwise the PI).
export default function TaxInvoiceStep({
  vendor,
  purchaseOrder,
  deliveryDocs = [],
  expectedQuantities = {},
  enteredQuantity = 0,
  onUploaded,
  onSkip,
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceQuantity, setInvoiceQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { po: poQty = null, pi: piQty = null } = expectedQuantities;
  const docQtys = [
    { label: "Purchase order", qty: poQty },
    { label: "Proforma invoice", qty: piQty },
  ].filter((d) => d.qty != null);

  // Everything ever booked against this PO/PI — including part receipts made on
  // earlier days — not just what was entered in this session.
  const [receivedTotal, setReceivedTotal] = useState(Number(enteredQuantity) || 0);

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
    if (ids.length === 0) return undefined;
    fetchReceivedTotal(ids).then(({ total }) => {
      if (!cancelled) setReceivedTotal(total);
    });
    return () => {
      cancelled = true;
    };
  }, [docsKey]);

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
      const rec = data?.reconciliation;
      if (rec?.documentsClosed) {
        toast.success("Quantities matched — PO/PI closed automatically");
      } else if (purchaseOrder) {
        toast(rec?.reason || "PO/PI left open", { icon: "⚠️" });
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
          If it hasn't arrived yet, skip for now — receiving is still marked complete. When the invoice, PO/PI and the
          stock entered all agree on quantity, the PO and PI are closed automatically.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Tax invoice number</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-2026-0142" />
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
              placeholder={String(receivedTotal || "")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

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
                  {Number(enteredQuantity) > 0 && receivedTotal !== Number(enteredQuantity) && (
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
            {submitting ? "Uploading..." : "Upload & finish"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
