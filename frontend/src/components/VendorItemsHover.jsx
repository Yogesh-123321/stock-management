import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Package } from "lucide-react";
import api from "@/lib/api";

export default function VendorItemsHover({ vendorId, remarks, children }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  // The trigger's own rect — captured once on hover-in. Position is derived
  // from this plus the popover's *actual* rendered height (see below), so
  // it never depends on a guessed/fixed height.
  const [anchorRect, setAnchorRect] = useState(null);
  // Final { top, left } to render at. Starts as null so the popover mounts
  // invisibly first, gets measured, then is placed — no visible jump.
  const [pos, setPos] = useState(null);
  const wrapperRef = useRef(null);
  const popRef = useRef(null);
  // Delays hiding by a beat so moving the cursor from the trigger across
  // the gap to the popover (e.g. to reach its scrollbar) isn't treated as
  // "left" — cleared on hover of anything, only fires if nothing is
  // hovered by the time it runs.
  const hideTimer = useRef(null);
  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  useEffect(() => {
    if (show && items === null && !loading) {
      setLoading(true);
      api
        .get(`/vendors/${vendorId}/items`)
        .then(({ data }) => setItems(data.items || []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }
  }, [show, vendorId, items, loading]);

  // Runs whenever the popover is (re)shown or its content/height could have
  // changed (loading -> loaded, items arriving). Measures the popover as
  // actually rendered and decides above vs below from real available space,
  // instead of guessing a height up front.
  useLayoutEffect(() => {
    if (!show || !anchorRect) return;
    const el = popRef.current;
    const popHeight = el ? el.offsetHeight : 0;
    const popWidth = el ? el.offsetWidth : 0;
    const margin = 8;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    const spaceBelow = viewportH - anchorRect.bottom - margin;
    const spaceAbove = anchorRect.top - margin;
    // Prefer below (original behavior); flip above only when below doesn't
    // fit but above does — this is the only change to the original design.
    const openAbove = popHeight > spaceBelow && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(margin, anchorRect.top - popHeight - margin)
      : anchorRect.bottom + margin;

    // Keep it on-screen horizontally too, without changing its width/styles.
    let left = anchorRect.left;
    if (popWidth) {
      left = Math.min(left, viewportW - popWidth - margin);
      left = Math.max(margin, left);
    }

    setPos({ top, left });
  }, [show, anchorRect, loading, items]);

  const handleEnter = (e) => {
    clearHideTimer();
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setShow(true);
  };

  const handleLeave = () => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setShow(false);
      setPos(null);
    }, 150);
  };

  useEffect(() => clearHideTimer, []);

  return (
    <span ref={wrapperRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="relative inline-flex items-center gap-1.5 min-w-0">
      {children}
      <Package className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />
      {show &&
        anchorRect &&
        createPortal(
          <div
            ref={popRef}
            onMouseEnter={clearHideTimer}
            onMouseLeave={handleLeave}
            className="z-[9999] fixed bg-card text-card-foreground border border-border rounded-md shadow-lg p-3 min-w-[260px] max-w-[360px]"
            // Rendered at { top: 0, left: -9999 } (off-screen but laid out)
            // until the first measurement in useLayoutEffect lands, so
            // there's no flash at the wrong spot and no visible jump.
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: -9999, visibility: "hidden" }}
          >
            {remarks && (
              <div className="mb-2 pb-2 border-b border-border">
                <div className="text-xs font-semibold mb-1 text-muted-foreground uppercase tracking-wide">
                  Remarks
                </div>
                <div className="text-sm text-card-foreground whitespace-pre-wrap break-words max-h-[80px] overflow-auto">
                  {remarks}
                </div>
              </div>
            )}
            <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
              Items purchased
            </div>
            {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {!loading && (!items || items.length === 0) && (
              <div className="text-sm text-muted-foreground italic">No purchase history yet.</div>
            )}
            {!loading && items && items.length > 0 && (
              <ul className="space-y-2 max-h-[220px] overflow-auto pr-1">
                {items.slice(0, 10).map((it, i) => (
                  <li key={i} className="text-sm border-b border-border last:border-0 pb-1.5 last:pb-0">
                    <div className="font-medium truncate">
                      {it.description || it.partNo || "Item"}
                    </div>
                    {it.partNo && it.description && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        Part no. {it.partNo}
                      </div>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Qty: {it.quantity}
                      {it.lastAt
                        ? ` · Last: ${new Date(it.lastAt).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}