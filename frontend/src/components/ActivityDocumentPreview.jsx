import { useEffect, useState } from "react";
import { ExternalLink, FileX, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import PoPreview from "@/components/PoPreview";
import PiPreview from "@/components/PiPreview";
import { DocSummary, PartyDetails } from "@/components/ApprovalPreviewDialog";
import { docKindLabel, fmtDate, humanizeKey, inr } from "@/lib/activityFormat";

/*
  The "Document" tab of an activity-log entry: loads the record the action was
  about and shows it right inside the log, so nobody has to leave the page and
  hunt for it in Documents / Parts / Vendors.

    po / pi      -> the printable PO / PI, with a readable summary above it
    upload       -> the PO / PI file that was uploaded while receiving material
    invoice      -> the supplier's tax invoice file
    vendor/buyer -> registration details and their supporting documents
    part         -> the parts-master record
    kit-issue    -> what was issued, to whom, and any shortages
*/

const ENDPOINT = {
  po: (id) => `/po-generator/${id}`,
  pi: (id) => `/pi-generator/${id}`,
  upload: (id) => `/purchase-orders/${id}`,
  invoice: (id) => `/tax-invoices/${id}`,
  vendor: (id) => `/vendors/${id}`,
  buyer: (id) => `/buyers/${id}`,
  part: (id) => `/parts/${id}`,
  "kit-issue": (id) => `/kits/issues/${id}`,
};

// Stored file URLs are normally absolute (Cloudinary); a relative "/uploads/…"
// path is resolved against the API's own origin.
const API_ORIGIN = (api?.defaults?.baseURL || "").replace(/\/api\/?$/, "");
const fileUrl = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const extOf = (value = "") => {
  const clean = String(value).split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
};
const fileKind = (doc) => {
  const exts = [extOf(doc?.documentUrl), extOf(doc?.originalFileName)];
  if (exts.includes("pdf")) return "pdf";
  if (exts.some((e) => IMAGE_EXT.includes(e))) return "image";
  return "other";
};

function Facts({ rows }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
          <dd className="whitespace-pre-line break-words text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FileViewer({ doc }) {
  const url = fileUrl(doc?.documentUrl);
  const kind = fileKind(doc);
  if (!url) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No file is attached.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
          </a>
        </Button>
      </div>
      {kind === "pdf" && (
        <iframe
          title={doc.originalFileName || "Document"}
          src={url}
          className="h-[68vh] w-full rounded-md border border-border bg-white"
        />
      )}
      {kind === "image" && (
        <img
          src={url}
          alt={doc.originalFileName || "Document"}
          className="mx-auto max-h-[68vh] rounded-md border border-border bg-white object-contain"
        />
      )}
      {kind === "other" && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          This kind of file can’t be shown here — use “Open in new tab”.
        </p>
      )}
    </div>
  );
}

