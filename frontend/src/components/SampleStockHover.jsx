import { useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { PackageCheck } from "lucide-react";
import { fmtQty } from "@/lib/utils";

/*
  Hover popover for the Parts master "Issued samples" view of the MISC stock
  column — lists every buyer currently holding samples of this part.
  `holders` is part.sampleHolders (see getParts in partController.js), already
  part of the row the table has in memory, so nothing is fetched here.
*/
export default function SampleStockHover({ holders, children }) {
  const [show, setShow] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  const hideTimer = useRef(null);
  const clearHideTimer = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  useLayoutEffect(() => {
    if (!show || !anchorRect) return;
    const el = popRef.current;
    const popHeight = el ? el.offsetHeight : 0;
    const popWidth = el ? el.offsetWidth : 0;
    const margin = 8;
    const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
    const spaceAbove = anchorRect.top - margin;
    const openAbove = popHeight > spaceBelow && spaceAbove > spaceBelow;
    const top = openAbove
      ? Math.max(margin, anchorRect.top - popHeight - margin)
      : anchorRect.bottom + margin;
    let left = anchorRect.left;
    if (popWidth) {
      left = Math.min(left, window.innerWidth - popWidth - margin);
      left = Math.max(margin, left);
    }
    setPos({ top, left });
  }, [show, anchorRect]);

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

  const list = Array.isArray(holders) ? holders : [];

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="relative inline-flex items-center gap-1 min-w-0"
    >
      {children}
      {list.length > 0 && <PackageCheck className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />}
      {show &&
        anchorRect &&
        list.length > 0 &&
        createPortal(
          <div
            ref={popRef}
            onMouseEnter={clearHideTimer}
            onMouseLeave={handleLeave}
            className="z-[9999] fixed bg-card text-card-foreground border border-border rounded-md shadow-lg p-3 min-w-[240px] max-w-[340px]"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: -9999, visibility: "hidden" }}
          >
            <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
              Samples out with
            </div>
            <ul className="space-y-1.5 max-h-[220px] overflow-auto pr-1">
              {list.map((h, i) => (
                <li key={`${h.issueId}-${i}`} className="text-sm border-b border-border last:border-0 pb-1.5 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{h.buyerName}</span>
                    <span className="font-mono-tech text-xs text-muted-foreground shrink-0">
                      {fmtQty(h.quantity)}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {h.issueCode}
                    {h.issuedAt
                      ? ` · ${new Date(h.issuedAt).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}`
                      : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </span>
  );
}