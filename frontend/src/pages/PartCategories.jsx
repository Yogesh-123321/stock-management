import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Tags, Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from "@/components/ui/table";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";

const CATEGORY_SCHEMA = {
  code: { required: true, requiredMessage: "Category code is required", regex: "categoryCode" },
  description: { required: true, requiredMessage: "Description is required", maxLength: 150 },
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/*
  ADMIN ONLY (gated by "part.approve" in App.jsx / Layout.jsx).

  This is the utility referenced everywhere the category dropdown shows
  up (new part requests, admin part edit, receiving flow, excel import):
  add a category here and it's immediately available in every one of
  those pickers — no code change, no redeploy.

  Editing an existing category's code renames it everywhere: the backend
  re-points every part currently filed under the old code to the new one
  (Part.category only — each part's TT UNIQUE PART NUMBER is left exactly
  as it was assigned).
*/
export default function PartCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ code: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ code: "", description: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const v = useFormValidation(CATEGORY_SCHEMA);
  const vEdit = useFormValidation(CATEGORY_SCHEMA);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/part-categories");
      setCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load part categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!v.validateAll(form)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post("/part-categories", {
        code: form.code.trim(),
        description: form.description.trim(),
      });
      setCategories((prev) => [...prev, data].sort((a, b) => a.code.localeCompare(b.code)));
      setForm({ code: "", description: "" });
      v.reset();
      toast.success(`Category "${data.code}" added — it now shows up in the category picker`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not add the category");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (category) => {
    if (!window.confirm(`Remove category "${category.code}"?`)) return;
    try {
      await api.delete(`/part-categories/${category._id}`);
      setCategories((prev) => prev.filter((c) => c._id !== category._id));
      toast.success(`Category "${category.code}" removed`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not remove the category");
    }
  };

  const startEdit = (category) => {
    setEditingId(category._id);
    setEditForm({ code: category.code, description: category.description });
    vEdit.reset();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ code: "", description: "" });
    vEdit.reset();
  };

  const saveEdit = async (category) => {
    if (!vEdit.validateAll(editForm)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setSavingEdit(true);
    try {
      const { data } = await api.patch(`/part-categories/${category._id}`, {
        code: editForm.code.trim(),
        description: editForm.description.trim(),
      });
      setCategories((prev) =>
        prev.map((c) => (c._id === category._id ? data : c)).sort((a, b) => a.code.localeCompare(b.code))
      );
      const codeChanged = data.code !== category.code;
      if (codeChanged && data.partsUpdated > 0) {
        toast.success(
          `Category code updated to "${data.code}" — ${data.partsUpdated} part${
            data.partsUpdated === 1 ? "" : "s"
          } moved to it (part numbers unchanged)`
        );
      } else {
        toast.success(`Category "${data.code}" updated`);
      }
      cancelEdit();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the category");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4" />
            Part categories
          </CardTitle>
          <CardDescription>
            The predefined list shown wherever a new part is registered — request a new part
            number, admin part edits, and the receiving / excel-import flow. Add a category below
            and it appears in every one of those pickers right away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label>Category code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                onBlur={() => v.handleBlur("code", form.code, form)}
                placeholder="e.g. FR"
                maxLength={10}
              />
              <FieldError error={v.fieldError("code")} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                onBlur={() => v.handleBlur("description", form.description, form)}
                placeholder="e.g. Ferrite Bead"
              />
              <FieldError error={v.fieldError("description")} />
            </div>
            <Button type="submit" disabled={saving}>
              <Plus className="mr-1 h-4 w-4" />
              {saving ? "Adding…" : "Add category"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All categories</CardTitle>
          <CardDescription>{categories.length} categories in the list</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[130px]">Added</TableHead>
                <TableHead className="w-[90px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={4}>Loading…</TableEmpty>}
              {!loading && categories.length === 0 && (
                <TableEmpty colSpan={4}>No categories yet — add one above.</TableEmpty>
              )}
              {!loading &&
                categories.map((c) => {
                  const isEditing = editingId === c._id;
                  return (
                    <TableRow key={c._id}>
                      <TableCell className="font-mono-tech">
                        {isEditing ? (
                          <>
                            <Input
                              value={editForm.code}
                              onChange={(e) =>
                                setEditForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                              }
                              onBlur={() => vEdit.handleBlur("code", editForm.code, editForm)}
                              className="h-8 text-xs font-mono-tech"
                              maxLength={10}
                            />
                            <FieldError error={vEdit.fieldError("code")} />
                          </>
                        ) : (
                          c.code
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <>
                            <Input
                              value={editForm.description}
                              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                              onBlur={() => vEdit.handleBlur("description", editForm.description, editForm)}
                              className="h-8 text-xs"
                            />
                            <FieldError error={vEdit.fieldError("description")} />
                          </>
                        ) : (
                          c.description
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={savingEdit}
                              onClick={() => saveEdit(c)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={savingEdit}
                              onClick={cancelEdit}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button type="button" size="icon" variant="ghost" onClick={() => startEdit(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" size="icon" variant="ghost" onClick={() => remove(c)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}