function KitIssueView({ doc }) {
  const lines = doc.lines || [];
  return (
    <div className="space-y-4 rounded-md bg-card p-4">
      <Facts
        rows={[
          ["Kit", [doc.kitName, doc.kitCode].filter(Boolean).join(" · ")],
          ["Issue code", doc.issueCode],
          ["Kits issued", doc.quantity],
          ["Issued to", doc.vendor?.companyName],
          ["Issued by", doc.issuedBy],
          ["Issued on", fmtDate(doc.createdAt)],
          ["Shortage", doc.hasShortage ? "Yes — some parts were short" : "No"],
          ["Remarks", doc.remarks],
        ]}
      />
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">Part</th>
              <th className="px-2 py-1 font-medium">Description</th>
              <th className="px-2 py-1 font-medium">Ref.</th>
              <th className="px-2 py-1 text-right font-medium">Required</th>
              <th className="px-2 py-1 text-right font-medium">Issued</th>
              <th className="px-2 py-1 text-right font-medium">Short</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l._id || i} className="border-t border-border/60 align-top">
                <td className="px-2 py-1 font-mono">{l.ttUniquePartNumber || l.part?.ttUniquePartNumber}</td>
                <td className="px-2 py-1">{l.itemDescription || l.part?.itemDescription}</td>
                <td className="px-2 py-1">{l.referenceDesignator || "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.qtyRequired}</td>
                <td className="px-2 py-1 text-right tabular-nums">{l.qtyIssued}</td>
                <td
                  className={`px-2 py-1 text-right tabular-nums ${
                    l.qtyShort > 0 ? "font-medium text-rose-600" : ""
                  }`}
                >
                  {l.qtyShort || 0}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-muted-foreground">
                  No lines on this issue.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PartView({ doc }) {
  const vendors = Array.isArray(doc.vendors)
    ? doc.vendors.map((v) => v?.companyName).filter(Boolean).join(" / ")
    : "";
  return (
    <div className="space-y-4 rounded-md bg-card p-4">
      <Facts
        rows={[
          ["Part number", doc.ttUniquePartNumber],
          ["Description", doc.itemDescription],
          ["Manufacturer part no.", doc.manufacturerPartNumber],
          ["Type", doc.typeOfPart],
          ["Category", doc.category],
          ["Unit", doc.unit],
          ["HSN code", doc.hsnCode],
          ["Price", doc.price != null ? inr(doc.price) : ""],
          ["In stock", doc.quantityInStock],
          ["R&D stock", doc.rndStock],
          ["Vendors", vendors],
          ["Alternate of", doc.alternateOf?.ttUniquePartNumber],
          ["Remarks", doc.remarks],
          ["Last edited by", doc.lastEditedBy],
        ]}
      />
      {(doc.photoUrl || doc.datasheetUrl) && (
        <div className="flex flex-wrap gap-2">
          {doc.photoUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={doc.photoUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Photo
              </a>
            </Button>
          )}
          {doc.datasheetUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={doc.datasheetUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Datasheet
              </a>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function UploadView({ doc }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-card p-4">
        <Facts
          rows={[
            ["Document type", doc.documentType],
            ["Document no.", doc.documentNumber],
            ["Vendor", doc.vendor?.companyName],
            ["Received on", fmtDate(doc.receivedDate || doc.createdAt)],
            ["Receiving status", doc.status ? humanizeKey(doc.status) : ""],
            ["Open / closed", doc.lifecycleStatus ? humanizeKey(doc.lifecycleStatus) : ""],
            ["Total qty", doc.totalQuantity],
            ["Notes", doc.notes],
          ]}
        />
      </div>
      <FileViewer doc={doc} />
    </div>
  );
}

function InvoiceView({ doc }) {
  const link = doc.purchaseOrder
    ? `${doc.purchaseOrder.documentType || ""} ${doc.purchaseOrder.documentNumber || ""}`.trim()
    : "";
  const pay = doc.payment?.status;
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-card p-4">
        <Facts
          rows={[
            ["Invoice no.", doc.invoiceNumber],
            ["Invoice date", doc.invoiceDate ? fmtDate(doc.invoiceDate) : ""],
            ["Vendor", doc.vendor?.companyName],
            ["Against", link],
            ["Total bill", doc.totalBill != null ? inr(doc.totalBill) : ""],
            ["Payment", pay ? humanizeKey(pay) : ""],
            ["Paid so far", doc.payment?.paidAmount > 0 ? inr(doc.payment.paidAmount) : ""],
            ["UTR", doc.payment?.utrNumber],
            ["Notes", doc.notes],
          ]}
        />
      </div>
      <FileViewer doc={doc} />
    </div>
  );
}

export default function ActivityDocumentPreview({ docRef }) {
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { missing, message }

  useEffect(() => {
    const build = ENDPOINT[docRef?.kind];
    if (!build) {
      setLoading(false);
      setError({ missing: false, message: "This type of record has no preview." });
      return undefined;
    }
    let cancelled = false;
    setDoc(null);
    setError(null);
    setLoading(true);
    api
      .get(build(docRef.id))
      .then(({ data }) => {
        if (!cancelled) setDoc(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const missing = err?.response?.status === 404;
        setError({
          missing,
          message: missing
            ? "This record is no longer available — it may have been deleted or replaced since this action."
            : err?.response?.data?.message || "Could not load the document.",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docRef?.kind, docRef?.id]);

  const kind = docRef?.kind;

  return (
    <div className="space-y-3 bg-secondary/40 p-4">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading {docKindLabel(kind).toLowerCase()}…
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center gap-2 py-20 text-center text-sm text-muted-foreground">
          <FileX className="h-6 w-6" />
          <p className="max-w-md">{error.message}</p>
        </div>
      )}

      {!loading && !error && doc && (
        <>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {docKindLabel(kind)} — shown as it is now
          </p>
          {(kind === "po" || kind === "pi") && <DocSummary doc={doc} type={kind} />}
          {kind === "po" && <PoPreview po={doc} />}
          {kind === "pi" && <PiPreview pi={doc} />}
          {(kind === "vendor" || kind === "buyer") && (
            <div className="rounded-md bg-card p-4">
              <PartyDetails party={doc} type={kind} />
            </div>
          )}
          {kind === "part" && <PartView doc={doc} />}
          {kind === "kit-issue" && <KitIssueView doc={doc} />}
          {kind === "upload" && <UploadView doc={doc} />}
          {kind === "invoice" && <InvoiceView doc={doc} />}
        </>
      )}
    </div>
  );
}