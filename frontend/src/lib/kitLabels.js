// Shared by the kit pickers (Issue kit, Kit templates "copy from").
// The code is the number that carries the -a / -b suffix; templates without
// one fall back to their name, so "Kit 12" / "Kit 12-a" still group.
export const kitNumberOf = (t) => (t?.kitCode && t.kitCode.trim()) || t?.kitName || "";

export const kitOptionLabel = (t) =>
  `${t.kitName || ""}${t.kitCode ? ` (${t.kitCode})` : ""}`.trim();