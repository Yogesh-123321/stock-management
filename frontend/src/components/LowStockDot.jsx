import { LOW_STOCK_THRESHOLD, isLowStock } from "@/lib/stockLevel";
import { fmtQty } from "@/lib/utils";

/*
  Small red blinking dot shown next to a part's stock quantity when it's
  below LOW_STOCK_THRESHOLD (lib/stockLevel.js). Renders nothing otherwise.

    <LowStockDot qty={part.quantityInStock} />

  The blink is a CSS ping ring behind a solid dot. It only animates when the
  person hasn't asked their device to reduce motion; the solid red dot (and
  the tooltip / screen-reader text) still show either way.
*/
export default function LowStockDot({ qty, className = "" }) {
  if (!isLowStock(qty)) return null;
  const label =
    Number(qty ?? 0) <= 0
      ? `Out of stock (below ${LOW_STOCK_THRESHOLD})`
      : `Low stock — only ${fmtQty(qty)} left (below ${LOW_STOCK_THRESHOLD})`;
  return (
    <span className={`relative inline-flex h-2.5 w-2.5 shrink-0 ${className}`} title={label} role="img" aria-label={label}>
      <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
    </span>
  );
}