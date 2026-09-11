import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import KitImportPanel from "@/pages/kitImportPanel";
import {
  Layers,
  Plus,
  Search,
  Pencil,
  Trash2,
  FileSpreadsheet,
  X,
  Save,
  ListPlus,
  Power,
  History,
} from "lucide-react";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/* Blank row shape for the manual item editor — mirrors sanitizeItem() on
   the backend (kitController.js) so nothing gets silently dropped on save. */
const blankItem = () => ({
  _key: Math.random().toString(36).slice(2),
  srNo: "",
  referenceDesignator: "",
  value: "",
  partType: "",
  ttUniquePartNumber: "",
  manufacturerPartNumber: "",
  manufacturer: "",
  footprint: "",
  qtyPerKit: "",
  dnp: false,
  remarks: "",
});

/* Normalizes rows coming back from either GET /kits/:id (matchedPart
   attached server-side) or the Excel import parser (same row shape) into
   the editor's row shape, keyed for stable table rendering. */
const toEditorRows = (items = []) =>
  items.map((it) => ({
    _key: Math.random().toString(36).slice(2),
    srNo: it.srNo ?? "",
    referenceDesignator: it.referenceDesignator || "",
    value: it.value || "",
    partType: it.partType || "",
    ttUniquePartNumber: it.ttUniquePartNumber || "",
    manufacturerPartNumber: it.manufacturerPartNumber || "",
    manufacturer: it.manufacturer || "",
    footprint: it.footprint || "",
    qtyPerKit: it.qtyPerKit ?? "",
    dnp: !!it.dnp,
    remarks: it.remarks || "",
    matchedPart: it.matchedPart || null,
  }));

/* ------------------------------------------------------------------ *
 * Create / edit a kit template — manual item table, with an "Import
 * from Excel" shortcut that drops parsed rows straight into the same
 * table for review before Save is ever pressed.
 * ------------------------------------------------------------------ */
