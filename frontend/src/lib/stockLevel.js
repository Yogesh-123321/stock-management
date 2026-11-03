/*
  One place that decides what counts as "low stock", so the Parts table,
  its filter and any future screen (dashboard, kit issue…) agree.

  A part is low when its usable stock (quantityInStock) is below the
  threshold — zero included. Change LOW_STOCK_THRESHOLD here to move the
  line for the whole app.
*/
export const LOW_STOCK_THRESHOLD = 20;

export function isLowStock(qty) {
  const n = Number(qty ?? 0);
  return Number.isFinite(n) && n < LOW_STOCK_THRESHOLD;
}