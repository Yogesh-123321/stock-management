import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { googleViewerUrl, officeViewerUrl } from "@/lib/filePreview";

/*
  Shows a Word file (.docx / .doc) right inside the page.

  1. .docx  -> downloaded in the browser and drawn by the docx-preview library.
               This works for EVERY file, old or new, because it never depends
               on what the stored Cloudinary link looks like (older uploads have
               no ".docx" at the end of their link, which online viewers reject).
  2. .doc / anything that can't be drawn -> falls back to an online viewer
               (Microsoft, or Google via the toggle) pointed at the file's link.

  Needs the "docx-preview" package:  npm install docx-preview  (in /frontend).
  It is imported lazily, so it is only downloaded the first time a Word file is
  opened and doesn't make the rest of the app heavier.
*/

const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });

// A .docx is a zip file, so it starts with "PK". A legacy .doc does not.
const isZip = (buf) => {
  const b = new Uint8Array(buf.slice(0, 2));
  return b[0] === 0x50 && b[1] === 0x4b;
};

// A Word page is a fixed width (A4 is ~794px) and is centred, so in a narrower
// panel the left edge gets cut off and can't be scrolled to. Shrink the whole
// document to fit the panel's width instead (never enlarge it past 100%).
const fitToWidth = (scrollEl, hostEl) => {
  if (!scrollEl || !hostEl) return;
  const wrapper = hostEl.querySelector(".docx-wrapper");
  if (!wrapper) return;
  wrapper.style.padding = "12px";
  hostEl.style.zoom = 1;
  const pages = Array.from(wrapper.querySelectorAll("section"));
  const natural = Math.max(0, ...pages.map((el) => el.offsetWidth)) + 24;
  const available = scrollEl.clientWidth;
  hostEl.style.zoom = natural > 0 && available > 0 ? Math.min(1, available / natural) : 1;
};

export default function WordPreview({ url, name = "", className = "" }) {
  const hostRef = useRef(null);
  const scrollRef = useRef(null);
  const [state, setState] = useState("loading"); // loading | ready | fallback
  const [reason, setReason] = useState("");
  const [viewer, setViewer] = useState("office");
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setReason("");
    setViewer("office");
    setFrameLoaded(false);
    if (hostRef.current) hostRef.current.innerHTML = "";

    (async () => {
      try {
        const res = await withTimeout(fetch(url), 20000, "Downloading the file");
        if (!res.ok) throw new Error(`The file server answered HTTP ${res.status}`);
        const buf = await withTimeout(res.arrayBuffer(), 20000, "Downloading the file");
        if (!isZip(buf)) throw new Error("Not a .docx file"); // legacy .doc
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !hostRef.current) return;
        await withTimeout(
          renderAsync(buf, hostRef.current, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            breakPages: true,
          }),
          20000,
          "Drawing the document"
        );
        if (!cancelled) {
          fitToWidth(scrollRef.current, hostRef.current);
          setState("ready");
        }
      } catch (e) {
        console.error("WordPreview:", e);
        if (!cancelled) {
          setReason(e?.message || "");
          setState("fallback");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    setFrameLoaded(false);
  }, [viewer]);

  // Keep the document fitted when the panel is resized.
  useEffect(() => {
    if (state !== "ready" || !scrollRef.current || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const ro = new ResizeObserver(() => fitToWidth(scrollRef.current, hostRef.current));
    ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [state]);

  if (state === "fallback") {
    const src = viewer === "office" ? officeViewerUrl(url) : googleViewerUrl(url);
    return (
      <div className={`relative h-full w-full ${className}`}>
        {!frameLoaded && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        )}
        <iframe
          key={viewer}
          title={name || "Word document"}
          src={src}
          onLoad={() => setFrameLoaded(true)}
          className="h-full w-full bg-white"
        />
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
          {reason && (
            <span className="rounded bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow">
              Couldn't draw it here ({reason}) — showing the online viewer.
            </span>
          )}
          <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="shadow"
            onClick={() => setViewer((v) => (v === "office" ? "google" : "office"))}
          >
            Not loading? Try the {viewer === "office" ? "Google" : "Microsoft"} viewer
          </Button>
          <Button variant="secondary" size="sm" className="shadow" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open file
            </a>
          </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`relative h-full w-full overflow-auto bg-neutral-200 ${className}`}
    >
      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-neutral-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
        </div>
      )}
      {/* docx-preview draws white pages with dark text, so it reads fine in dark mode too */}
      <div ref={hostRef} className="docx-host text-black" />
    </div>
  );
}