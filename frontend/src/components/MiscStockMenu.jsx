import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ExternalLink } from "lucide-react";

/*
  Column-header dropdown for the Parts master "MISC stock" column.

  The header reads "MISC stock" with a small caret; clicking it opens a menu
  of the miscellaneous stock buckets a part can sit in (R&D stock, Rejected
  stock, IQC stock). Picking one is reported through onSelect(key) — it's the
  parent's job to decide what that means (switch the column's figures, or open
  the IQC approve/reject window). Options flagged `opensWindow` get a small
  "opens a window" icon instead of a check mark, since they don't become the
  column's active view.

  The menu is portalled to <body> and positioned with `fixed`, because the
  table sits inside an overflow container that would otherwise clip it.

  Props:
    options      [{ key, label, opensWindow? }]
    activeKey    key of the option whose figures the column is currently showing
    activeLabel  short text shown under the heading (e.g. "R&D")
    onSelect     (key) => void
    onSort       () => void — called when the sort icon is clicked
    children     the sort icon, rendered next to the heading
*/
export default function MiscStockMenu({ options, activeKey, activeLabel, onSelect, onSort, children }) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setAnchorRect(btnRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  // Place the menu under the button, right-aligned to it (this column sits
  // near the right edge of the table), and keep it inside the viewport.
  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    const el = menuRef.current;
    const w = el ? el.offsetWidth : 0;
    const h = el ? el.offsetHeight : 0;
    const margin = 8;
    let left = anchorRect.right - w;
    left = Math.min(left, window.innerWidth - w - margin);
    left = Math.max(margin, left);
    const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
    const openAbove = h > spaceBelow && anchorRect.top - margin > spaceBelow;
    const top = openAbove ? Math.max(margin, anchorRect.top - h - 4) : anchorRect.bottom + 4;
    setPos({ top, left });
  }, [open, anchorRect]);

  // Dismiss on outside click, Escape, resize or scroll (the anchor moves).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="inline-flex items-center gap-0.5">
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex items-center gap-0.5 font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          title="Choose which miscellaneous stock to show"
        >
          MISC stock
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={onSort}
          className="text-muted-foreground transition-colors hover:text-foreground"
          title="Sort by this column"
        >
          {children}
        </button>
      </span>
      {activeLabel && (
        <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/80">
          {activeLabel}
        </span>
      )}

      {open &&
        anchorRect &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[9999] min-w-[190px] rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: -9999, visibility: "hidden" }}
          >
            {options.map((opt) => {
              const active = !opt.opensWindow && opt.key === activeKey;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onSelect(opt.key);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-sm normal-case tracking-normal transition-colors hover:bg-secondary ${
                    active ? "font-semibold text-foreground" : "text-foreground/90"
                  }`}
                >
                  <span>{opt.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-accent" />}
                  {opt.opensWindow && <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </span>
  );
}