import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  ClipboardCheck,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  ListPlus,
  ChevronDown,
  ChevronUp,
  Copy,
  Paperclip,
  Upload,
} from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SearchableSelect from "@/components/ui/SearchableSelect";
import FieldError from "@/components/FieldError";
import IqcReferenceViewer from "@/components/IqcReferenceViewer";
import { useFormValidation } from "@/lib/useFormValidation";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fileNameFromUrl = (url) => (url ? decodeURIComponent(String(url).split("/").pop().split("?")[0]) : "");

const blankParameter = () => ({
  _key: Math.random().toString(36).slice(2),
  name: "",
  specification: "",
  unit: "",
});

const blankForm = () => ({ materialName: "", parameters: [blankParameter()] });

const TEMPLATE_SCHEMA = {
  materialName: { required: true, requiredMessage: "Material name is required", maxLength: 150 },
};

/*
  ADMIN ONLY (gated by "iqc.manage" in App.jsx / Layout.jsx).

  Lets the admin define, for a given material, the checklist of
  parameters that must be verified during Incoming Quality Control —
  e.g. for "Aluminium Enclosure": dimensions, surface finish, paint
  thickness. Every other page (receiving / inspection flow) can read
  GET /iqc-templates to show the right checklist for the material being
  received, but only an admin can create, edit or remove a template.

  A template can also carry one optional reference image/PDF (e.g. an
  approved-sample photo or a drawing) — it's shown alongside the checklist
  at IQC approval/rejection time (see IqcReportForm.jsx) as a visual
  comparison against what was actually received.
*/
export default function IqcTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = create mode
  const [copySourceId, setCopySourceId] = useState("");
  const v = useFormValidation(TEMPLATE_SCHEMA);

  // Reference image/PDF for the form currently being edited/created.
  const [referenceFile, setReferenceFile] = useState(null); // newly chosen File
  const [existingReference, setExistingReference] = useState(null); // { url, name } already saved (edit mode)
  const [removeExistingReference, setRemoveExistingReference] = useState(false);
  const referenceInputId = "iqc-template-reference-file";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/iqc-templates");
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load IQC templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setForm(blankForm());
    setEditingId(null);
    setCopySourceId("");
    setReferenceFile(null);
    setExistingReference(null);
    setRemoveExistingReference(false);
    v.reset();
  };

  const startEdit = (template) => {
    setEditingId(template._id);
    setCopySourceId("");
    setForm({
      materialName: template.materialName,
      parameters:
        template.parameters?.length > 0
          ? template.parameters.map((p) => ({ ...p, _key: Math.random().toString(36).slice(2) }))
          : [blankParameter()],
    });
    setReferenceFile(null);
    setExistingReference(
      template.referenceFileUrl
        ? { url: template.referenceFileUrl, name: template.referenceFileName || fileNameFromUrl(template.referenceFileUrl) }
        : null
    );
    setRemoveExistingReference(false);
    v.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "Copy from existing" (new-template only) — pulls another template's
  // full parameter list in as a starting point for a different material.
  // Fully independent afterwards: this never links back to the source, it's
  // just a one-time prefill, and the material name is left for the admin to
  // fill in since two templates can't share one. The reference file is
  // intentionally not copied — a different material needs its own photo.
  const copyFromTemplate = (id) => {
    const source = templates.find((t) => t._id === id);
    if (!source) return;
    setForm((f) => ({
      materialName: f.materialName,
      parameters:
        source.parameters?.length > 0
          ? source.parameters.map((p) => ({ ...p, _key: Math.random().toString(36).slice(2) }))
          : [blankParameter()],
    }));
    toast.success(`Copied the checklist from "${source.materialName}" — enter the material name and review before saving`);
    setCopySourceId("");
  };

  // Options for the "copy from" search dropdown — searchable so a long
  // template list doesn't have to be scanned by eye.
  const copyOptions = useMemo(
    () =>
      templates.map((t) => ({
        value: t._id,
        label: t.materialName,
        sublabel: `${t.parameters?.length || 0} parameter${(t.parameters?.length || 0) === 1 ? "" : "s"}`,
      })),
    [templates]
  );

  const addParameterRow = () => {
    setForm((f) => ({ ...f, parameters: [...f.parameters, blankParameter()] }));
  };

  const removeParameterRow = (key) => {
    setForm((f) => ({
      ...f,
      parameters: f.parameters.length > 1 ? f.parameters.filter((p) => p._key !== key) : f.parameters,
    }));
  };

  const updateParameterRow = (key, field, value) => {
    setForm((f) => ({
      ...f,
      parameters: f.parameters.map((p) => (p._key === key ? { ...p, [field]: value } : p)),
    }));
  };

  const handleReferenceFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setReferenceFile(file);
    if (file) setRemoveExistingReference(false);
  };

  const clearChosenReferenceFile = () => setReferenceFile(null);

  // Only (re)created when the chosen file actually changes, and revoked
  // afterwards, so we don't leak a fresh blob: URL on every render.
  const referenceFilePreviewUrl = useMemo(
    () => (referenceFile ? URL.createObjectURL(referenceFile) : null),
    [referenceFile]
  );
  useEffect(() => {
    return () => {
      if (referenceFilePreviewUrl) URL.revokeObjectURL(referenceFilePreviewUrl);
    };
  }, [referenceFilePreviewUrl]);

  const submit = async (e) => {
    e.preventDefault();
    if (!v.validateAll(form)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    const parameters = form.parameters
      .map((p) => ({
        name: p.name.trim(),
        specification: p.specification.trim(),
        unit: p.unit.trim(),
      }))
      .filter((p) => p.name);

    if (parameters.length === 0) {
      toast.error("Add at least one parameter with a name");
      return;
    }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("materialName", form.materialName.trim());
      fd.append("parameters", JSON.stringify(parameters));
      if (referenceFile) fd.append("referenceFile", referenceFile);
      if (editingId && removeExistingReference && !referenceFile) {
        fd.append("removeReferenceFile", "true");
      }

      if (editingId) {
        const { data } = await api.patch(`/iqc-templates/${editingId}`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setTemplates((prev) =>
          prev
            .map((t) => (t._id === editingId ? data : t))
            .sort((a, b) => a.materialName.localeCompare(b.materialName))
        );
        toast.success(`IQC template for "${data.materialName}" updated`);
      } else {
        const { data } = await api.post("/iqc-templates", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setTemplates((prev) =>
          [...prev, data].sort((a, b) => a.materialName.localeCompare(b.materialName))
        );
        toast.success(`IQC template created for "${data.materialName}"`);
      }
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the IQC template");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template) => {
    if (!window.confirm(`Remove the IQC template for "${template.materialName}"?`)) return;
    try {
      await api.delete(`/iqc-templates/${template._id}`);
      setTemplates((prev) => prev.filter((t) => t._id !== template._id));
      if (editingId === template._id) resetForm();
      toast.success(`IQC template for "${template.materialName}" removed`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not remove the IQC template");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" />
            {editingId ? "Edit IQC template" : "Create IQC template"}
          </CardTitle>
          <CardDescription>
            Enter the material this checklist applies to, then list every parameter that must be
            checked for it during Incoming Quality Control. Only an admin can create or change
            these templates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {!editingId && templates.length > 0 && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-2.5">
                <div className="min-w-[220px] flex-1">
                  <Label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Copy from an existing template (optional)
                  </Label>
                  <SearchableSelect
                    options={copyOptions}
                    value={copySourceId}
                    onChange={setCopySourceId}
                    placeholder="Choose a template to copy…"
                    searchPlaceholder="Search templates…"
                    emptyText="No template matches."
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!copySourceId}
                  onClick={() => copyFromTemplate(copySourceId)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy into this form
                </Button>
              </div>
            )}

            <div className="max-w-sm space-y-1.5">
              <Label>Material name</Label>
              <Input
                value={form.materialName}
                onChange={(e) => setForm((f) => ({ ...f, materialName: e.target.value }))}
                onBlur={() => v.handleBlur("materialName", form.materialName, form)}
                placeholder="e.g. Aluminium Enclosure"
              />
              <FieldError error={v.fieldError("materialName")} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Parameters to check</Label>
                <Button type="button" size="sm" variant="outline" onClick={addParameterRow}>
                  <ListPlus className="mr-1 h-3.5 w-3.5" />
                  Add parameter
                </Button>
              </div>

              <div className="space-y-2">
                {form.parameters.map((p, idx) => (
                  <div
                    key={p._key}
                    className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-start"
                  >
                    <div className="space-y-1">
                      <Input
                        value={p.name}
                        onChange={(e) => updateParameterRow(p._key, "name", e.target.value)}
                        placeholder={`Parameter ${idx + 1} name — e.g. Surface finish`}
                        className="h-8 text-sm"
                      />
                    </div>
                    <Input
                      value={p.specification}
                      onChange={(e) => updateParameterRow(p._key, "specification", e.target.value)}
                      placeholder="Specification / acceptance criteria (optional)"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={p.unit}
                      onChange={(e) => updateParameterRow(p._key, "unit", e.target.value)}
                      placeholder="Unit (optional)"
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeParameterRow(p._key)}
                      disabled={form.parameters.length === 1}
                      title="Remove parameter"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Reference image / PDF (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Attach an approved-sample photo, drawing or spec sheet. It will be shown next to the
                checklist when this material is inspected, so it can be compared against what was
                actually received.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" asChild>
                  <label htmlFor={referenceInputId} className="cursor-pointer">
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {referenceFile || existingReference ? "Replace file" : "Choose file"}
                  </label>
                </Button>
                <input
                  id={referenceInputId}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleReferenceFileChange}
                />

                {referenceFile && (
                  <span className="flex items-center gap-1.5 text-xs text-warning">
                    <Paperclip className="h-3.5 w-3.5" />
                    Will save {referenceFile.name}
                    <button
                      type="button"
                      onClick={clearChosenReferenceFile}
                      className="text-muted-foreground hover:text-foreground"
                      title="Cancel this file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}

                {!referenceFile && existingReference && !removeExistingReference && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Paperclip className="h-3.5 w-3.5" />
                    Current: {existingReference.name}
                    <button
                      type="button"
                      onClick={() => setRemoveExistingReference(true)}
                      className="text-destructive underline"
                    >
                      Remove
                    </button>
                  </span>
                )}

                {!referenceFile && existingReference && removeExistingReference && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive">
                    Current file will be removed on save.
                    <button
                      type="button"
                      onClick={() => setRemoveExistingReference(false)}
                      className="text-muted-foreground underline"
                    >
                      Undo
                    </button>
                  </span>
                )}
              </div>

              {(referenceFile || (existingReference && !removeExistingReference)) && (
                <IqcReferenceViewer
                  url={referenceFile ? referenceFilePreviewUrl : existingReference.url}
                  label="Preview"
                  fileLabel={referenceFile ? referenceFile.name : existingReference.name}
                  height="260px"
                  className="max-w-md"
                />
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saving}>
                {editingId ? <Save className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
                {saving ? "Saving…" : editingId ? "Save changes" : "Create template"}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All IQC templates</CardTitle>
          <CardDescription>{templates.length} material(s) with an IQC checklist defined</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && templates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No IQC templates yet — create one above.
            </p>
          )}
          {!loading &&
            templates.map((t) => {
              const isExpanded = expandedId === t._id;
              return (
                <div key={t._id} className="rounded-md border">
                  <div className="flex items-center justify-between gap-2 p-3">
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 text-left"
                      onClick={() => setExpandedId(isExpanded ? null : t._id)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <div>
                        <div className="flex items-center gap-1.5 font-medium">
                          {t.materialName}
                          {t.referenceFileUrl && (
                            <span title="Has a reference file">
                              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.parameters?.length || 0} parameter
                          {(t.parameters?.length || 0) === 1 ? "" : "s"} · added {fmtDate(t.createdAt)}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="icon" variant="ghost" onClick={() => startEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => remove(t)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="space-y-3 border-t p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(t.parameters || []).map((p, i) => (
                          <Badge key={i} variant="secondary" className="font-normal">
                            {p.name}
                            {p.specification ? ` — ${p.specification}` : ""}
                            {p.unit ? ` (${p.unit})` : ""}
                          </Badge>
                        ))}
                      </div>
                      {t.referenceFileUrl && (
                        <IqcReferenceViewer
                          url={t.referenceFileUrl}
                          label="Reference image/PDF"
                          fileLabel={t.referenceFileName}
                          height="280px"
                          className="max-w-md"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}