import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import StepIndicator from "@/components/StepIndicator";
import VendorStep from "@/pages/receive/VendorStep";
import POStep from "@/pages/receive/POStep";
import PIStep from "@/pages/receive/PIStep";
import StockEntryStep from "@/pages/receive/StockEntryStep";
import TaxInvoiceStep from "@/pages/receive/TaxInvoiceStep";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import api from "@/lib/api";
import { CheckCircle2, Clock, PauseCircle, Play, Trash2, Plus } from "lucide-react";

const STEPS = ["Vendor", "PO", "PI", "Stock entry", "Tax invoice"];
const STEP_LABEL = { 1: "Vendor", 2: "Purchase order", 3: "Proforma invoice", 4: "Stock entry", 5: "Tax invoice" };

const fmtWhen = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

export default function ReceiveMaterial() {
  // "list" = pick up a saved delivery or start a new one, "wizard" = stepping through one
  const [mode, setMode] = useState("list");

  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const [sessionId, setSessionId] = useState(null);
  const [step, setStep] = useState(1);
  const [vendor, setVendor] = useState(null);
  const [purchaseOrderDoc, setPurchaseOrderDoc] = useState(null); // PO upload, or null if skipped
  const [proformaInvoiceDoc, setProformaInvoiceDoc] = useState(null); // PI upload, or null if skipped
  const [stockEntryDone, setStockEntryDone] = useState(false);
  const [stockQuantity, setStockQuantity] = useState(0); // total qty entered in step 4
  const [done, setDone] = useState(false);
  const [savedAndExited, setSavedAndExited] = useState(false);
  const [saving, setSaving] = useState(false);

  // Whichever of PO/PI anchors this delivery for stock entry + tax invoice.
  const primaryDoc = purchaseOrderDoc || proformaInvoiceDoc;

  // Quantities declared on the paperwork, used to cross-check the stock entry
  // and to decide whether the PO/PI can be closed at the tax invoice step.
  const expectedQuantities = {
    po: purchaseOrderDoc?.totalQuantity ?? null,
    pi: proformaInvoiceDoc?.totalQuantity ?? null,
  };


  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const { data } = await api.get("/receiving-sessions", { params: { status: "in_progress" } });
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const resetWizard = () => {
    setSessionId(null);
    setStep(1);
    setVendor(null);
    setPurchaseOrderDoc(null);
    setProformaInvoiceDoc(null);
    setStockEntryDone(false);
    setDone(false);
    setSavedAndExited(false);
  };

  // Persist progress after every step so the delivery can be picked up later.
  const persist = async (patch = {}, id = sessionId) => {
    if (!id) return null;
    try {
      const { data } = await api.put(`/receiving-sessions/${id}`, patch);
      return data;
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save progress");
      return null;
    }
  };

  const handleVendorReady = async (v) => {
    setVendor(v);
    try {
      const { data } = await api.post("/receiving-sessions", { vendor: v._id, currentStep: 2 });
      setSessionId(data._id);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not start the receiving session");
    }
    setStep(2);
  };

  const goToStep = (next, patch = {}) => {
    setStep(next);
    persist({ currentStep: next, ...patch });
  };

  const handleSaveAndExit = async () => {
    setSaving(true);
    await persist({ currentStep: step, status: "in_progress" });
    setSaving(false);
    setSavedAndExited(true);
    toast.success(`Saved at “${STEP_LABEL[step]}” — you can pick this up any day`);
    await loadSessions();
  };

  const resumeSession = (s) => {
    setSessionId(s._id);
    setVendor(s.vendor);
    setPurchaseOrderDoc(s.purchaseOrderDoc || null);
    setProformaInvoiceDoc(s.proformaInvoiceDoc || null);
    setStockEntryDone(!!s.stockEntryDone);
    setStockQuantity(s.stockQuantity || 0);
    setStep(Math.min(s.currentStep || 2, 5));
    setDone(false);
    setSavedAndExited(false);
    setMode("wizard");
  };

  const discardSession = async (s) => {
    if (!window.confirm(`Discard the saved delivery for ${s.vendor?.companyName || "this vendor"}?`)) return;
    try {
      await api.delete(`/receiving-sessions/${s._id}`);
      toast.success("Saved delivery discarded");
      loadSessions();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not discard");
    }
  };

  const startNew = () => {
    resetWizard();
    setMode("wizard");
  };

  const backToList = () => {
    resetWizard();
    setMode("list");
    loadSessions();
  };

  const finishSession = async () => {
    await persist({ currentStep: 5, taxInvoiceDone: true, status: "completed" });
    setDone(true);
    loadSessions();
  };

  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-2xl font-semibold mb-1">Receive material</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Material has arrived at the office — follow the steps below to enter it into stock. Paperwork rarely arrives
        together, so you can save and exit at any step and continue the same delivery another day.
      </p>

      {mode === "list" ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Deliveries in progress</CardTitle>
                <CardDescription>
                  Saved receiving sessions — resume one at the exact step it was left on.
                </CardDescription>
              </div>
              <Button onClick={startNew}>
                <Plus className="h-4 w-4 mr-2" />
                New delivery
              </Button>
            </CardHeader>
            <CardContent>
              {loadingSessions ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading saved deliveries…</p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nothing pending. Start a new delivery when material arrives.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {sessions.map((s) => (
                    <li key={s._id} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{s.vendor?.companyName || "Unknown vendor"}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Clock className="h-3 w-3" />
                          Waiting at step {s.currentStep} · {STEP_LABEL[s.currentStep]} · saved {fmtWhen(s.lastSavedAt)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {s.purchaseOrderDoc ? `PO ${s.purchaseOrderDoc.documentNumber || "attached"}` : "No PO"} ·{" "}
                          {s.proformaInvoiceDoc ? `PI ${s.proformaInvoiceDoc.documentNumber || "attached"}` : "No PI"} ·{" "}
                          {s.stockEntryDone ? "Stock entered" : "Stock pending"}
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" onClick={() => resumeSession(s)}>
                          <Play className="h-4 w-4 mr-2" />
                          Resume
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => discardSession(s)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : savedAndExited ? (
        <div className="rounded-md border border-border p-8 text-center space-y-3">
          <PauseCircle className="h-10 w-10 mx-auto text-primary" />
          <h2 className="font-display text-lg font-medium">Saved for later</h2>
          <p className="text-sm text-muted-foreground">
            This delivery for {vendor?.companyName} is parked at “{STEP_LABEL[step]}”. It will be waiting under
            “Deliveries in progress” whenever the next document arrives.
          </p>
          <Button onClick={backToList}>Back to deliveries</Button>
        </div>
      ) : done ? (
        <div className="rounded-md border border-border p-8 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
          <h2 className="font-display text-lg font-medium">Receiving complete</h2>
          <p className="text-sm text-muted-foreground">
            Receiving is complete for {vendor?.companyName}. Material covered by a tax invoice is now in IQC stock —
            it is inspected from the Parts master (MISC stock → IQC stock) and reaches main stock once accepted. Start
            a new receiving session for the next delivery.
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={startNew}>Receive next delivery</Button>
            <Button variant="outline" onClick={backToList}>
              Back to deliveries
            </Button>
          </div>
        </div>
      ) : (
        <>
          <StepIndicator steps={STEPS} currentStep={step} />

          {step === 1 && <VendorStep onVendorReady={handleVendorReady} />}

          {step === 2 && vendor && (
            <POStep
              vendor={vendor}
              onBack={() => goToStep(1)}
              onUploaded={(po) => {
                setPurchaseOrderDoc(po);
                goToStep(3, { purchaseOrderDoc: po._id, poSkipped: false });
              }}
              onSkip={() => {
                setPurchaseOrderDoc(null);
                goToStep(3, { purchaseOrderDoc: null, poSkipped: true });
              }}
            />
          )}

          {step === 3 && vendor && (
            <PIStep
              vendor={vendor}
              purchaseOrder={purchaseOrderDoc}
              onBack={() => goToStep(2)}
              onUploaded={(pi) => {
                setProformaInvoiceDoc(pi);
                goToStep(4, { proformaInvoiceDoc: pi._id, piSkipped: false });
              }}
              onSkip={() => {
                setProformaInvoiceDoc(null);
                goToStep(4, { proformaInvoiceDoc: null, piSkipped: true });
              }}
            />
          )}

          {step === 4 && vendor && (
            <StockEntryStep
              vendor={vendor}
              purchaseOrder={primaryDoc}
              deliveryDocs={[purchaseOrderDoc, proformaInvoiceDoc]}
              expectedQuantities={expectedQuantities}
              sessionId={sessionId}
              onFinish={({ enteredQuantity = 0 } = {}) => {
                setStockEntryDone(true);
                setStockQuantity(enteredQuantity);
                goToStep(5, { stockEntryDone: true, stockQuantity: enteredQuantity });
              }}
            />
          )}

          {step === 5 && vendor && (
            <TaxInvoiceStep
              vendor={vendor}
              purchaseOrder={primaryDoc}
              deliveryDocs={[purchaseOrderDoc, proformaInvoiceDoc]}
              expectedQuantities={expectedQuantities}
              enteredQuantity={stockQuantity}
              // Tax invoice is the last step. Uploading it moves the lines into
              // IQC stock; inspection is done separately (by any user) from the
              // Parts master, so the delivery is finished here.
              onUploaded={finishSession}
              onSkip={finishSession}
            />
          )}


          {/* Save & exit is available on every step of the wizard. Work already
              completed on earlier steps is kept; the delivery resumes here. */}
          <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-dashed border-border p-4">
            <p className="text-xs text-muted-foreground">
              {sessionId
                ? `Documents can arrive on different days — park this delivery at “${STEP_LABEL[step]}” and continue later.`
                : "Pick a vendor first; from the next step onward you can save and exit at any point."}
            </p>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={backToList}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={handleSaveAndExit} disabled={!sessionId || saving}>
                <PauseCircle className="h-4 w-4 mr-2" />
                {saving ? "Saving…" : "Save & exit"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}