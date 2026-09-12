import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

/*
  Category ("PART 2" of the TT UNIQUE PART NUMBER) picker — used on every
  screen where a new part can be registered: the "request a new part
  number" form, the admin's edit-request / edit-part popups, and both the
  manual and vendor-sheet-import rows in the receiving flow.

  Rather than each of those hard-coding the abbreviation list, this pulls
  it from /api/part-categories, so it always shows exactly the predefined
  set (RS, RT, AY, SY ...) plus anything an admin has since added from the
  "Part categories" utility — add one there and it shows up here the very
  next time this dropdown is opened, with no other code changes.

  The description for whichever category is selected is shown right below
  the box, so the person doesn't have to already know what "CNPR" means.
*/
export default function CategorySelect({
  value,
  onChange,
  triggerClassName = "",
  placeholder = "Select category",
  disabled = false,
}) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/part-categories");
        if (!cancelled) setCategories(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = categories.find(
    (c) => c.code.toUpperCase() === String(value || "").toUpperCase()
  );

  return (
    <div className="space-y-1">
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger className={triggerClassName || undefined}>
          <SelectValue placeholder={loading ? "Loading…" : placeholder} />
        </SelectTrigger>
        {/* The shared <SelectContent> defaults to z-50, which is fine on a
            plain page but sits BELOW every "new part" dialog in this app
            (z-[120] / z-[130] — see Parts.jsx). Since Radix portals this
            list to document.body, outside the dialog's own DOM subtree, a
            lower z-index there means the list paints behind the dialog
            overlay — it opens, but is invisible/unclickable. z-[200]
            clears every dialog z-index currently in use. */}
        <SelectContent className="z-[200]">
          {categories.map((c) => (
            <SelectItem key={c._id} value={c.code}>
              {c.code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <p className="text-[11px] text-muted-foreground">{selected.description}</p>
      )}
      {!loading && !selected && value && (
        <p className="text-[11px] text-amber-700">
          “{value}” isn't in the predefined category list.
        </p>
      )}
    </div>
  );
}