import { cn } from "@/lib/utils";
import { formatScalar, humanizeKey, isObjectId } from "@/lib/activityFormat";

/*
  Shows what was recorded for an action (the request details kept in the log's
  `meta`) the way a person would want to read it:

    - friendly field names      supplierGSTIN  ->  "Supplier GSTIN"
    - formatted values          5400 -> ₹5,400.00, true -> Yes, ISO dates -> 12 Mar 2026
    - lists of lines as a table (PO items, kit lines, …)
    - internal database ids hidden (they mean nothing to a reader)

  The untouched JSON is still available on the "Technical" tab.
*/

const MAX_DEPTH = 3;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isHiddenKey = (k) => k.startsWith("_") || k === "id" || k === "__v";

function isEmpty(v) {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.every(isEmpty);
  if (isPlainObject(v)) return Object.entries(v).every(([k, x]) => isHiddenKey(k) || isEmpty(x));
  return false;
}

const isComplex = (v) => Array.isArray(v) ? v.some((x) => isPlainObject(x)) : isPlainObject(v);

function Scalar({ k, v }) {
  const { text, tone } = formatScalar(k, v);
  if (tone) {
    return (
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[11px] font-medium",
          tone === "yes" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
        )}
      >
        {text}
      </span>
    );
  }
  return <span className="whitespace-pre-line break-words">{text}</span>;
}

function ListOfRecords({ rows }) {
  const records = rows.filter(isPlainObject);
  // Only columns that actually carry something readable.
  const columns = [];
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      if (isHiddenKey(k) || columns.includes(k)) continue;
      if (records.some((r) => !isEmpty(r[k]) && !isObjectId(r[k]))) columns.push(k);
    }
  }
  if (!columns.length) return <p className="text-xs text-muted-foreground">No readable details.</p>;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/60 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">#</th>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">
                {humanizeKey(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((rec, i) => (
            <tr key={i} className="border-t border-border/60 align-top">
              <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
              {columns.map((c) => {
                const v = rec[c];
                return (
                  <td key={c} className="px-2 py-1">
                    {isEmpty(v) || isObjectId(v) ? (
                      <span className="text-muted-foreground">—</span>
                    ) : isPlainObject(v) || Array.isArray(v) ? (
                      <span className="text-muted-foreground">
                        {Object.values(v)
                          .filter((x) => !isEmpty(x) && !isObjectId(x) && typeof x !== "object")
                          .map((x) => formatScalar(c, x).text)
                          .join(", ") || "—"}
                      </span>
                    ) : (
                      <Scalar k={c} v={v} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fields({ data, depth = 0 }) {
  const entries = Object.entries(data).filter(([k, v]) => !isHiddenKey(k) && !isEmpty(v));
  const linked = entries.filter(([, v]) => isObjectId(v)).length;
  const visible = entries.filter(([, v]) => !isObjectId(v));
  const simple = visible.filter(([, v]) => !isComplex(v));
  const nested = visible.filter(([, v]) => isComplex(v));

  return (
    <div className="space-y-3">
      {simple.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {simple.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {humanizeKey(k)}
              </dt>
              <dd className="text-sm">
                {Array.isArray(v) ? (
                  v
                    .filter((x) => !isEmpty(x) && !isObjectId(x))
                    .map((x) => formatScalar(k, x).text)
                    .join(", ") || "—"
                ) : (
                  <Scalar k={k} v={v} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {nested.map(([k, v]) => (
        <div key={k}>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {humanizeKey(k)}
            {Array.isArray(v) ? ` (${v.filter((x) => !isEmpty(x)).length})` : ""}
          </p>
          {Array.isArray(v) ? (
            <ListOfRecords rows={v} />
          ) : depth >= MAX_DEPTH ? (
            <p className="text-xs text-muted-foreground">(details not shown)</p>
          ) : (
            <div className="rounded-md border border-border p-3">
              <Fields data={v} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}

      {linked > 0 && depth === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Also linked to {linked} other record{linked === 1 ? "" : "s"} (internal IDs hidden).
        </p>
      )}
    </div>
  );
}

export default function ActivityPayload({ meta }) {
  if (!isPlainObject(meta) || isEmpty(meta)) {
    return (
      <p className="text-sm text-muted-foreground">
        No extra details were recorded for this action.
      </p>
    );
  }
  return <Fields data={meta} />;
}