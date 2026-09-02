import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { UploadCloud, SkipForward, Link2, RefreshCw } from "lucide-react";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "");

export default function POStep({ vendor, onUploaded, onSkip, onBack }) {
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

  const loadOpenDocs = async () => {
    setLoadingDocs(true);
    try {
      const { data } = await api.get("/purchase-orders/open", {
        params: { documentType: "Purchase Order", vendor: vendor?._id },
      });
      const list = Array.isArray(data) ? data : [];
      setOpenDocs(list);
      if (list.length === 0) setMode("upload");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load open purchase orders");
      setMode("upload");
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    if (vendor?._id) loadOpenDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?._id]);

  // Prefill the quantity box with whatever the selected PO already declares.
  useEffect(() => {
    const doc = openDocs.find((d) => d._id === selectedId);
    setExistingQty(doc && doc.totalQuantity != null ? String(doc.totalQuantity) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleUseExisting = async () => {
    const doc = openDocs.find((d) => d._id === selectedId);
    if (!doc) {
      toast.error("Pick an open purchase order from the list");
      return;
    }
    let finalDoc = doc;
    // Persist the quantity if it was entered/corrected here, so the later
    // reconciliation against stock entry and the tax invoice can work.
    const qty = existingQty === "" ? null : Number(existingQty);
    if (qty !== (doc.totalQuantity ?? null)) {
      try {
        const { data } = await api.patch(`/purchase-orders/${doc._id}/quantity`, { totalQuantity: qty });
        finalDoc = { ...doc, totalQuantity: data.totalQuantity };
      } catch {
        finalDoc = { ...doc, totalQuantity: qty };
      }
    }
    toast.success(`Linked PO ${finalDoc.documentNumber || ""}`.trim());
    onUploaded(finalDoc);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Attach the purchase order file, or use \"Skip\" if none was sent");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("vendor", vendor._id);
      fd.append("documentType", "Purchase Order");
      fd.append("documentNumber", documentNumber);
      if (totalQuantity !== "") fd.append("totalQuantity", totalQuantity);
      fd.append("notes", notes);
      fd.append("document", file);

      const { data } = await api.post("/purchase-orders", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Purchase order uploaded");
      onUploaded(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 · Purchase order</CardTitle>
        <CardDescription>
          Pick an already-open purchase order for <strong>{vendor.companyName}</strong>, or upload a new one. If this
          delivery only came with a proforma invoice, skip this step. Record the total quantity on the PO so it can be
          checked against the PI, the stock entered and the tax invoice.
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
            Use an open PO
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "upload" ? "default" : "outline"}
            onClick={() => setMode("upload")}
          >
            <UploadCloud className="h-4 w-4 mr-2" />
            Upload a new PO
          </Button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Open purchase orders</Label>
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
                    ? "Loading open purchase orders..."
                    : openDocs.length === 0
                    ? "No open purchase orders for this vendor"
                    : "Select an open purchase order"}
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
                Only purchase orders with an <strong>open</strong> status are listed.
              </p>
            </div>

            {selectedId && (
              <div className="space-y-1.5 max-w-xs">
                <Label>Total quantity on this PO</Label>
                <Input
                  type="number"
                  min="0"
                  value={existingQty}
                  onChange={(e) => setExistingQty(e.target.value)}
                  placeholder="e.g. 120"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank if the PO doesn't state a quantity — no quantity check will be done.
                </p>
              </div>
            )}
          </div>
        ) : (
          <form id="po-upload-form" onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>PO number</Label>
              <Input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="PO-2026-0142"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Total quantity on the PO</Label>
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
      </CardContent>

      <CardFooter className="justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onSkip} disabled={submitting}>
            <SkipForward className="h-4 w-4 mr-2" />
            No PO for this delivery — skip
          </Button>
          {mode === "existing" ? (
            <Button type="button" onClick={handleUseExisting} disabled={!selectedId}>
              <Link2 className="h-4 w-4 mr-2" />
              Use this PO & continue
            </Button>
          ) : (
            <Button type="submit" form="po-upload-form" disabled={submitting}>
              <UploadCloud className="h-4 w-4 mr-2" />
              {submitting ? "Uploading..." : "Upload & continue"}
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