function KitEditor({ template, onClose, onSaved }) {
  const isEdit = !!template?._id;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [kitName, setKitName] = useState(template?.kitName || "");
  const [kitCode, setKitCode] = useState(template?.kitCode || "");
  const [revision, setRevision] = useState(template?.revision || "");
  const [description, setDescription] = useState(template?.description || "");
  const [items, setItems] = useState(isEdit ? [] : [blankItem()]);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    api
      .get(`/kits/${template._id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setKitName(data.kitName || "");
        setKitCode(data.kitCode || "");
        setRevision(data.revision || "");
        setDescription(data.description || "");
        setItems(toEditorRows(data.items));
      })
      .catch((err) => {
        toast.error(err.response?.data?.message || "Could not load this kit template");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?._id]);

  const setItem = (key, field, value) =>
    setItems((rows) => rows.map((r) => (r._key === key ? { ...r, [field]: value } : r)));

  const addRow = () => setItems((rows) => [...rows, blankItem()]);
  const removeRow = (key) => setItems((rows) => rows.filter((r) => r._key !== key));

  const handleImported = (parsed) => {
    // Fill the kit name/code from the sheet only if the admin hasn't
    // already typed something in — never silently overwrite their input.
    if (parsed.kitName && !kitName.trim()) setKitName(parsed.kitName);
    if (parsed.kitCode && !kitCode.trim()) setKitCode(parsed.kitCode);
    setItems(toEditorRows(parsed.rows));
    setShowImport(false);
    toast.success(`${parsed.rows.length} row(s) loaded into the item table — review before saving`);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!kitName.trim()) {
      toast.error("Kit name is required");
      return;
    }
    const usableItems = items.filter(
      (r) => r.ttUniquePartNumber.trim() || r.referenceDesignator.trim() || r.value.trim()
    );
    if (usableItems.length === 0) {
      toast.error("Add at least one item to the kit");
      return;
    }
    for (const r of usableItems) {
      if (!r.ttUniquePartNumber.trim()) {
        toast.error("Every item needs a TT unique part number — that's what stock is matched against");
        return;
      }
      if (r.qtyPerKit === "" || Number(r.qtyPerKit) < 0) {
        toast.error(`Qty per kit for ${r.ttUniquePartNumber} must be a non-negative number`);
        return;
      }
    }

    const payload = {
      kitName: kitName.trim(),
      kitCode,
      revision,
      description,
      items: usableItems.map((r) => ({
        srNo: r.srNo === "" ? null : Number(r.srNo),
        referenceDesignator: r.referenceDesignator,
        value: r.value,
        partType: r.partType,
        ttUniquePartNumber: r.ttUniquePartNumber,
        manufacturerPartNumber: r.manufacturerPartNumber,
        manufacturer: r.manufacturer,
        footprint: r.footprint,
        qtyPerKit: Number(r.qtyPerKit),
        dnp: !!r.dnp,
        remarks: r.remarks,
      })),
    };

    setSaving(true);
    try {
      const { data } = isEdit
        ? await api.patch(`/kits/${template._id}`, payload)
        : await api.post("/kits", payload);
      toast.success(isEdit ? "Kit template updated" : "Kit template created");
      onSaved?.(data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the kit template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-accent" />
              {isEdit ? "Edit kit template" : "New kit template"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Items are matched to stock purely by TT unique part number.
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Kit name
                  </label>
                  <Input value={kitName} onChange={(e) => setKitName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Revision
                  </label>
                  <Input value={revision} onChange={(e) => setRevision(e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Kit / document code
                  </label>
                  <Input
                    className="font-mono-tech"
                    value={kitCode}
                    onChange={(e) => setKitCode(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Description (optional)
                  </label>
                  <Textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Items ({items.length})</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowImport(true)}>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                    Import from Excel
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={addRow}>
                    <ListPlus className="h-3.5 w-3.5 mr-1.5" />
                    Add row
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/70">
                    <tr className="border-b border-border">
                      {[
                        "Ref.",
                        "Value",
                        "TT part #",
                        "Mfr part #",
                        "Qty/kit",
                        "DNP",
                        "Match",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50">
                    {items.map((r) => (
                      <tr key={r._key} className="border-b border-border align-top">
                        <td className="px-1.5 py-1 w-[110px]">
                          <Input
                            className="h-8 text-xs"
                            value={r.referenceDesignator}
                            onChange={(e) => setItem(r._key, "referenceDesignator", e.target.value)}
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[110px]">
                          <Input
                            className="h-8 text-xs"
                            value={r.value}
                            onChange={(e) => setItem(r._key, "value", e.target.value)}
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[150px]">
                          <Input
                            className="h-8 text-xs font-mono-tech"
                            value={r.ttUniquePartNumber}
                            onChange={(e) =>
                              setItem(r._key, "ttUniquePartNumber", e.target.value.toUpperCase())
                            }
                            placeholder="required"
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[130px]">
                          <Input
                            className="h-8 text-xs"
                            value={r.manufacturerPartNumber}
                            onChange={(e) => setItem(r._key, "manufacturerPartNumber", e.target.value)}
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[80px]">
                          <Input
                            type="number"
                            min="0"
                            className="h-8 text-xs font-mono-tech"
                            value={r.qtyPerKit}
                            onChange={(e) => setItem(r._key, "qtyPerKit", e.target.value)}
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[50px] text-center">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={r.dnp}
                            onChange={(e) => setItem(r._key, "dnp", e.target.checked)}
                          />
                        </td>
                        <td className="px-1.5 py-1 w-[110px]">
                          {!r.ttUniquePartNumber ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : r.matchedPart ? (
                            <Badge variant="success">Matched</Badge>
                          ) : (
                            <Badge variant="warning">Not in master</Badge>
                          )}
                        </td>
                        <td className="px-1.5 py-1 text-right">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRow(r._key)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                DNP (Do Not Populate) rows are kept for reference but never checked against stock or
                deducted when the kit is issued.
              </p>
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                <Save className="mr-1.5 h-4 w-4" />
                {saving ? "Saving…" : isEdit ? "Save changes" : "Create kit template"}
              </Button>
            </div>
          </form>
        )}
      </div>

      {showImport && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <KitImportPanel onImported={handleImported} onClose={() => setShowImport(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Issue history for one template — opened from its row.
 * ------------------------------------------------------------------ */
function TemplateIssuesDialog({ template, onClose }) {
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/kits/${template._id}/issues`)
      .then(({ data }) => {
        if (!cancelled) setIssues(Array.isArray(data) ? data : []);
      })
      .catch((err) => toast.error(err.response?.data?.message || "Could not load issue history"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [template._id]);

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-accent" />
              Issue history — {template.kitName}
            </h2>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>}
          {!loading && issues.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              This kit hasn't been issued yet.
            </p>
          )}
          {!loading && issues.length > 0 && (
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="w-[60px] text-right">Qty</TableHead>
                  <TableHead className="w-[110px]">Issued by</TableHead>
                  <TableHead className="w-[90px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((iss) => {
                  const shortLines = (iss.lines || []).filter((l) => (l.qtyShort || 0) > 0);
                  return (
                    <TableRow key={iss._id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(iss.createdAt)}
                      </TableCell>
                      <TableCell>{iss.vendor?.companyName || "—"}</TableCell>
                      <TableCell className="text-right font-mono-tech">{iss.quantity}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {iss.issuedBy || "—"}
                      </TableCell>
                      <TableCell>
                        {shortLines.length > 0 ? (
                          <Badge
                            variant="destructive"
                            className="gap-1"
                            title={shortLines
                              .map((l) => `${l.ttUniquePartNumber}: short ${l.qtyShort}`)
                              .join(", ")}
                          >
                            {shortLines.length} short
                          </Badge>
                        ) : (
                          <Badge variant="success">Full</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Kits() {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...} = edit
  const [viewingIssues, setViewingIssues] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/kits", { params: search ? { search } : {} });
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load kit templates");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggleActive = async (tpl) => {
    setBusyId(tpl._id);
    try {
      const { data } = await api.patch(`/kits/${tpl._id}`, { isActive: !tpl.isActive });
      setTemplates((list) => list.map((t) => (t._id === tpl._id ? { ...t, ...data } : t)));
      toast.success(data.isActive ? "Kit template activated" : "Kit template deactivated");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the kit template");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (tpl) => {
    const ok = window.confirm(
      `Delete kit template "${tpl.kitName}"? Past issues keep their own record either way.`
    );
    if (!ok) return;
    setBusyId(tpl._id);
    try {
      await api.delete(`/kits/${tpl._id}`);
      toast.success("Kit template deleted");
      setTemplates((list) => list.filter((t) => t._id !== tpl._id));
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not delete the kit template");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Kits</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length} kit template(s) · items are matched to stock by TT unique part number
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search kit name or code"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => setEditing({})}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New kit
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Kit templates</CardTitle>
          <CardDescription>
            Created here, then used from the "Issue kit" screen to check stock and issue to a vendor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Kit name</TableHead>
                <TableHead className="w-[140px]">Code</TableHead>
                <TableHead className="w-[70px]">Rev.</TableHead>
                <TableHead className="w-[70px] text-right">Items</TableHead>
                <TableHead className="w-[190px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={5}>Loading…</TableEmpty>}
              {!loading && templates.length === 0 && (
                <TableEmpty colSpan={5}>
                  {search.trim() ? `No kit matches “${search.trim()}”.` : "No kit templates yet."}
                </TableEmpty>
              )}
              {!loading &&
                templates.map((t) => (
                  <TableRow key={t._id}>
                    <TableCell className="font-medium">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{t.kitName}</span>
                        {t.isActive ? (
                          <Badge variant="success" className="shrink-0">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono-tech text-xs text-muted-foreground">
                      {t.kitCode || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.revision || "—"}</TableCell>
                    <TableCell className="text-right font-mono-tech">{t.itemCount ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="Issue history"
                          onClick={() => setViewingIssues(t)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title={t.isActive ? "Deactivate" : "Activate"}
                          disabled={busyId === t._id}
                          onClick={() => toggleActive(t)}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="Edit kit"
                          onClick={() => setEditing(t)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          title="Delete kit"
                          disabled={busyId === t._id}
                          onClick={() => handleDelete(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing !== null && (
        <KitEditor
          template={editing._id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(saved) =>
            setTemplates((list) =>
              list.some((t) => t._id === saved._id)
                ? list.map((t) => (t._id === saved._id ? { ...t, ...saved } : t))
                : [saved, ...list]
            )
          }
        />
      )}

      {viewingIssues && (
        <TemplateIssuesDialog template={viewingIssues} onClose={() => setViewingIssues(null)} />
      )}
    </div>
  );
}