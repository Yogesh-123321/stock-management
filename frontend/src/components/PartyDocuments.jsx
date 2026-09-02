import { useState } from "react";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { Paperclip, ExternalLink, Download, FileText, Image as ImageIcon, Eye, EyeOff } from "lucide-react";

/**
 * Shared viewer for the supporting documents attached during vendor / buyer
 * registration. Used by both Vendors.jsx and Buyers.jsx so the two sections
 * stay identical.
 */
export const PARTY_DOC_SLOTS = [
  { key: "gstDocumentUrl", label: "GST certificate" },
  { key: "panDocumentUrl", label: "PAN card" },
  { key: "bankRecordDocumentUrl", label: "Bank record" },
  { key: "msmeDocumentUrl", label: "MSME / Udyam certificate" },
  { key: "registrationDocumentUrl", label: "Other supporting document" },
];

/** Uploads are stored as server-relative paths (/uploads/...), so they must be
 *  resolved against the API origin — not the frontend origin. */
export function resolveDocUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) return url;
  const base = api.defaults.baseURL || "";
  let origin = base;
  try {
    origin = new URL(base, window.location.origin).origin;
  } catch {
    origin = base.replace(/\/api\/?$/, "");
  }
  return `${origin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
}

const fileName = (url = "") => decodeURIComponent(url.split("/").pop() || "document");
const extOf = (url = "") => (fileName(url).split(".").pop() || "").toLowerCase();
const isImage = (url) => ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extOf(url));
const isPdf = (url) => extOf(url) === "pdf";

export default function PartyDocuments({ party, slots = PARTY_DOC_SLOTS }) {
  const available = slots.filter((slot) => party?.[slot.key]);
  const [openKey, setOpenKey] = useState(available[0]?.key || null);

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No documents were attached at registration. Use <strong>Edit</strong> to upload them.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {available.map((slot) => {
          const active = openKey === slot.key;
          const url = resolveDocUrl(party[slot.key]);
          return (
            <button
              key={slot.key}
              type="button"
              onClick={() => setOpenKey(active ? null : slot.key)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted"
              }`}
              title={fileName(url)}
            >
              {isImage(url) ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              {slot.label}
            </button>
          );
        })}
      </div>

      {available.map((slot) => {
        if (openKey !== slot.key) return null;
        const url = resolveDocUrl(party[slot.key]);
        return (
          <div key={slot.key} className="rounded-lg border border-border overflow-hidden bg-muted/30">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{fileName(url)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setOpenKey(null)}>
                  <EyeOff className="h-3.5 w-3.5 mr-1.5" /> Hide
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={url} download={fileName(url)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                  </a>
                </Button>
              </div>
            </div>

            <div className="max-h-[420px] overflow-auto p-2">
              {isImage(url) && (
                <img src={url} alt={slot.label} className="mx-auto max-w-full rounded" loading="lazy" />
              )}
              {isPdf(url) && <iframe src={url} title={slot.label} className="h-[400px] w-full rounded bg-white" />}
              {!isImage(url) && !isPdf(url) && (
                <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Eye className="h-5 w-5" />
                  <span>This file type can’t be previewed here.</span>
                  <a href={url} target="_blank" rel="noreferrer" className="underline">
                    Open it in a new tab
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
