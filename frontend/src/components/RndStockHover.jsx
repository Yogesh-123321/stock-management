import { useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { FlaskConical } from "lucide-react";

/*
  Hover popover for the Parts master "R&D stock" column — lists everyone
  this part's R&D stock has been issued to. Unlike VendorItemsHover, the
  data (part.rndIssues) is already part of the row the table has in memory
  (see GET /api/parts), so this never fetches anything itself; it just
  positions and renders what it's given.
*/
export default function RndStockHover({ issues, children }) {
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
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    const spaceBelow = viewportH - anchorRect.bottom - margin;
    const spaceAbove = anchorRect.top - margin;
    const openAbove = popHeight > spaceBelow && spaceAbove > spaceBelow;

    const top = openAbove
      ? Math.max(margin, anchorRect.top - popHeight - margin)
      : anchorRect.bottom + margin;

    let left = anchorRect.left;
    if (popWidth) {
      left = Math.min(left, viewportW - popWidth - margin);
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

  const list = Array.isArray(issues) ? issues : [];

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="relative inline-flex items-center gap-1 min-w-0"
    >
      {children}
      {list.length > 0 && <FlaskConical className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />}
      {show &&
        anchorRect &&
        list.length > 0 &&
        createPortal(
          <div
            ref={popRef}
            onMouseEnter={clearHideTimer}
            onMouseLeave={handleLeave}
            className="z-[9999] fixed bg-card text-card-foreground border border-border rounded-md shadow-lg p-3 min-w-[220px] max-w-[320px]"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: -9999, visibility: "hidden" }}
          >
            <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
              Issued to
            </div>
            <ul className="space-y-1.5 max-h-[220px] overflow-auto pr-1">
              {list
                .slice()
                .reverse()
                .map((it, i) => (
                  <li key={it._id || i} className="text-sm border-b border-border last:border-0 pb-1.5 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{it.personName}</span>
                      <span className="font-mono-tech text-xs text-muted-foreground shrink-0">
                        {it.quantity}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {it.date
                        ? new Date(it.date).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : ""}
                      {it.issuedBy ? ` · by ${it.issuedBy}` : ""}
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
