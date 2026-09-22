import { FileText, Image as ImageIcon, ExternalLink } from "lucide-react";

/*
  Small shared viewer for an IQC template's reference image/PDF.

  Used in two places:
    - IqcTemplates.jsx — so the admin can preview the file they're about
      to attach (or the one already saved) while creating/editing a
      template.
    - IqcReportForm.jsx — shown as the "comparison window" next to the
      checklist at IQC approval/rejection time, so the inspector can look
      at the reference photo/drawing side-by-side with the checklist
      while deciding to accept or reject the received material.
*/
const fileName = (url = "") =>
  decodeURIComponent((url.split("/").pop() || "reference file").split("?")[0]);
const extOf = (url = "") => (fileName(url).split(".").pop() || "").toLowerCase();
const isImage = (url) => ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(extOf(url));
const isPdf = (url) => extOf(url) === "pdf";

export default function IqcReferenceViewer({
  url,
  label = "Reference image/PDF",
  fileLabel,
  className = "",
  height = "360px",
}) {
  if (!url) return null;

  return (
    <div className={`overflow-hidden rounded-md border border-border bg-background ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {isImage(url) ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </span>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-xs text-primary underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open full size
        </a>
      </div>

      <div className="max-h-[420px] overflow-auto p-2" style={{ minHeight: height }}>
        {isImage(url) && (
          <img src={url} alt={fileLabel || label} className="mx-auto max-w-full rounded" loading="lazy" />
        )}
        {isPdf(url) && (
          <iframe
            src={url}
            title={fileLabel || label}
            className="w-full rounded bg-white"
            style={{ height }}
          />
        )}
        {!isImage(url) && !isPdf(url) && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            This file type can't be previewed here —{" "}
            <a href={url} target="_blank" rel="noreferrer" className="underline">
              open it
            </a>{" "}
            instead.
          </p>
        )}
      </div>
    </div>
  );
}