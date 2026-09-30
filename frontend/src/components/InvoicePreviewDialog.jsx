import { useEffect, useState } from "react";
import { Banknote, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/*
  In-page preview of a tax invoice's uploaded file (used on the Billing page).

  Opens over the current page instead of sending the person to a new browser
  tab, so they can check the invoice and then mark it paid without losing
  their place in the list.

    - PDF   -> shown in an <iframe>
    - image -> shown with <img>
    - other -> can't be embedded, so a "Open in new tab" fallback is shown
*/

// Same idea as Documents.jsx: stored URLs are normally absolute (Cloudinary),
// but a relative "/uploads/..." path is resolved against the API origin.
const API_ORIGIN = (api?.defaults?.baseURL || "").replace(/\/api\/?$/, "");
const fileUrl = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

const extOf = (value = "") => {
  const clean = String(value).split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
};

const kindOf = (invoice) => {
  const exts = [extOf(invoice?.documentUrl), extOf(invoice?.originalFileName)];
  if (exts.includes("pdf")) return "pdf";
  if (exts.some((e) => IMAGE_EXT.includes(e))) return "image";
  return "other";
};

// Cloudinary can force a download by adding the fl_attachment flag to the URL.
// Anything else falls back to the plain URL (opens in a new tab).
const downloadUrl = (url) =>
  /res\.cloudinary\.com\/.+\/upload\//.test(url)
    ? url.replace("/upload/", "/upload/fl_attachment/")
    : url;

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

export default function InvoicePreviewDialog({ invoice, onClose, onMarkPaid }) {
  const [loaded, setLoaded] = useState(false);

  // Show the spinner again whenever a different invoice is opened.
  useEffect(() => {
    setLoaded(false);
  }, [invoice?._id]);

  const url = fileUrl(invoice?.documentUrl);
  const kind = kindOf(invoice);
  const paid = invoice?.payment?.status === "paid";

  return (
    <Dialog open={Boolean(invoice)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoice {invoice?.invoiceNumber || "—"}
          </DialogTitle>
          <DialogDescription>
            {invoice?.vendor?.companyName || "Vendor"} ·{" "}
            {fmtDate(invoice?.invoiceDate || invoice?.createdAt)}
            {invoice?.purchaseOrder
              ? ` · ${invoice.purchaseOrder.documentType} ${invoice.purchaseOrder.documentNumber || ""}`
              : ""}
            {paid ? " · Paid" : " · Unpaid"}
          </DialogDescription>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-secondary/40">
          {!url && (
            <p className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              No file is attached to this invoice.
            </p>
          )}

          {url && kind === "pdf" && (
            <>
              {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice…
                </div>
              )}
              <iframe
                key={invoice?._id}
                title={`Invoice ${invoice?.invoiceNumber || ""}`}
                src={url}
                onLoad={() => setLoaded(true)}
                className="h-full w-full bg-white"
              />
            </>
          )}

          {url && kind === "image" && (
            <div className="h-full overflow-auto p-4">
              <img
                src={url}
                alt={`Invoice ${invoice?.invoiceNumber || ""}`}
                className="mx-auto max-w-full rounded bg-white shadow-sm"
              />
            </div>
          )}

          {url && kind === "other" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>This file type can't be previewed here.</p>
              <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in a new tab
                </a>
              </Button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {invoice?.originalFileName || ""}
          </p>
          <div className="flex items-center gap-2">
            {url && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={downloadUrl(url)} download>
                    <Download className="mr-1.5 h-3.5 w-3.5" /> Download
                  </a>
                </Button>
              </>
            )}
            {!paid && onMarkPaid && (
              <Button size="sm" onClick={() => onMarkPaid(invoice)}>
                <Banknote className="mr-1.5 h-3.5 w-3.5" /> Mark paid
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}