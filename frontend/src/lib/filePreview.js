import api from "@/lib/api";

/*
  Shared helpers for showing / downloading an uploaded document (tax invoice,
  PO/PI upload, payment bill ...).

  Files live on Cloudinary. PDFs and images open natively in an <iframe> / <img>,
  but browsers cannot render Word files, so .doc / .docx are shown through an
  online document viewer (Microsoft Office viewer, with Google's viewer as the
  alternative) pointed at the file's public Cloudinary link.
*/

const API_ORIGIN = (api?.defaults?.baseURL || "").replace(/\/api\/?$/, "");

// Stored URLs are normally absolute (Cloudinary); a relative "/uploads/..." path
// is resolved against the API origin.
export const fileUrl = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${API_ORIGIN}${u}`);

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
export const WORD_EXT = ["doc", "docx"];

export const extOf = (value = "") => {
  const clean = String(value || "").split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  const slash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return dot === -1 || dot < slash ? "" : clean.slice(dot + 1).toLowerCase();
};

/**
 * "pdf" | "image" | "word" | "other"
 * Looks at the stored URL and at the original file name — older Word uploads
 * were saved on Cloudinary without an extension in the URL, so the original
 * name is the only place that still says ".docx".
 */
export const fileKind = (doc) => {
  const exts = [
    extOf(doc?.documentUrl),
    extOf(doc?.originalFileName),
    extOf(doc?.documentName),
  ];
  if (exts.includes("pdf")) return "pdf";
  if (exts.some((e) => IMAGE_EXT.includes(e))) return "image";
  if (exts.some((e) => WORD_EXT.includes(e))) return "word";
  return "other";
};

export const officeViewerUrl = (url) =>
  `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;

export const googleViewerUrl = (url) =>
  `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;

/** Name to save a download under (keeps the real extension). */
export const downloadName = (doc, url) => {
  const name = doc?.originalFileName || doc?.documentName || "";
  if (name) return name;
  const last = String(url || "").split("?")[0].split("/").pop() || "document";
  return decodeURIComponent(last);
};

/**
 * Downloads the file under its proper name. Fetching it as a blob is what lets
 * us name it "invoice.docx" even when the Cloudinary link itself has no
 * extension. If the fetch is blocked, falls back to just opening the link.
 */
export async function downloadFile(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename || "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}