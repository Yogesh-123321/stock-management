import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import SearchableSelect from "@/components/ui/SearchableSelect";
import AlternatePartPicker from "@/components/AlternatePartPicker";
import api from "@/lib/api";
import { fmtQty } from "@/lib/utils";
import {
  PackageCheck,
  Send,
  Undo2,
  Paperclip,
  X,
  Trash2,
  Plus,
  FileText,
  ChevronDown,
  ChevronRight,
  Search,
  Boxes,
  History,
} from "lucide-react";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const ALLOWED_EXT = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".xlsx", ".xls"];
const MAX_FILES = 10;
const MAX_BYTES = 15 * 1024 * 1024;
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

const STATUS_BADGE = {
  issued: { variant: "warning", label: "With buyer" },
  partially_returned: { variant: "secondary", label: "Partly returned" },
  returned: { variant: "success", label: "Returned" },
};

/* Picks files, validating type / size / count, and shows them as removable chips. */
function FilePicker({ files, onChange, label, hint, required = false }) {
  const inputRef = useRef(null);

  const add = (picked) => {
    const next = [...files];
    for (const f of Array.from(picked || [])) {
      const ext = `.${(f.name.split(".").pop() || "").toLowerCase()}`;
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(`${f.name}: unsupported file type (use PDF, image, Word or Excel)`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 15 MB`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        toast.error(`At most ${MAX_FILES} files`);
        break;
      }
      next.push(f);
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label className={LABEL}>
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ALLOWED_EXT.join(",")}
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Paperclip className="mr-1.5 h-3.5 w-3.5" />
        {files.length ? "Add more files" : "Choose file(s)"}
      </Button>
      {hint && <span className="ml-2 text-xs text-muted-foreground">{hint}</span>}
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[220px] truncate" title={f.name}>
                {f.name}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                title="Remove"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocLinks({ docs, empty = "—" }) {
  if (!docs?.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {docs.map((d, i) => (
        <a
          key={d._id || d.url || i}
          href={d.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          title={d.fileName}
        >
          <FileText className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">{d.fileName || `Document ${i + 1}`}</span>
        </a>
      ))}
    </span>
  );
}

/* ------------------------------ Issue tab ------------------------------ */

function IssueTab({ onIssued }) {
  const [buyers, setBuyers] = useState([]);
  const [loadingBuyers, setLoadingBuyers] = useState(true);
  const [buyerId, setBuyerId] = useState("");
  const [challanNumber, setChallanNumber] = useState("");
  const [remarks, setRemarks] = useState("");
  const [challans, setChallans] = useState([]);

  const [part, setPart] = useState(null);
  const [qty, setQty] = useState("");
  const [lines, setLines] = useState([]); // [{ part, quantity }]
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get("/buyers", { params: { status: "approved" } })
      .then(({ data }) => setBuyers(Array.isArray(data) ? data : []))
      .catch(() => toast.error("Could not load buyers"))
      .finally(() => setLoadingBuyers(false));
  }, []);

  const buyerOptions = useMemo(
    () =>
      buyers.map((b) => ({
        value: b._id,
        label: b.companyName,
        sublabel: [b.taxRegistrationNo, b.contactPersonName].filter(Boolean).join(" · "),
      })),
    [buyers]
  );

  const alreadyAdded = (id) => lines.find((l) => l.part._id === id)?.quantity || 0;

  const addLine = () => {
    const quantity = Number(qty);
    if (!part) return toast.error("Choose the part first");
    if (!quantity || Number.isNaN(quantity) || quantity <= 0) return toast.error("Enter a valid quantity");
    const available = Number(part.quantityInStock || 0);
    const total = alreadyAdded(part._id) + quantity;
    if (total > available) {
      return toast.error(`Only ${fmtQty(available)} in main stock for ${part.ttUniquePartNumber}`);
    }
    setLines((cur) => {
      const i = cur.findIndex((l) => l.part._id === part._id);
      if (i === -1) return [...cur, { part, quantity }];
      const copy = [...cur];
      copy[i] = { ...copy[i], quantity: total };
      return copy;
    });
    setPart(null);
    setQty("");
  };

  const reset = () => {
    setBuyerId("");
    setChallanNumber("");
    setRemarks("");
    setChallans([]);
    setLines([]);
    setPart(null);
    setQty("");
  };

  const submit = async () => {
    if (!buyerId) return toast.error("Select the buyer");
    if (!lines.length) return toast.error("Add at least one part");
    if (!challans.length) return toast.error("Upload the challan for these samples");

    const fd = new FormData();
    fd.append("buyer", buyerId);
    fd.append("challanNumber", challanNumber.trim());
    fd.append("remarks", remarks.trim());
    fd.append("lines", JSON.stringify(lines.map((l) => ({ part: l.part._id, quantity: l.quantity }))));
    challans.forEach((f) => fd.append("challans", f));

    setSubmitting(true);
    try {
      const { data } = await api.post("/samples", fd);
      toast.success(`${data.issueCode} issued to ${data.buyerName}`);
      reset();
      onIssued?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not issue the samples");
    } finally {
      setSubmitting(false);
    }
  };

  const available = Number(part?.quantityInStock ?? 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <PackageCheck className="h-4 w-4" />
          Issue samples to a buyer
        </CardTitle>
        <CardDescription>
          Samples come out of main stock and are held as “Issued samples” until the buyer returns them. Sample
          stock can never be issued in a kit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>
              Buyer <span className="text-destructive">*</span>
            </label>
            <SearchableSelect
              options={buyerOptions}
              value={buyerId}
              onChange={setBuyerId}
              placeholder={loadingBuyers ? "Loading buyers…" : "Select buyer"}
              searchPlaceholder="Search buyers…"
              emptyText="No approved buyer matches."
            />
          </div>
          <div>
            <label className={LABEL}>Challan number</label>
            <Input
              placeholder="As written on the challan (optional)"
              value={challanNumber}
              onChange={(e) => setChallanNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-md border border-border p-3">
          <p className={LABEL}>Parts to issue as samples</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <div>
              <AlternatePartPicker
                value={part}
                onChange={setPart}
                placeholder="Search part number or description"
              />
              {part && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Main stock available:{" "}
                  <span className="font-mono-tech font-semibold text-foreground">{fmtQty(available)}</span>{" "}
                  {part.unit || ""}
                </p>
              )}
            </div>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="Quantity"
              className="font-mono-tech"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLine())}
            />
            <Button type="button" variant="outline" onClick={addLine}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          {lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">In main stock</TableHead>
                  <TableHead className="text-right">Sample qty</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.part._id}>
                    <TableCell>
                      <div className="font-mono-tech text-xs">{l.part.ttUniquePartNumber}</div>
                      <div className="text-xs text-muted-foreground">{l.part.itemDescription}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono-tech text-muted-foreground">
                      {fmtQty(l.part.quantityInStock)}
                    </TableCell>
                    <TableCell className="text-right font-mono-tech font-semibold">
                      {fmtQty(l.quantity)} {l.part.unit || ""}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Remove"
                        onClick={() => setLines((cur) => cur.filter((x) => x.part._id !== l.part._id))}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <FilePicker
          label="Challan(s)"
          required
          files={challans}
          onChange={setChallans}
          hint="PDF / image / Word / Excel, up to 15 MB each"
        />

        <div>
          <label className={LABEL}>Remarks</label>
          <Input placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={reset} disabled={submitting}>
            Clear
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            <Send className="mr-1.5 h-4 w-4" />
            {submitting ? "Issuing…" : "Issue samples"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------- Receive-back dialog ------------------------- */

function ReceiveBackDialog({ issue, onClose, onDone }) {
  const open = !!issue;
  const [qtys, setQtys] = useState({});
  const [remarks, setRemarks] = useState("");
  const [docs, setDocs] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQtys({});
    setRemarks("");
    setDocs([]);
  }, [issue?._id]);

  const outstandingLines = (issue?.lines || []).filter((l) => l.qtyOutstanding > 0);

  const submit = async () => {
    const lines = [];
    for (const l of outstandingLines) {
      const raw = qtys[l._id];
      if (raw === undefined || raw === "") continue;
      const q = Number(raw);
      if (Number.isNaN(q) || q < 0) return toast.error(`${l.ttUniquePartNumber}: invalid quantity`);
      if (q > l.qtyOutstanding) {
        return toast.error(`${l.ttUniquePartNumber}: only ${fmtQty(l.qtyOutstanding)} is still out`);
      }
      if (q > 0) lines.push({ line: l._id, quantity: q });
    }
    if (!lines.length) return toast.error("Enter the quantity received back for at least one part");

    const fd = new FormData();
    fd.append("lines", JSON.stringify(lines));
    fd.append("remarks", remarks.trim());
    docs.forEach((f) => fd.append("documents", f));

    setSaving(true);
    try {
      await api.post(`/samples/${issue._id}/return`, fd);
      toast.success("Samples received back into main stock");
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not receive the samples back");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4" /> Receive samples back
          </DialogTitle>
          <DialogDescription>
            {issue?.issueCode} · {issue?.buyerName}. Received units go back into main stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead className="text-right">Still out</TableHead>
                <TableHead className="w-[150px] text-right">Received now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outstandingLines.map((l) => (
                <TableRow key={l._id}>
                  <TableCell>
                    <div className="font-mono-tech text-xs">{l.ttUniquePartNumber}</div>
                    <div className="text-xs text-muted-foreground">{l.itemDescription}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono-tech">
                    {fmtQty(l.qtyOutstanding)} {l.unit}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        max={l.qtyOutstanding}
                        className="h-8 w-24 text-right font-mono-tech"
                        value={qtys[l._id] ?? ""}
                        onChange={(e) => setQtys((q) => ({ ...q, [l._id]: e.target.value }))}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        title="Fill the full outstanding quantity"
                        onClick={() => setQtys((q) => ({ ...q, [l._id]: String(l.qtyOutstanding) }))}
                      >
                        All
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <FilePicker
            label="Return challan / gate pass"
            files={docs}
            onChange={setDocs}
            hint="Optional"
          />
          <div>
            <label className={LABEL}>Remarks</label>
            <Input placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={saving}>
              <Undo2 className="mr-1.5 h-4 w-4" />
              {saving ? "Saving…" : "Receive back"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Issued tab ------------------------------ */

function IssuedTab({ reloadKey, onChanged }) {
  const [status, setStatus] = useState("outstanding");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [receiving, setReceiving] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/samples", { params: { status, search: term || undefined } });
      setIssues(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load issued samples");
    } finally {
      setLoading(false);
    }
  }, [status, term]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <History className="h-4 w-4" />
          Issued samples
        </CardTitle>
        <CardDescription>
          Every sample issue with its challan. Use “Receive back” when the buyer returns samples.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search code, buyer, challan, part…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="outstanding">Still with buyer</SelectItem>
              <SelectItem value="returned">Fully returned</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Issue</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Challan</TableHead>
              <TableHead className="text-right">Issued</TableHead>
              <TableHead className="text-right">Still out</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && issues.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No sample issues found.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              issues.map((i) => {
                const open = openId === i._id;
                const badge = STATUS_BADGE[i.status] || STATUS_BADGE.issued;
                return (
                  <Fragment key={i._id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpenId(open ? null : i._id)}>
                      <TableCell>
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono-tech text-xs font-semibold">{i.issueCode}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtDate(i.createdAt)}</div>
                      </TableCell>
                      <TableCell>{i.buyerName}</TableCell>
                      <TableCell className="text-xs">{i.challanNumber || "—"}</TableCell>
                      <TableCell className="text-right font-mono-tech">{fmtQty(i.totalIssued)}</TableCell>
                      <TableCell className="text-right font-mono-tech">{fmtQty(i.totalOutstanding)}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {i.status !== "returned" && (
                          <Button type="button" size="sm" variant="outline" onClick={() => setReceiving(i)}>
                            <Undo2 className="mr-1 h-3.5 w-3.5" /> Receive back
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>

                    {open && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={7} className="space-y-3 py-3">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                                <th className="py-1 font-semibold">Part</th>
                                <th className="py-1 text-right font-semibold">Issued</th>
                                <th className="py-1 text-right font-semibold">Returned</th>
                                <th className="py-1 text-right font-semibold">Still out</th>
                              </tr>
                            </thead>
                            <tbody>
                              {i.lines.map((l) => (
                                <tr key={l._id} className="border-t border-border">
                                  <td className="py-1.5">
                                    <span className="font-mono-tech text-xs">{l.ttUniquePartNumber}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">{l.itemDescription}</span>
                                  </td>
                                  <td className="py-1.5 text-right font-mono-tech">
                                    {fmtQty(l.qtyIssued)} {l.unit}
                                  </td>
                                  <td className="py-1.5 text-right font-mono-tech text-emerald-600">
                                    {fmtQty(l.qtyReturned)}
                                  </td>
                                  <td className="py-1.5 text-right font-mono-tech font-semibold">
                                    {fmtQty(l.qtyOutstanding)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className="text-xs">
                            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                              Challan{i.challans?.length > 1 ? "s" : ""}:{" "}
                            </span>
                            <DocLinks docs={i.challans} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Issued by {i.issuedBy || "—"} on {fmtDateTime(i.createdAt)}
                            {i.remarks ? ` · ${i.remarks}` : ""}
                          </div>

                          {i.returns?.length > 0 && (
                            <div className="border-t border-border pt-2">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Received back
                              </p>
                              <ul className="space-y-1.5">
                                {i.returns
                                  .slice()
                                  .reverse()
                                  .map((r) => (
                                    <li key={r._id} className="text-xs">
                                      <span className="font-medium">{fmtDateTime(r.at)}</span>
                                      {r.by ? ` · by ${r.by}` : ""} —{" "}
                                      {r.lines.map((l) => `${l.ttUniquePartNumber} × ${fmtQty(l.quantity)}`).join(", ")}
                                      {r.remarks ? ` · ${r.remarks}` : ""}
                                      {r.documents?.length > 0 && (
                                        <span className="ml-2 inline-block align-middle">
                                          <DocLinks docs={r.documents} />
                                        </span>
                                      )}
                                    </li>
                                  ))}
                              </ul>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
          </TableBody>
        </Table>
      </CardContent>

      <ReceiveBackDialog
        issue={receiving}
        onClose={() => setReceiving(null)}
        onDone={() => {
          load();
          onChanged?.();
        }}
      />
    </Card>
  );
}

/* ------------------------------ Stock tab ------------------------------ */

function StockTab({ reloadKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get("/samples/stock")
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.response?.data?.message || "Could not load sample stock"))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const term = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      !term ||
      `${r.part.ttUniquePartNumber} ${r.part.itemDescription}`.toLowerCase().includes(term) ||
      r.holders.some((h) => (h.buyerName || "").toLowerCase().includes(term))
  );
  const total = shown.reduce((s, r) => s + r.sampleStock, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <Boxes className="h-4 w-4" />
          Issued-samples stock
        </CardTitle>
        <CardDescription>
          Part-wise count of stock currently out with buyers as samples. This is not part of main stock and
          cannot be issued in any kit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search part or buyer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part</TableHead>
              <TableHead className="text-right">Main stock</TableHead>
              <TableHead className="text-right">Out as samples</TableHead>
              <TableHead>Held by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No samples are out right now.
                </TableCell>
              </TableRow>
            )}
            {shown.map((r) => (
              <TableRow key={r.part._id}>
                <TableCell>
                  <div className="font-mono-tech text-xs">{r.part.ttUniquePartNumber}</div>
                  <div className="text-xs text-muted-foreground">{r.part.itemDescription}</div>
                </TableCell>
                <TableCell className="text-right font-mono-tech text-muted-foreground">
                  {fmtQty(r.mainStock)}
                </TableCell>
                <TableCell className="text-right font-mono-tech font-semibold">
                  {fmtQty(r.sampleStock)} {r.part.unit || ""}
                </TableCell>
                <TableCell className="text-xs">
                  {r.holders.map((h, i) => (
                    <div key={`${h.issueId}-${i}`}>
                      <span className="font-medium">{h.buyerName}</span>{" "}
                      <span className="font-mono-tech text-muted-foreground">
                        × {fmtQty(h.quantity)} · {h.issueCode}
                      </span>
                    </div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
            {shown.length > 0 && (
              <TableRow className="font-semibold">
                <TableCell>Total ({shown.length} part(s))</TableCell>
                <TableCell />
                <TableCell className="text-right font-mono-tech">{fmtQty(total)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Page -------------------------------- */

export default function IssueSamples() {
  const [tab, setTab] = useState("issue");
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
          <PackageCheck className="h-5 w-5" />
          Issue samples
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue samples to buyers against a challan, track what is still out, and receive samples back.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="issue" className="gap-1.5">
            <Send className="h-3.5 w-3.5" /> Issue samples
          </TabsTrigger>
          <TabsTrigger value="issued" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Issued samples &amp; returns
          </TabsTrigger>
          <TabsTrigger value="stock" className="gap-1.5">
            <Boxes className="h-3.5 w-3.5" /> Sample stock
          </TabsTrigger>
        </TabsList>

        <TabsContent value="issue">
          <IssueTab
            onIssued={() => {
              bump();
              setTab("issued");
            }}
          />
        </TabsContent>
        <TabsContent value="issued">
          <IssuedTab reloadKey={reloadKey} onChanged={bump} />
        </TabsContent>
        <TabsContent value="stock">
          <StockTab reloadKey={reloadKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}