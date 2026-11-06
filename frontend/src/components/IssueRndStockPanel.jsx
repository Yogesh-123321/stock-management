import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import api from "@/lib/api";
import { FlaskConical, ChevronDown, ChevronRight, User, Undo2 } from "lucide-react";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

/*
  "Issue R&D stock" tab of the Issue kit page.

  Moves quantity out of a part's main stock into its R&D stock, against a
  named person (who is then notified). This used to live inside the Edit
  part dialog on the Parts master; it works the same way, it just starts by
  picking the part instead of being opened from one.

  Same rules as before: the person must be an active user picked from a
  dropdown, the quantity can't exceed what's in main stock, and the change
  is saved immediately (PATCH /parts/:id/rnd-stock, admin-only).
*/
export default function IssueRndStockPanel({ onIssued }) {
  const [part, setPart] = useState(null);
  const [personId, setPersonId] = useState("");
  const [qty, setQty] = useState("");
  const [remarks, setRemarks] = useState("");
  const [issuing, setIssuing] = useState(false);
  // Bumped after each successful issue so the user-wise history refreshes.
  const [historyReloadKey, setHistoryReloadKey] = useState(0);

  // Who R&D stock can be issued to — active users/admins only (not free
  // text, so notifications always land on a real account).
  const [userOptions, setUserOptions] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    api
      .get("/users")
      .then(({ data }) => {
        if (cancelled) return;
        setUserOptions((data.users || []).filter((u) => u.isActive));
      })
      .catch(() => {
        if (!cancelled) setUserOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const available = Number(part?.quantityInStock ?? 0);

  const issue = async () => {
    const quantity = Number(qty);
    if (!part) {
      toast.error("Choose the part to issue first");
      return;
    }
    if (!personId) {
      toast.error("Select the person to issue this stock to");
      return;
    }
    if (!qty || Number.isNaN(quantity) || quantity <= 0) {
      toast.error("Enter a valid quantity to issue");
      return;
    }
    if (quantity > available) {
      toast.error(`Only ${available} unit(s) available in main stock`);
      return;
    }
    setIssuing(true);
    try {
      const { data } = await api.patch(`/parts/${part._id}/rnd-stock`, {
        quantity,
        personId,
        remarks: remarks.trim(),
      });
      const issuedTo = userOptions.find((u) => u._id === personId);
      // Keep whatever the search result carried (e.g. vendors) and layer the
      // fresh stock figures + issue log on top.
      setPart((p) => ({ ...p, ...data }));
      setPersonId("");
      setQty("");
      setRemarks("");
      onIssued?.(data);
      setHistoryReloadKey((k) => k + 1);
      toast.success(
        `Issued ${quantity} unit(s) to ${issuedTo?.name || "the selected user"} — they've been notified`
      );
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not issue R&D stock");
    } finally {
      setIssuing(false);
    }
  };

  const issues = Array.isArray(part?.rndIssues) ? part.rndIssues : [];

  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <FlaskConical className="h-4 w-4" />
          Issue R&amp;D stock
        </CardTitle>
        <CardDescription>
          Moves quantity out of a part's main stock into its R&amp;D stock, against the person it's being
          issued to — who is then notified. Saved immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Part
          </label>
          <AlternatePartPicker
            value={part}
            onChange={setPart}
            placeholder="Search part number or description"
          />
        </div>

        {part && (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                <span className="text-xs text-muted-foreground">Main stock </span>
                <span className="font-mono-tech font-semibold">{available}</span>
              </span>
              <span>
                <span className="text-xs text-muted-foreground">R&amp;D stock </span>
                <span className="font-mono-tech font-semibold">{part.rndStock ?? 0}</span>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Issue to
                </label>
                <Select value={personId} onValueChange={setPersonId}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingUsers ? "Loading users…" : "Select person"} />
                  </SelectTrigger>
                  <SelectContent>
                    {userOptions.map((u) => (
                      <SelectItem key={u._id} value={u._id}>
                        {u.name} {u.role === "admin" ? "(admin)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quantity
                </label>
                <Input
                  type="number"
                  min="1"
                  max={available}
                  placeholder="Quantity"
                  className="font-mono-tech"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Remarks
                </label>
                <Input
                  placeholder="Remarks (optional)"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" disabled={issuing} onClick={issue}>
                <FlaskConical className="mr-1.5 h-4 w-4" />
                {issuing ? "Issuing…" : "Issue to R&D"}
              </Button>
            </div>

            {issues.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Already issued for this part
                </p>
                <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {issues
                    .slice()
                    .reverse()
                    .map((it, i) => (
                      <li key={it._id || i} className="flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{it.personName}</span>
                          <div className="text-[11px] text-muted-foreground">
                            {fmtDate(it.date)}
                            {it.issuedBy ? ` · by ${it.issuedBy}` : ""}
                            {it.remarks ? ` · ${it.remarks}` : ""}
                          </div>
                        </div>
                        <span className="shrink-0 text-right font-mono-tech text-xs text-muted-foreground">
                          {it.quantity}
                          {Number(it.returnedQuantity) > 0 && (
                            <span className="block text-[10px] text-emerald-600">
                              {it.returnedQuantity} returned
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    <RndIssueHistoryByUser
      reloadKey={historyReloadKey}
      onReturned={(updatedPart) => {
        // Keep the part picked above in step with the new main / R&D stock.
        setPart((p) => (p && updatedPart && p._id === updatedPart._id ? { ...p, ...updatedPart } : p));
        onIssued?.(updatedPart);
      }}
    />
    </div>
  );
}

/*
  User-wise history of R&D stock: one collapsible block per person, listing
  every part issued to them with quantity, date, who issued it and the
  remarks (if any). Covers all parts — not just the one picked above.
*/
function RndIssueHistoryByUser({ reloadKey, onReturned }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({}); // key -> bool
  const [localReload, setLocalReload] = useState(0);
  // Which issue row is being marked as returned: { issue, personName }
  const [returning, setReturning] = useState(null);
  const [retQty, setRetQty] = useState("");
  const [retRemarks, setRetRemarks] = useState("");
  const [savingReturn, setSavingReturn] = useState(false);

  const startReturn = (g, it) => {
    setReturning({ issue: it, personName: g.personName });
    setRetQty(String(it.outstandingQuantity));
    setRetRemarks("");
  };

  const confirmReturn = async () => {
    if (!returning) return;
    const { issue } = returning;
    const q = Number(retQty);
    if (!retQty || Number.isNaN(q) || q <= 0) {
      toast.error("Enter a valid quantity to return");
      return;
    }
    if (q > issue.outstandingQuantity) {
      toast.error(`Only ${issue.outstandingQuantity} unit(s) are still with ${returning.personName}`);
      return;
    }
    setSavingReturn(true);
    try {
      const { data } = await api.patch(`/parts/${issue.partId}/rnd-stock/${issue._id}/return`, {
        quantity: q,
        remarks: retRemarks.trim(),
      });
      toast.success(`Returned ${q} unit(s) of ${issue.ttUniquePartNumber} to main stock`);
      setReturning(null);
      setLocalReload((k) => k + 1);
      onReturned?.(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not mark this as returned");
    } finally {
      setSavingReturn(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get("/parts/rnd-issues-by-user", { params: { search: search.trim() || undefined } })
        .then(({ data }) => {
          if (!cancelled) setGroups(Array.isArray(data) ? data : []);
        })
        .catch((err) => {
          if (!cancelled) {
            setGroups([]);
            toast.error(err.response?.data?.message || "Could not load R&D issue history");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [reloadKey, localReload, search]);

  const keyOf = (g) => g.personId || `name:${g.personName}`;
  const isOpen = (g) => (search.trim() ? true : !!expanded[keyOf(g)]);
  const toggle = (g) => setExpanded((m) => ({ ...m, [keyOf(g)]: !m[keyOf(g)] }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <User className="h-4 w-4" />
          R&amp;D stock history — user wise
        </CardTitle>
        <CardDescription>
          Who has been issued which part from R&amp;D stock, with the quantity, date and remarks. Use
          “Mark as returned” when a part comes back — it goes back into main stock.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          placeholder="Search by person, part number, description or remarks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search.trim() ? "No R&D issues match your search." : "No R&D stock has been issued yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => {
              const open = isOpen(g);
              return (
                <div key={keyOf(g)} className="overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => toggle(g)}
                    className="flex w-full items-center justify-between gap-3 bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate font-medium">{g.personName}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {g.partCount} part{g.partCount === 1 ? "" : "s"} ·{" "}
                      <span className="font-mono-tech font-semibold text-foreground">{g.totalQuantity}</span>{" "}
                      issued
                      {g.returnedQuantity > 0 && (
                        <>
                          {" · "}
                          <span className="font-mono-tech font-semibold text-emerald-600">{g.returnedQuantity}</span>{" "}
                          returned
                        </>
                      )}
                      {" · "}
                      <span className="font-mono-tech font-semibold text-foreground">{g.outstandingQuantity}</span>{" "}
                      with them · last {fmtDate(g.lastIssuedAt)}
                    </span>
                  </button>

                  {open && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-secondary/70 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                          <tr className="border-y border-border">
                            <th className="px-3 py-1.5 font-semibold">Date</th>
                            <th className="px-3 py-1.5 font-semibold">Part</th>
                            <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
                            <th className="px-3 py-1.5 font-semibold">Issued by</th>
                            <th className="px-3 py-1.5 font-semibold">Remarks</th>
                            <th className="px-3 py-1.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.issues.map((it, i) => (
                            <tr key={it._id || i} className="border-b border-border last:border-b-0 align-top">
                              <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                                {fmtDate(it.date)}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="font-mono-tech text-xs font-semibold">{it.ttUniquePartNumber}</div>
                                <div className="text-[11px] text-muted-foreground">{it.itemDescription}</div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono-tech">
                                {it.quantity}
                                {it.unit ? ` ${it.unit}` : ""}
                              </td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{it.issuedBy || "—"}</td>
                              <td className="px-3 py-1.5 text-xs">{it.remarks || "—"}</td>
                              <td className="px-3 py-1.5 text-xs">
                                {it.outstandingQuantity > 0 ? (
                                  <div className="flex flex-col items-start gap-1">
                                    {it.returnedQuantity > 0 && (
                                      <span className="text-emerald-600">{it.returnedQuantity} returned</span>
                                    )}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => startReturn(g, it)}
                                    >
                                      <Undo2 className="mr-1 h-3 w-3" />
                                      Mark as returned
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-emerald-600">Returned</span>
                                )}
                                {(it.returns || []).map((r, ri) => (
                                  <div key={r._id || ri} className="mt-0.5 text-[11px] text-muted-foreground">
                                    {fmtDate(r.date)} · {r.quantity} back
                                    {r.returnedBy ? ` · by ${r.returnedBy}` : ""}
                                    {r.remarks ? ` · ${r.remarks}` : ""}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {returning && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-5 shadow-xl">
              <h3 className="font-display text-base font-semibold">Mark as returned</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono-tech font-semibold text-foreground">
                  {returning.issue.ttUniquePartNumber}
                </span>{" "}
                from {returning.personName}. The returned quantity is removed from R&amp;D stock and added back
                to main stock.
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quantity returned (max {returning.issue.outstandingQuantity})
                </label>
                <Input
                  type="number"
                  min="0"
                  max={returning.issue.outstandingQuantity}
                  className="font-mono-tech"
                  value={retQty}
                  onChange={(e) => setRetQty(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Remarks
                </label>
                <Input
                  placeholder="Remarks (optional)"
                  value={retRemarks}
                  onChange={(e) => setRetRemarks(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" disabled={savingReturn} onClick={() => setReturning(null)}>
                  Cancel
                </Button>
                <Button type="button" disabled={savingReturn} onClick={confirmReturn}>
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  {savingReturn ? "Saving…" : "Mark as returned"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}