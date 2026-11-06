import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import WordPreview from "@/components/WordPreview";
import { downloadFile, downloadName, fileKind, fileUrl } from "@/lib/filePreview";
import { cn } from "@/lib/utils";

/*
  In-page document preview for a PO / PI row of the Documents page — the same
  look as the tax-invoice preview: a tall window over the page showing the
  actual file, with Open-in-new-tab and Download underneath.

  When the number belongs to a family (25, 25A, 25B) every version gets a tab
  along the top, so you can flip between them without closing the window.

  kind       "upload" (uploaded PO/PI file) | "po" (generated PO) | "pi" (generated PI)
  members    every record in the family (the clicked one included)
  startId    the record that was clicked
  numberOf   (record) => its number text
  describe   (record) => "Vendor · date" line under the title
*/

const DOWNLOAD_PATH = { po: (id) => `/po-generator/${id}/download`, pi: (id) => `/pi-generator/${id}/download` };

// "/api/po-generator/x/download" -> "/po-generator/x/download" (the axios
// client already points at /api).
const apiPathOf = (u) => String(u || "").replace(/^\/api(?=\/)/, "");

/*
  Resolves what to draw for one record.
  Cloudinary-hosted files are public links and can be used as they are. Files
  that live behind the API (generated POs / PIs, or uploads that point at the
  API) need the login token, which an <iframe> can't send — so they are fetched
  with the app's own client and shown from a local blob.
*/
function useDocumentFile(kind, record) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!record) return undefined;
    let cancelled = false;
    let blobUrl = null;
    setState({ loading: true });

    (async () => {
      try {
        const stored = record.documentUrl || "";
        const direct = /^https?:\/\//i.test(stored);

        // Public file (Cloudinary etc.): use the link itself.
        if (kind === "upload" && direct) {
          if (!cancelled) setState({ loading: false, url: fileUrl(stored), kind: fileKind(record), name: downloadName(record, stored) });
          return;
        }

        const path = DOWNLOAD_PATH[kind] ? DOWNLOAD_PATH[kind](record._id) : apiPathOf(stored);
        if (!path) {
          if (!cancelled) setState({ loading: false, empty: true });
          return;
        }
        const res = await api.get(path, { responseType: "blob" });
        const type = res.data?.type || "";
        blobUrl = URL.createObjectURL(res.data);
        const guessed = type.includes("pdf")
          ? "pdf"
          : type.startsWith("image/")
          ? "image"
          : type.includes("word") || type.includes("officedocument")
          ? "word"
          : fileKind(record);
        const base = String(record.originalFileName || record.voucherNo || record.invoiceNo || record.documentNumber || kind);
        if (cancelled) return;
        setState({
          loading: false,
          url: blobUrl,
          blob: true,
          kind: guessed === "other" && kind !== "upload" ? "pdf" : guessed,
          name: /\.\w{2,5}$/.test(base) ? base : `${base.replace(/[^a-z0-9]+/gi, "_")}.pdf`,
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            loading: false,
            error: err?.response?.status === 404 ? "The file for this document could not be found." : "Could not load this document.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [kind, record?._id]);

  return state;
}

export default function FamilyDocumentViewer({ open, onClose, kind, members = [], startId, numberOf, describe, title }) {
  const [activeId, setActiveId] = useState(startId);

  useEffect(() => {
    if (open) setActiveId(startId);
  }, [open, startId]);

  const active = members.find((m) => String(m._id) === String(activeId)) || members[0];
  const file = useDocumentFile(kind, active);
  if (!active) return null;

  const saveBlob = () => {
    const a = document.createElement("a");
    a.href = file.url;
    a.download = file.name || "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-border px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            {title} {numberOf(active) || "—"}
          </DialogTitle>
          <DialogDescription>{describe ? describe(active) : ""}</DialogDescription>

          {members.length > 1 && (
            <div role="tablist" className="flex flex-wrap gap-1 pt-2">
              {members.map((m) => {
                const on = String(m._id) === String(active._id);
                return (
                  <button
                    key={m._id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setActiveId(m._id)}
                    className={cn(
                      "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                      on ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80 hover:bg-secondary/70"
                    )}
                  >
                    {numberOf(m) || "—"}
                  </button>
                );
              })}
            </div>
          )}
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-secondary/40">
          {file.loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
            </div>
          )}

          {!file.loading && (file.error || file.empty) && (
            <p className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {file.error || "No file is attached to this document."}
            </p>
          )}

          {!file.loading && file.url && file.kind === "pdf" && (
            <iframe key={`${active._id}-${file.url}`} title={`${title} ${numberOf(active)}`} src={file.url} className="h-full w-full bg-white" />
          )}

          {!file.loading && file.url && file.kind === "word" && (
            <WordPreview key={active._id} url={file.url} name={file.name} />
          )}

          {!file.loading && file.url && file.kind === "image" && (
            <div className="h-full overflow-auto p-4">
              <img src={file.url} alt={`${title} ${numberOf(active)}`} className="mx-auto max-w-full rounded bg-white shadow-sm" />
            </div>
          )}

          {!file.loading && file.url && file.kind === "other" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>This file type can't be previewed here.</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">{file.name || ""}</p>
          {file.url && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={file.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in new tab
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (file.blob ? saveBlob() : downloadFile(file.url, file.name))}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}