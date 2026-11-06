import { useEffect, useMemo, useState } from "react";
import { groupIntoFamilies, splitVariant } from "@/lib/variantGroups";
import { cn } from "@/lib/utils";

/*
  Two-step picker for numbers that come in families — document-1 with its
  document-1a / document-1-b variants, or kit 12 with 12-a / 12-b.

  Step 1  lists one entry per family (the base number).
  Step 2  appears as soon as the chosen family has more than one member and
          lists every member: the base itself first, then each variant.
          A family with a single member needs no second step — it is picked
          straight away.

  items        the records to choose from
  getNumber    (item) => number/code text used to group (e.g. documentNumber)
  getValue     (item) => the value stored/emitted (default: item._id)
  getLabel     (item) => text for the second (member) dropdown — defaults to
               getNumber(item)
  value        currently selected value ("" for none)
  onChange     (value) => void
  Select classes are overridable so the picker matches the surrounding form.
*/
export default function FamilySelect({
  items,
  getNumber,
  getValue = (it) => it._id,
  getLabel,
  getFamilyLabel,
  value,
  onChange,
  placeholder = "Select…",
  memberPlaceholder = "Pick the exact one…",
  emptyLabel,
  disabled = false,
  className,
  selectClassName = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
}) {
  const families = useMemo(() => groupIntoFamilies(items, getNumber), [items, getNumber]);
  const labelOf = getLabel || getNumber;

  const familyOfValue = (val) =>
    families.find((f) => f.members.some((m) => String(getValue(m)) === String(val)))?.key || "";

  const [familyKey, setFamilyKey] = useState(() => familyOfValue(value));

  // Follow external changes (reset, resume of a saved draft, list reload).
  useEffect(() => {
    if (!value) return;
    const k = familyOfValue(value);
    if (k && k !== familyKey) setFamilyKey(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, families]);

  // The list was reloaded and the chosen family vanished.
  useEffect(() => {
    if (familyKey && !families.some((f) => f.key === familyKey)) setFamilyKey("");
  }, [families, familyKey]);

  const family = families.find((f) => f.key === familyKey) || null;
  const multi = !!family && family.members.length > 1;

  const pickFamily = (key) => {
    setFamilyKey(key);
    if (!key) return onChange?.("");
    const f = families.find((x) => x.key === key);
    // A lone entry needs no second step. For a real family, wait for the
    // person to choose which variant they mean.
    onChange?.(f && f.members.length === 1 ? String(getValue(f.members[0])) : "");
  };

  const familyText = (f) => {
    const custom = getFamilyLabel?.(f);
    if (custom) return custom;
    const n = f.members.length;
    return n > 1 ? `${f.label}  (${n} versions)` : labelOf(f.members[0]);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <select
        value={familyKey}
        disabled={disabled}
        onChange={(e) => pickFamily(e.target.value)}
        className={selectClassName}
      >
        <option className="bg-background text-foreground" value="">{families.length === 0 && emptyLabel ? emptyLabel : placeholder}</option>
        {families.map((f) => (
          <option className="bg-background text-foreground" key={f.key} value={f.key}>
            {familyText(f)}
          </option>
        ))}
      </select>

      {multi && (
        <div className="space-y-1 rounded-md border border-dashed border-border bg-secondary/40 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {family.members.length} entries under {family.label}
          </p>
          <select
            value={value || ""}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.value)}
                className={selectClassName}
          >
            <option className="bg-background text-foreground" value="">{memberPlaceholder}</option>
            {family.members.map((m) => {
              const { suffix } = splitVariant(getNumber(m));
              return (
                <option className="bg-background text-foreground" key={getValue(m)} value={getValue(m)}>
                  {labelOf(m)}
                  {suffix ? "" : "  — original"}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}