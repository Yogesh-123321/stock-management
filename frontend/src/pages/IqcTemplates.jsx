import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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
    v.reset();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "Copy from existing" (new-template only) — pulls another template's
  // full parameter list in as a starting point for a different material.
  // Fully independent afterwards: this never links back to the source, it's
  // just a one-time prefill, and the material name is left for the admin to
  // fill in since two templates can't share one.
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
      const payload = { materialName: form.materialName.trim(), parameters };
      if (editingId) {
        const { data } = await api.patch(`/iqc-templates/${editingId}`, payload);
        setTemplates((prev) =>
          prev
            .map((t) => (t._id === editingId ? data : t))
            .sort((a, b) => a.materialName.localeCompare(b.materialName))
        );
        toast.success(`IQC template for "${data.materialName}" updated`);
      } else {
        const { data } = await api.post("/iqc-templates", payload);
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
                  <Select value={copySourceId} onValueChange={setCopySourceId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a template to copy…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t._id} value={t._id}>
                          {t.materialName} ({t.parameters?.length || 0} parameter
                          {(t.parameters?.length || 0) === 1 ? "" : "s"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                        <div className="font-medium">{t.materialName}</div>
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
                    <div className="flex flex-wrap gap-1.5 border-t p-3">
                      {(t.parameters || []).map((p, i) => (
                        <Badge key={i} variant="secondary" className="font-normal">
                          {p.name}
                          {p.specification ? ` — ${p.specification}` : ""}
                          {p.unit ? ` (${p.unit})` : ""}
                        </Badge>
                      ))}
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