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

const money = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/**
 * Plain-text summary of a PO / PI shown above the printable preview, so the
 * approver can read who it is for, every line, the amounts and the remarks
 * without scanning the formatted sheet.
 */
function DocSummary({ doc, type }) {
  const isPo = type === "po";
  const items = doc.items || [];
  const party = isPo
    ? [doc.supplierName, doc.supplierGSTIN && `GSTIN ${doc.supplierGSTIN}`]
    : [doc.buyerName, doc.buyerGSTIN && `GSTIN ${doc.buyerGSTIN}`, doc.buyerContact, doc.buyerEmail];
  const remarks = [
    !isPo && doc.specialNote && ["Special note", doc.specialNote],
    doc.paymentTerms && ["Payment terms", doc.paymentTerms],
    isPo && doc.termsOfDelivery && ["Terms of delivery", doc.termsOfDelivery],
    isPo && doc.referenceNo && ["Reference no.", doc.referenceNo],
    !isPo && doc.bankDetails && ["Bank details", doc.bankDetails],
  ].filter(Boolean);

  return (
    <div className="mb-4 space-y-3 rounded-md bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isPo ? "Supplier" : "Buyer"}
          </p>
          <p className="font-medium">{party.filter(Boolean).join(" · ") || "—"}</p>
          {(isPo ? doc.supplierAddress : doc.buyerAddress) && (
            <p className="whitespace-pre-line text-xs text-muted-foreground">
              {isPo ? doc.supplierAddress : doc.buyerAddress}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {isPo ? "Voucher no." : "Invoice no."}
          </p>
          <p className="font-medium">{isPo ? doc.voucherNo : doc.invoiceNo}</p>
          <p className="text-xs text-muted-foreground">{day(isPo ? doc.voucherDate : doc.invoiceDate)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">#</th>
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 pr-2 font-medium">HSN/SAC</th>
              <th className="py-1 pr-2 text-right font-medium">Qty</th>
              <th className="py-1 pr-2 text-right font-medium">Rate</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b border-border/50 align-top">
                <td className="py-1 pr-2">{i + 1}</td>
                <td className="py-1 pr-2">
                  {it.description}
                  {isPo && it.partNo && (
                    <span className="block text-[10px] text-muted-foreground">Part no. {it.partNo}</span>
                  )}
                  {isPo && it.additionalInfo && (
                    <span className="block text-[10px] italic text-muted-foreground">
                      Remarks: {it.additionalInfo}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2">{it.hsnSac || "—"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {it.quantity}
                  {isPo && it.unit ? ` ${it.unit}` : ""}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(it.rate)}</td>
                <td className="py-1 text-right tabular-nums">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto w-full max-w-[260px] space-y-0.5 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">Sub-total</span><span className="tabular-nums">₹{money(doc.subTotal)}</span></div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax{doc.taxType && doc.taxType !== "NONE" ? ` (${doc.taxType.replace("_", "+")} @ ${doc.taxRate}%)` : ""}</span>
          <span className="tabular-nums">₹{money(doc.taxAmount)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 text-sm font-semibold">
          <span>Total</span><span className="tabular-nums">₹{money(doc.totalAmount)}</span>
        </div>
      </div>

      {remarks.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-border pt-3 sm:grid-cols-2">
          {remarks.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="whitespace-pre-line break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

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

          {!loading && !error && doc && (type === "po" || type === "pi") && (
            <DocSummary doc={doc} type={type} />
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