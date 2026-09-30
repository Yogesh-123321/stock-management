import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck, ShieldX } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import PoPreview from "@/components/PoPreview";
import PiPreview from "@/components/PiPreview";
import { APPROVAL_LABEL } from "@/lib/permissions";

// Where the source document of each approval type can be fetched from.
const SOURCE_URL = {
  po: (id) => `/po-generator/${id}`,
  pi: (id) => `/pi-generator/${id}`,
  vendor: (id) => `/vendors/${id}`,
  buyer: (id) => `/buyers/${id}`,
};

const PARTY_FIELDS = [
  ["Registration no.", (p, t) => (t === "vendor" ? p.vendorRegistrationNo : p.buyerRegistrationNo)],
  ["Company name", (p) => p.companyName],
  ["Nature of company", (p) => p.natureOfCompany],
  ["Nature of business", (p) => p.natureOfBusiness],
  ["GSTIN / Tax reg. no.", (p) => p.taxRegistrationNo],
  ["Address", (p) => p.address],
  ["Phone", (p) => p.phone],
  ["Email", (p) => p.email],
  ["Contact person", (p) => p.contactPersonName],
  ["Contact designation", (p) => p.contactDesignation],
  ["Signatory", (p) => [p.signatoryName, p.signatoryDesignation].filter(Boolean).join(" — ")],
  ["Bank details", (p) => p.bankDetails],
  ["Principal customers", (p) => p.principleCustomers],
  ["Excise reg. no.", (p) => p.exciseRegistrationNo],
  ["MSME", (p) => (p.isMsme ? `Yes${p.msmeNumber ? ` — ${p.msmeNumber}` : ""}` : "No")],
  ["Remarks", (p) => p.remarks],
];

const PARTY_DOCS = [
  ["Registration document", "registrationDocumentUrl"],
  ["GST certificate", "gstDocumentUrl"],
  ["PAN card", "panDocumentUrl"],
  ["Bank record", "bankRecordDocumentUrl"],
  ["MSME certificate", "msmeDocumentUrl"],
];

function PartyDetails({ party, type }) {
  const docs = PARTY_DOCS.filter(([, key]) => party[key]);
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {PARTY_FIELDS.map(([label, get]) => {
          const value = get(party, type);
          return (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-line break-words text-sm">{value || "—"}</dd>
            </div>
          );
        })}
      </dl>

      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          Supporting documents
        </p>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents were uploaded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {docs.map(([label, key]) => (
              <a
                key={key}
                href={party[key]}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-secondary"
              >
                <ExternalLink className="h-3 w-3" /> {label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only preview of whatever is waiting in the Approvals queue — the PO / PI
 * exactly as it will be printed, or the vendor / buyer registration details.
 * Admins who may decide can approve / reject straight from here.
 */
export default function ApprovalPreviewDialog({
  row,
  open,
  onOpenChange,
  canDecide = false,
  busy = false,
  remark = "",
  onRemarkChange,
  onDecide,
}) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !row) return undefined;
    const build = SOURCE_URL[row.entityType];
    if (!build) {
      setError("This type of request has no preview.");
      return undefined;
    }

    let cancelled = false;
    setDoc(null);
    setError("");
    setLoading(true);
    api
      .get(build(row.entityId))
      .then(({ data }) => {
        if (!cancelled) setDoc(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err?.response?.data?.message || "Could not load the document for preview.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, row?._id, row?.entityId, row?.entityType]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = row?.entityType;
  const isPending = row?.status === "pending";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[900px] flex-col p-0">
        <DialogHeader className="mb-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle>{row?.title || "Preview"}</DialogTitle>
          <DialogDescription>
            {row ? APPROVAL_LABEL[type] : ""}
            {row?.requestedBy?.name ? ` · raised by ${row.requestedBy.name}` : ""}
            {row?.status ? ` · ${row.status}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[200px] flex-1 overflow-auto bg-secondary/40 p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
            </div>
          )}

          {!loading && error && (
            <p className="py-16 text-center text-sm text-destructive">{error}</p>
          )}

          {!loading && !error && doc && type === "po" && <PoPreview po={doc} />}
          {!loading && !error && doc && type === "pi" && <PiPreview pi={doc} />}
          {!loading && !error && doc && (type === "vendor" || type === "buyer") && (
            <div className="rounded-md bg-card p-4">
              <PartyDetails party={doc} type={type} />
            </div>
          )}
        </div>

        {canDecide && isPending && (
          <div className="flex items-center gap-2 border-t border-border px-6 py-3">
            <Input
              value={remark}
              onChange={(e) => onRemarkChange?.(e.target.value)}
              placeholder="Remarks (optional)"
              className="h-9 text-sm"
            />
            <Button disabled={busy} onClick={() => onDecide?.(row, "approve")}>
              <ShieldCheck className="mr-1.5 h-4 w-4" /> Approve
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => onDecide?.(row, "reject")}>
              <ShieldX className="mr-1.5 h-4 w-4" /> Reject
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}