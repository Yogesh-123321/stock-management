import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Package } from "lucide-react";
import api from "@/lib/api";

export default function VendorItemsHover({ vendorId, remarks, children }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(null);
  const [show, setShow] = useState(false);
  const wrapperRef = useRef(null);

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

  const handleEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPos({ top: rect.bottom + 8, left: rect.left });
    setShow(true);
  };

  const handleLeave = () => setShow(false);

  return (
    <span ref={wrapperRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave} className="relative inline-flex items-center gap-1.5 min-w-0">
      {children}
      <Package className="h-3 w-3 text-muted-foreground opacity-60 shrink-0" />
      {show &&
        pos &&
        createPortal(
          <div
            className="z-[9999] fixed bg-card text-card-foreground border border-border rounded-md shadow-lg p-3 min-w-[260px] max-w-[360px]"
            style={{ top: pos.top, left: pos.left }}
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
