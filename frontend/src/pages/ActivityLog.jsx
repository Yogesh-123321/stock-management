import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  AlertTriangle,
  Download,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { value: "all", label: "All sections" },
  { value: "po", label: "Purchase orders" },
  { value: "pi", label: "Proforma invoices" },
  { value: "part", label: "Parts" },
  { value: "vendor", label: "Vendors" },
  { value: "buyer", label: "Buyers" },
  { value: "stock", label: "Stock" },
  { value: "receiving", label: "Material receiving" },
  { value: "invoice", label: "Tax invoices" },
  { value: "user", label: "Users" },
  { value: "auth", label: "Sign in / out" },
  { value: "other", label: "Other" },
];

const SECTION_TONE = {
  po: "bg-blue-100 text-blue-700",
  pi: "bg-violet-100 text-violet-700",
  part: "bg-amber-100 text-amber-700",
  vendor: "bg-emerald-100 text-emerald-700",
  buyer: "bg-teal-100 text-teal-700",
  stock: "bg-indigo-100 text-indigo-700",
  receiving: "bg-cyan-100 text-cyan-700",
  invoice: "bg-rose-100 text-rose-700",
  user: "bg-slate-200 text-slate-700",
  auth: "bg-slate-100 text-slate-600",
  other: "bg-slate-100 text-slate-600",
};

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const relative = (d) => {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

function Tile({ label, value, sub, tone = "bg-card", icon: Icon }) {
  return (
    <Card className={cn("flex items-center gap-3 px-3 py-2.5", tone)}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-70" /> : null}
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight">{value}</div>
        <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
    </Card>
  );
}

export default function ActivityLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [detail, setDetail] = useState(null);

  const [filters, setFilters] = useState({
    q: "",
    user: "",
    entityType: "all",
    result: "all",
    from: "",
    to: "",
  });
  const [search, setSearch] = useState("");

  // Debounce the free-text box so it filters as you type.
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const query = useMemo(() => {
    const params = { page, limit: 50 };
    if (filters.q) params.q = filters.q;
    if (filters.user) params.user = filters.user;
    if (filters.entityType !== "all") params.entityType = filters.entityType;
    if (filters.result !== "all") params.result = filters.result;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    return params;
  }, [filters, page]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/activity-logs", { params: query });
      setRows(data.rows || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load the activity log");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const [s, f] = await Promise.all([
          api.get("/activity-logs/summary", { params: { days: 7 } }),
          api.get("/activity-logs/filters"),
        ]);
        setSummary(s.data);
        setUsers(f.data.users || []);
      } catch {
        /* the table already reports load failures */
      }
    })();
  }, []);

  const exportCsv = async () => {
    try {
      const { data } = await api.get("/activity-logs/export", {
        params: query,
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Export failed");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setFilters({ q: "", user: "", entityType: "all", result: "all", from: "", to: "" });
    setPage(1);
  };

  const anyFilter =
    filters.q || filters.user || filters.entityType !== "all" || filters.result !== "all" ||
    filters.from || filters.to;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Activity className="h-5 w-5" /> Activity log
          </h1>
          <p className="text-sm text-muted-foreground">
            Every action taken in the system — who did what, when, and whether it went through.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
          <Button size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Last 7 days at a glance */}
      {summary ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Tile label="Actions (7 days)" value={summary.total} icon={Activity} />
          <Tile
            label="Failed attempts"
            value={summary.failed}
            icon={AlertTriangle}
            tone={summary.failed ? "bg-rose-50" : "bg-card"}
          />
          {summary.perUser.slice(0, 4).map((u) => (
            <Tile
              key={u.userId || u.userName}
              label={u.userName}
              value={u.count}
              sub={`${u.userRole || "user"} · ${relative(u.lastAt)}`}
              icon={ShieldCheck}
            />
          ))}
        </div>
      ) : null}

      {/* Filters */}
      <Card className="space-y-2 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, action, reference…"
              className="h-9 pl-8"
            />
          </div>

          <select
            value={filters.user}
            onChange={(e) => {
              setFilters((f) => ({ ...f, user: e.target.value }));
              setPage(1);
            }}
            className="h-9 rounded-md border bg-card px-2 text-sm"
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u._id} value={u._id}>
                {u.name || u.username} {u.role === "admin" ? "(admin)" : ""}
              </option>
            ))}
          </select>

          <select
            value={filters.entityType}
            onChange={(e) => {
              setFilters((f) => ({ ...f, entityType: e.target.value }));
              setPage(1);
            }}
            className="h-9 rounded-md border bg-card px-2 text-sm"
          >
            {SECTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={filters.result}
            onChange={(e) => {
              setFilters((f) => ({ ...f, result: e.target.value }));
              setPage(1);
            }}
            className="h-9 rounded-md border bg-card px-2 text-sm"
          >
            <option value="all">Any result</option>
            <option value="success">Successful</option>
            <option value="failed">Failed</option>
          </select>

          <Input
            type="date"
            value={filters.from}
            onChange={(e) => {
              setFilters((f) => ({ ...f, from: e.target.value }));
              setPage(1);
            }}
            className="h-9 w-[150px]"
          />
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => {
              setFilters((f) => ({ ...f, to: e.target.value }));
              setPage(1);
            }}
            className="h-9 w-[150px]"
          />

          {anyFilter ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-4 w-4" /> Clear
            </Button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> {total} entries
            </span>
          )}
        </div>
      </Card>

      {/* Log table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Activity</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    Loading activity…
                  </td>
                </tr>
              ) : null}
              {!loading && !rows.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                    No activity matches these filters.
                  </td>
                </tr>
              ) : null}
              {rows.map((r, i) => (
                <tr
                  key={r._id}
                  className={cn(
                    "border-t transition-colors hover:bg-accent/40",
                    i % 2 === 1 && "bg-muted/30"
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                    <div>{fmtDateTime(r.createdAt)}</div>
                    <div className="text-[11px] text-muted-foreground">{relative(r.createdAt)}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{r.userName || "—"}</div>
                    <div className="text-[11px] uppercase text-muted-foreground">
                      {r.userRole || ""}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        SECTION_TONE[r.entityType] || SECTION_TONE.other
                      )}
                    >
                      {r.entityType}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div>{r.description || r.action}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.action}</div>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-1.5 text-xs">
                    {r.entityLabel || "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        r.success ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      )}
                    >
                      {r.success ? "OK" : `Failed ${r.statusCode || ""}`}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                      Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            Page {page} of {pages} · {total} entries
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {/* Detail drawer */}
      {detail ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDetail(null)}
        >
          <Card
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="font-semibold">{detail.description || detail.action}</div>
                <div className="text-xs text-muted-foreground">
                  {detail.userName} · {fmtDateTime(detail.createdAt)}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
              <dl className="grid grid-cols-2 gap-2">
                {[
                  ["Action", detail.action],
                  ["Section", detail.entityType],
                  ["Reference", detail.entityLabel || "—"],
                  ["Method", detail.method],
                  ["Endpoint", detail.path],
                  ["Status", `${detail.statusCode || "—"} (${detail.success ? "OK" : "failed"})`],
                  ["Duration", detail.durationMs != null ? `${detail.durationMs} ms` : "—"],
                  ["IP address", detail.ip || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] uppercase text-muted-foreground">{k}</dt>
                    <dd className="break-all">{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <div>
                <div className="mb-1 text-[11px] uppercase text-muted-foreground">Payload</div>
                <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-[11px]">
                  {JSON.stringify(detail.meta || {}, null, 2)}
                </pre>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
