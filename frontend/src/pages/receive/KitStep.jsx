import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PackageOpen, PackagePlus, Plus, Search, Trash2, Loader2, ArrowRight, ArrowLeft, Boxes, RotateCcw } from "lucide-react";
import api from "@/lib/api";
import { SortableHead, useSort } from "@/components/SortableHead";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useFamilyRows } from "@/lib/useFamilyRows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");
const num = (n) => Number(n) || 0;
const r3 = (n) => Math.round(num(n) * 1000) / 1000;
const show = (n) => r3(n).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/* Small part picker used for the "new parts" rows (searches the Parts master). */
function PartPicker({ onPick }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = term.trim();
    if (!t) {
      setResults([]);
      return undefined;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const { data } = await api.get("/parts", { params: { search: t } });
        setResults(Array.isArray(data) ? data.slice(0, 12) : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [term]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search part number or description"
        className="h-9 pl-8"
        autoComplete="off"
      />
      {open && term.trim() && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {searching && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
            </p>
          )}
          {!searching && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matching part in the Parts master. A part number that doesn't exist yet can be requested in the Stock
              entry step.
            </p>
          )}
          {results.map((p) => (
            <button
              key={p._id}
              type="button"
              className="block w-full border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-secondary"
              onClick={() => {
                onPick(p);
                setOpen(false);
                setTerm("");
              }}
            >
              <span className="font-mono text-xs">{p.ttUniquePartNumber}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.itemDescription}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

let rowKey = 0;

export default function KitStep({ vendor, sessionId, onDone, onSkip, onChangeVendor }) {
  const [answer, setAnswer] = useState(null); // null | "yes"
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]); // kit issue ids
  // Issued kits fold into families: 12, 12-A, 12-B share one row until expanded.
  const kitFam = useFamilyRows(kits, (k) => k.issueCode, {});
  const [returnQty, setReturnQty] = useState({}); // partId -> string
  const [produced, setProduced] = useState([]); // { key, part, quantity, unit, price }
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState(0); // kit lines already booked on this delivery

  // Kit lines already added to this delivery (coming back here via "Back").
  useEffect(() => {
    if (!sessionId) return;
    api
      .get("/stock-entries", { params: { receivingSession: sessionId } })
      .then(({ data }) => setExisting((Array.isArray(data) ? data : []).filter((e) => e.kitLink?.kind).length))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (answer !== "yes") return;
    setLoading(true);
    api
      .get("/kits/returnable", { params: { vendor: vendor._id } })
      .then(({ data }) => setKits(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.response?.data?.message || "Could not load the kits issued to this vendor"))
      .finally(() => setLoading(false));
  }, [answer, vendor._id]);

  const toggleKit = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // One row per part across every selected kit.
  const partRows = useMemo(() => {
    const map = new Map();
    for (const k of kits.filter((x) => selected.includes(x._id))) {
      for (const l of k.lines) {
        const row = map.get(l.part._id) || { part: l.part, issued: 0, returned: 0, returnable: 0 };
        row.issued += l.issued;
        row.returned += l.returned;
        row.returnable += l.returnable;
        map.set(l.part._id, row);
      }
    }
    return [...map.values()].sort((a, b) => a.part.ttUniquePartNumber.localeCompare(b.part.ttUniquePartNumber));
  }, [kits, selected]);

  const { sort, toggle, apply } = useSort();
  const sortedPartRows = apply(partRows, {
    part: (r) => r.part.ttUniquePartNumber,
    issued: (r) => Number(r.issued),
    returned: (r) => Number(r.returned),
    returnable: (r) => Number(r.returnable),
    now: (r) => {
      const v = returnQty[r.part._id];
      return v === undefined || v === "" ? null : Number(v);
    },
  });

  const fillAll = () =>
    setReturnQty(Object.fromEntries(partRows.filter((r) => r.returnable > 0).map((r) => [r.part._id, String(r3(r.returnable))])));

  const overLimit = partRows.some((r) => num(returnQty[r.part._id]) > r.returnable + 0.0005);
  const returnedCount = partRows.filter((r) => num(returnQty[r.part._id]) > 0).length;
  const producedReady = produced.filter((p) => p.part && num(p.quantity) > 0);
  const producedIncomplete = produced.some((p) => !p.part || !(num(p.quantity) > 0));
  const canSave = selected.length > 0 && (returnedCount > 0 || producedReady.length > 0) && !overLimit && !producedIncomplete;

  const addProduced = (part) =>
    setProduced((prev) => [
      ...prev,
      { key: ++rowKey, part, quantity: "", unit: part?.unit || "", price: part?.price != null ? String(part.price) : "" },
    ]);
  const patchProduced = (key, patch) => setProduced((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/kits/return-lines", {
        receivingSession: sessionId,
        kitIssues: selected,
        returned: partRows
          .filter((r) => num(returnQty[r.part._id]) > 0)
          .map((r) => ({ part: r.part._id, quantity: num(returnQty[r.part._id]) })),
        produced: producedReady.map((p) => ({
          part: p.part._id,
          quantity: num(p.quantity),
          unit: p.unit,
          price: p.price === "" ? null : num(p.price),
        })),
      });
      toast.success(
        `Added ${data.returnedCount} returned part line(s) and ${data.producedCount} new part line(s) to this delivery`
      );
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not add the kit lines");
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- the question ---------------- */
  if (answer !== "yes") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" /> Is this inward stock against an issued kit?
          </CardTitle>
          <CardDescription>
            {vendor.companyName} may be sending back unused parts of a kit we issued to them, along with new parts made
            from it. Say yes to enter the returned quantities and the new parts here; otherwise carry on as a normal
            delivery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {existing > 0 && (
            <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs">
              {existing} kit line{existing === 1 ? "" : "s"} already added to this delivery — they appear in the Stock
              entry step, where they can be edited or removed.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAnswer("yes")}
              className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary hover:bg-secondary/50"
            >
              <PackageOpen className="mb-2 h-6 w-6 text-primary" />
              <p className="font-medium">Yes — against issued kit(s)</p>
              <p className="text-xs text-muted-foreground">Enter returned quantities and any new parts made from the kit.</p>
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-lg border border-border p-4 text-left transition-colors hover:border-primary hover:bg-secondary/50"
            >
              <ArrowRight className="mb-2 h-6 w-6 text-primary" />
              <p className="font-medium">{existing > 0 ? "No more — continue" : "No — regular delivery"}</p>
              <p className="text-xs text-muted-foreground">Go on to the purchase order step.</p>
            </button>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm" onClick={onChangeVendor}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Change vendor
          </Button>
        </CardFooter>
      </Card>
    );
  }

  /* ---------------- kit details ---------------- */
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>1 · Which kit(s) is this against?</CardTitle>
          <CardDescription>
            Kits issued to {vendor.companyName}. Select one or more — returned quantities are checked against the total
            issued across all you select.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading kits…
            </p>
          ) : kits.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No kit has been issued to {vendor.companyName}. Go back and continue as a regular delivery.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {kitFam.rows.map(({ row: k, ...entry }) => {
                const on = selected.includes(k._id);
                const hasVariants = entry.depth === 0 && entry.count > 1;
                return (
                  <li key={k._id} className={cn(entry.depth > 0 && "sm:col-span-2 sm:ml-6")}>
                    {hasVariants && (
                      <button
                        type="button"
                        onClick={() => kitFam.toggle(entry.key)}
                        aria-expanded={entry.isOpen}
                        className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", entry.isOpen && "rotate-90")} />
                        {entry.isOpen ? "Hide" : "Show"} {entry.count - 1} other version{entry.count - 1 === 1 ? "" : "s"} (
                        {k.issueCode} …)
                      </button>
                    )}
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                        on ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"
                      )}
                    >
                      <input type="checkbox" className="mt-1" checked={on} onChange={() => toggleKit(k._id)} />
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium">
                          {k.issueCode} · {k.kitName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {k.quantity} kit{k.quantity === 1 ? "" : "s"} · issued {fmtDate(k.createdAt)} · {k.lines.length}{" "}
                          parts
                        </span>
                        <span className={cn("block text-xs", k.returnableTotal > 0 ? "text-emerald-700" : "text-muted-foreground")}>
                          {k.returnableTotal > 0 ? `${show(k.returnableTotal)} units can still come back` : "Everything already returned"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>2 · Returned quantities</CardTitle>
              <CardDescription>
                Enter how much of each issued part came back. Leave blank (or 0) for parts that were not returned.
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="outline" onClick={fillAll}>
                Fill all with balance
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setReturnQty({})}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Part" sortKey="part" sort={sort} onSort={toggle} />
                  <SortableHead label="Issued" sortKey="issued" sort={sort} onSort={toggle} className="w-[90px]" align="right" />
                  <SortableHead label="Already returned" sortKey="returned" sort={sort} onSort={toggle} className="w-[110px]" align="right" />
                  <SortableHead label="Can return" sortKey="returnable" sort={sort} onSort={toggle} className="w-[100px]" align="right" />
                  <SortableHead label="Returned now" sortKey="now" sort={sort} onSort={toggle} className="w-[130px]" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPartRows.map((r) => {
                  const v = returnQty[r.part._id] ?? "";
                  const bad = num(v) > r.returnable + 0.0005;
                  return (
                    <TableRow key={r.part._id}>
                      <TableCell>
                        <span className="font-mono text-xs">{r.part.ttUniquePartNumber}</span>
                        <span className="block max-w-xs truncate text-xs text-muted-foreground">{r.part.itemDescription}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {show(r.issued)} {r.part.unit}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{show(r.returned)}</TableCell>
                      <TableCell className="text-right text-xs font-medium tabular-nums">{show(r.returnable)}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          max={r.returnable}
                          disabled={r.returnable <= 0}
                          value={v}
                          onChange={(e) => setReturnQty((p) => ({ ...p, [r.part._id]: e.target.value }))}
                          className={cn("ml-auto h-8 w-24 text-right text-sm", bad && "border-destructive")}
                          aria-label={`Returned quantity of ${r.part.ttUniquePartNumber}`}
                        />
                        {bad && <p className="mt-0.5 text-[10px] text-destructive">Max {show(r.returnable)}</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {selected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" /> 3 · New parts received from this kit
            </CardTitle>
            <CardDescription>
              Optional — parts that came out of the kit (for example assembled boards). Search the Parts master and
              enter the quantity received.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {produced.map((p) => (
              <div key={p.key} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_110px_90px_110px_auto] sm:items-end">
                <div className="min-w-0">
                  <Label className="text-xs">Part</Label>
                  {p.part ? (
                    <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3 text-sm">
                      <span className="font-mono text-xs">{p.part.ttUniquePartNumber}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">{p.part.itemDescription}</span>
                    </div>
                  ) : (
                    <PartPicker
                      onPick={(part) =>
                        patchProduced(p.key, { part, unit: part.unit || "", price: part.price != null ? String(part.price) : "" })
                      }
                    />
                  )}
                </div>
                <div>
                  <Label className="text-xs">Quantity *</Label>
                  <Input
                    type="number"
                    min="0.001"
                    step="any"
                    className="h-9"
                    value={p.quantity}
                    onChange={(e) => patchProduced(p.key, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Unit</Label>
                  <Input className="h-9" value={p.unit} onChange={(e) => patchProduced(p.key, { unit: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Rate (₹)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="h-9"
                    value={p.price}
                    onChange={(e) => patchProduced(p.key, { price: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setProduced((prev) => prev.filter((x) => x.key !== p.key))}
                  aria-label="Remove this part"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addProduced(null)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add a new part
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => setAnswer(null)} disabled={saving}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="flex items-center gap-3">
          {selected.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {returnedCount} returned part{returnedCount === 1 ? "" : "s"} · {producedReady.length} new part
              {producedReady.length === 1 ? "" : "s"}
            </p>
          )}
          <Button onClick={save} disabled={!canSave || saving}>
            {saving ? "Adding…" : "Add to delivery & continue"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        These become normal inward lines: they are listed in the Stock entry step, covered by the tax invoice, and go
        through IQC before reaching stock.
      </p>
    </div>
  );
}