import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VendorSearchSelect from "@/components/VendorSearchSelect";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "@/components/ui/table";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  PackageOpen,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  History,
  Undo2,
} from "lucide-react";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/* ------------------------------------------------------------------ *
 * Recent issues, newest first, with an undo (revert one line's worth
 * of stock) action — mirrors the part history ledger's undo.
 * ------------------------------------------------------------------ */
function RecentIssues({ reloadKey, canManage }) {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/kits/issues", { params: { limit: 25 } });
      setIssues(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load recent kit issues");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  // An issue can carry lines for several parts — for a single-line issue
  // just confirm and go; for a multi-part one, ask which TT part number
  // to revert (Part history's own ledger is the fuller line-by-line view).
  const revertLine = async (issue) => {
    const lines = issue.lines || [];
    if (lines.length === 0) return;
    let line = lines[0];
    if (lines.length > 1) {
      const choice = window.prompt(
        `This issue has ${lines.length} parts:\n` +
          lines.map((l, i) => `${i + 1}. ${l.ttUniquePartNumber} (${l.qtyIssued} unit(s))`).join("\n") +
          "\n\nEnter the number of the line to revert:"
      );
      const idx = Number(choice) - 1;
      if (!choice || !Number.isInteger(idx) || idx < 0 || idx >= lines.length) return;
      line = lines[idx];
    } else {
      const ok = window.confirm(
        `Revert ${line.ttUniquePartNumber} (${line.qtyIssued} unit(s)) from this issue? Stock will be restored.`
      );
      if (!ok) return;
    }
    setBusyId(line._id);
    try {
      await api.delete(`/kits/issues/${issue._id}/lines/${line._id}`);
      toast.success("Line reverted — stock restored");
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not revert this line");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-display flex items-center gap-2">
          <History className="h-4 w-4" />
          Recent kit issues
        </CardTitle>
        <CardDescription>Newest first — the last 25 kits issued to vendors.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Date</TableHead>
              <TableHead>Kit</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="w-[60px] text-right">Qty</TableHead>
              <TableHead className="w-[130px]">Issued by</TableHead>
              {canManage && <TableHead className="w-[70px] text-right">Undo</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableEmpty colSpan={canManage ? 6 : 5}>Loading…</TableEmpty>}
            {!loading && issues.length === 0 && (
              <TableEmpty colSpan={canManage ? 6 : 5}>No kits issued yet.</TableEmpty>
            )}
            {!loading &&
              issues.map((iss) => (
                <TableRow key={iss._id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDateTime(iss.createdAt)}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <p className="truncate font-medium">{iss.kitName}</p>
                    {iss.kitCode && (
                      <p className="truncate text-xs text-muted-foreground font-mono-tech">
                        {iss.kitCode}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="truncate">{iss.vendor?.companyName || "—"}</TableCell>
                  <TableCell className="text-right font-mono-tech">{iss.quantity}</TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate">
                    {iss.issuedBy || "—"}
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Revert a line from this issue"
                        onClick={() => revertLine(iss)}
                        disabled={!iss.lines?.length || busyId !== null}
                      >
                        <Undo2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Undo reverts one line's quantity back onto the part's stock. Open a part's own history from
          the Parts master for full line-by-line control when an issue has several parts.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export default function IssueKit() {
  const { can } = useAuth();
  const canManage = can?.("kit.manage");

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [template, setTemplate] = useState(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const [quantity, setQuantity] = useState("1");
  const [vendor, setVendor] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shortages, setShortages] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Per-item override for "qty actually being issued", keyed by
  // ttUniquePartNumber. A part with no entry here just falls back to the
  // auto default (min of available stock and required qty) shown in the
  // input. Cleared whenever a new template is chosen or after a submit.
  const [issueQtyOverrides, setIssueQtyOverrides] = useState({});

  useEffect(() => {
    api
      .get("/kits", { params: { activeOnly: 1 } })
      .then(({ data }) => setTemplates(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(err.response?.data?.message || "Could not load kit templates"));
  }, []);

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      return;
    }
    setLoadingTemplate(true);
    setShortages(null);
    setIssueQtyOverrides({});
    api
      .get(`/kits/${templateId}`)
      .then(({ data }) => setTemplate(data))
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not load that kit template");
        setTemplate(null);
      })
      .finally(() => setLoadingTemplate(false));
  }, [templateId]);

  const issuableItems = useMemo(
    () => (template?.items || []).filter((it) => !it.dnp),
    [template]
  );

  const qtyNum = Number(quantity) || 0;

  const preview = useMemo(
    () =>
      issuableItems.map((it) => {
        const required = (it.qtyPerKit || 0) * qtyNum;
        const available = it.matchedPart?.quantityInStock ?? 0;
        const ok = !!it.matchedPart && available >= required;
        const defaultToIssue = Math.min(available, required);
        return { ...it, required, available, ok, defaultToIssue };
      }),
    [issuableItems, qtyNum]
  );

  const hasShortfall = preview.some((p) => !p.ok);

  // The qty currently shown/used for a row: whatever the user typed for
  // that part, or the auto default (min of available, required) if they
  // haven't touched it yet.
  const qtyToIssueFor = (p) => {
    const override = issueQtyOverrides[p.ttUniquePartNumber];
    return override === undefined || override === "" ? p.defaultToIssue : Number(override);
  };

  const setQtyToIssueFor = (ttUniquePartNumber, value) => {
    setIssueQtyOverrides((prev) => ({ ...prev, [ttUniquePartNumber]: value }));
  };

  const resetAfterIssue = () => {
    setQuantity("1");
    setVendor(null);
    setRemarks("");
    setTemplateId("");
    setTemplate(null);
    setIssueQtyOverrides({});
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!template) {
      toast.error("Choose a kit template first");
      return;
    }
    if (!qtyNum || qtyNum < 1) {
      toast.error("Quantity must be a whole number of at least 1");
      return;
    }
    if (!vendor) {
      toast.error("Select the vendor this kit is being issued to");
      return;
    }
    if (vendor.status !== "approved") {
      toast.error("This vendor is still awaiting approval — it can't be issued to yet");
      return;
    }
    if ((vendor.activeStatus || "active") === "inactive") {
      toast.error("This vendor is marked inactive — it can't be issued to");
      return;
    }

    // Validate the per-line qty-to-issue overrides before sending: each
    // must be a non-negative whole number and can never exceed what's
    // actually in stock for that part.
    const linesPayload = [];
    for (const p of preview) {
      const q = qtyToIssueFor(p);
      if (!Number.isFinite(q) || q < 0 || !Number.isInteger(q)) {
        toast.error(`Qty being issued for ${p.ttUniquePartNumber} must be a whole number of 0 or more`);
        return;
      }
      if (q > p.available) {
        toast.error(
          `Qty being issued for ${p.ttUniquePartNumber} (${q}) can't exceed available stock (${p.available})`
        );
        return;
      }
      linesPayload.push({ ttUniquePartNumber: p.ttUniquePartNumber, qtyIssued: q });
    }

    setSubmitting(true);
    setShortages(null);
    try {
      const { data } = await api.post(`/kits/${template._id}/issue`, {
        quantity: qtyNum,
        vendor: vendor._id,
        remarks,
        lines: linesPayload,
      });
      const shortLines = (data.lines || []).filter((l) => (l.qtyShort || 0) > 0);
      if (shortLines.length > 0) {
        toast.error(
          `Issued ${qtyNum} × "${template.kitName}" — ${shortLines.length} part(s) were short and only partially deducted`,
          { duration: 6000 }
        );
      } else {
        toast.success(
          `Issued ${qtyNum} × "${template.kitName}" to ${data.vendor?.companyName || "the vendor"}`
        );
      }
      resetAfterIssue();
      if (shortLines.length > 0) setShortages(shortLines);
      setReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not issue this kit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <PackageOpen className="h-5 w-5" />
          Issue kit
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a kit template, enter the quantity, and it's checked against live stock before anything
          is deducted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Issue a kit</CardTitle>
          <CardDescription>
            A short kit is still issued — whatever stock is available gets deducted, and any
            shortfall is logged against the kit's issue history for follow-up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Kit template
                </label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a kit…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        {t.kitName} {t.kitCode ? `(${t.kitCode})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templates.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No active kit templates yet — ask an admin to create one under "Kits".
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Quantity to issue
                </label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  className="font-mono-tech"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Issue to vendor
                </label>
                <VendorSearchSelect
                  value={vendor}
                  onSelect={setVendor}
                  placeholder="Start typing the vendor name…"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Remarks (optional)
                </label>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
            </div>

            {loadingTemplate && (
              <p className="text-sm text-muted-foreground">Loading kit items…</p>
            )}

            {!loadingTemplate && template && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {hasShortfall ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Short on stock for {qtyNum || 0} kit(s) — will issue with shortfall logged
                    </Badge>
                  ) : (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Stock covers {qtyNum || 0} kit(s)
                    </Badge>
                  )}
                  <span className="text-muted-foreground">
                    {issuableItems.length} issuable item(s)
                    {template.items.length !== issuableItems.length
                      ? ` · ${template.items.length - issuableItems.length} DNP (excluded)`
                      : ""}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/70">
                      <tr className="border-b border-border">
                        {["TT part #", "Description", "Qty/kit", "Required", "Available", "Qty issuing", "Status"].map(
                          (h) => (
                            <th
                              key={h}
                              className="px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                      {preview.map((p) => (
                        <tr key={p._id} className="border-b border-border">
                          <td className="px-2.5 py-1.5 text-xs font-mono-tech">
                            {p.ttUniquePartNumber}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs">
                            {p.matchedPart?.itemDescription || (
                              <span className="text-amber-700">not in parts master</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.qtyPerKit}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.required}
                          </td>
                          <td className="px-2.5 py-1.5 text-xs text-right font-mono-tech">
                            {p.available}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max={p.available}
                              step="1"
                              className="h-7 w-20 ml-auto font-mono-tech text-xs text-right"
                              value={
                                issueQtyOverrides[p.ttUniquePartNumber] ?? String(p.defaultToIssue)
                              }
                              onChange={(e) => setQtyToIssueFor(p.ttUniquePartNumber, e.target.value)}
                            />
                          </td>
                          <td className="px-2.5 py-1.5">
                            {p.ok ? (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                OK
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <XCircle className="h-3 w-3" />
                                Short
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {shortages && shortages.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <p className="mb-1.5 flex items-center gap-1.5 font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Kit issued, but {shortages.length} part(s) were short — only available stock was
                  deducted:
                </p>
                <ul className="ml-5 list-disc space-y-0.5 text-muted-foreground">
                  {shortages.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono-tech">{s.ttUniquePartNumber}</span> — needed{" "}
                      {s.qtyRequired}, issued {s.qtyIssued} (short {s.qtyShort})
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-muted-foreground">
                  This shortfall is recorded against the kit issue — see the kit's issue history.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || !template}>
                <Send className="mr-1.5 h-4 w-4" />
                {submitting ? "Issuing…" : "Issue kit"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <RecentIssues reloadKey={reloadKey} canManage={canManage} />
    </div>
  );
}