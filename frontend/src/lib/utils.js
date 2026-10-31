import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Display-only quantity formatter: whole numbers stay as they are, decimals are
// shown to at most 2 places (2.5 -> 2.5, 2.256 -> 2.26, 3.000 -> 3). The stored
// value is never changed -- use this only where a quantity is rendered.
export function fmtQty(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}