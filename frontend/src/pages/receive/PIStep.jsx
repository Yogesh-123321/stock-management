import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { UploadCloud, SkipForward, Link2, RefreshCw, AlertTriangle } from "lucide-react";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "");

// purchaseOrder: the PO doc linked/uploaded in the previous step, or null if it was skipped.
export default function PIStep({ vendor, purchaseOrder, onUploaded, onSkip, onBack }) {
  const [mode, setMode] = useState("existing"); // "existing" | "upload"
  const [openDocs, setOpenDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [existingQty, setExistingQty] = useState("");

  const [documentNumber, setDocumentNumber] = useState("");
  const [totalQuantity, setTotalQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const poQty = purchaseOrder?.totalQuantity ?? null;

  const loadOpenDocs = async () => {
    setLoadingDocs(true);
    try {
      const { data } = await api.get("/purchase-orders/open", {
        params: { documentType: "Proforma Invoice", vendor: vendor?._id },
      });
      const list = Array.isArray(data) ? data : [];
      setOpenDocs(list);
      if (list.length === 0) setMode("upload");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load open proforma invoices");
      setMode("upload");
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    if (vendor?._id) loadOpenDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?._id]);

  useEffect(() => {
    const doc = openDocs.find((d) => d._id === selectedId);
    setExistingQty(doc && doc.totalQuantity != null ? String(doc.totalQuantity) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Warn as soon as the PI quantity differs from the PO quantity.
  const enteredQty = mode === "existing" ? existingQty : totalQuantity;
  const piQty = enteredQty === "" ? null : Number(enteredQty);
  const qtyMismatch = poQty != null && piQty != null && poQty !== piQty;

  const handleUseExisting = async () => {
    const doc = openDocs.find((d) => d._id === selectedId);
    if (!doc) {
      toast.error("Pick an open proforma invoice from the list");
      return;
    }
    let finalDoc = doc;
    const qty = existingQty === "" ? null : Number(existingQty);
    if (qty !== (doc.totalQuantity ?? null)) {
      try {
        const { data } = await api.patch(`/purchase-orders/${doc._id}/quantity`, { totalQuantity: qty });
        finalDoc = { ...doc, totalQuantity: data.totalQuantity };
      } catch {
        finalDoc = { ...doc, totalQuantity: qty };
      }
    }
    toast.success(`Linked PI ${finalDoc.documentNumber || ""}`.trim());
    onUploaded(finalDoc);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Attach the proforma invoice file, or use \"Skip\" if none was sent");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("vendor", vendor._id);
      fd.append("documentType", "Proforma Invoice");
      fd.append("documentNumber", documentNumber);
      if (totalQuantity !== "") fd.append("totalQuantity", totalQuantity);
      fd.append("notes", notes);
      fd.append("document", file);
      if (purchaseOrder) fd.append("linkedDocument", purchaseOrder._id);

      const { data } = await api.post("/purchase-orders", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Proforma invoice uploaded");
      onUploaded(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  // PO and PI are both optional — skipping is always allowed.
  const handleSkip = () => {
    onSkip();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 · Proforma invoice</CardTitle>
        <CardDescription>
          Pick an already-open proforma invoice for <strong>{vendor.companyName}</strong>, or upload a new one.
          {purchaseOrder
            ? ` A purchase order is already attached to this delivery${poQty != null ? ` (quantity ${poQty})` : ""}.`
            : " Both the purchase order and the proforma invoice are optional."}
          {" You can skip this step and go straight to the stock entry."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "existing" ? "default" : "outline"}
            onClick={() => setMode("existing")}
          >
            <Link2 className="h-4 w-4 mr-2" />
            Use an open PI
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "upload" ? "default" : "outline"}
            onClick={() => setMode("upload")}
          >
            <UploadCloud className="h-4 w-4 mr-2" />
            Upload a new PI
          </Button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Open proforma invoices</Label>
                <button
                  type="button"
                  onClick={loadOpenDocs}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </button>
              </div>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ backgroundColor: "#ffffff" }}
                className="flex h-10 w-full items-center rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">
                  {loadingDocs
                    ? "Loading open proforma invoices..."
                    : openDocs.length === 0
                    ? "No open proforma invoices for this vendor"
                    : "Select an open proforma invoice"}
                </option>
                {openDocs.map((d) => (
                  <option key={d._id} value={d._id}>
                    {(d.documentNumber || "(no number)") +
                      " · " +
                      (d.vendor?.companyName || vendor.companyName) +
                      " · " +
                      fmtDate(d.createdAt) +
                      (d.totalQuantity != null ? ` · Qty ${d.totalQuantity}` : "")}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Only proforma invoices with an <strong>open</strong> status are listed.
              </p>
            </div>

            {selectedId && (
              <div className="space-y-1.5 max-w-xs">
                <Label>Total quantity on this PI</Label>
                <Input
                  type="number"
                  min="0"
                  value={existingQty}
                  onChange={(e) => setExistingQty(e.target.value)}
                  placeholder="e.g. 120"
                />
              </div>
            )}
          </div>
        ) : (
          <form id="pi-upload-form" onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>PI number</Label>
              <Input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="PI-2026-0142"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Total quantity on the PI</Label>
              <Input
                type="number"
                min="0"
                value={totalQuantity}
                onChange={(e) => setTotalQuantity(e.target.value)}
                placeholder="e.g. 120"
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
          </form>
        )}

        {qtyMismatch && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <p>
              <strong>Quantity mismatch:</strong> the purchase order says <strong>{poQty}</strong> but this proforma
              invoice says <strong>{piQty}</strong>. You can still continue — the PO/PI will stay <strong>open</strong>
              {" "}until the quantities line up.
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={handleSkip} disabled={submitting}>
            <SkipForward className="h-4 w-4 mr-2" />
            No PI for this delivery — skip
          </Button>
          {mode === "existing" ? (
            <Button type="button" onClick={handleUseExisting} disabled={!selectedId}>
              <Link2 className="h-4 w-4 mr-2" />
              Use this PI & continue
            </Button>
          ) : (
            <Button type="submit" form="pi-upload-form" disabled={submitting}>
              <UploadCloud className="h-4 w-4 mr-2" />
              {submitting ? "Uploading..." : "Upload & continue"}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
