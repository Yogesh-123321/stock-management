import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  FolderOpen,
  LogIn,
  RefreshCw,
  Search,
  ShieldCheck,
  User as UserIcon,
  Users as UsersIcon,
  UserX,
  X,
} from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SortableHead, useSort } from "@/components/SortableHead";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import ActivityDetailDialog from "@/components/ActivityDetailDialog";
import ActivityDocumentPreview from "@/components/ActivityDocumentPreview";
import { PERMISSIONS } from "@/lib/permissions";
import {
  SECTION_LABEL,
  docKindLabel,
  fmtDate,
  fmtDateTime,
  inr,
  relativeTime,
  resolveDocRef,
} from "@/lib/activityFormat";

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                */
/* ------------------------------------------------------------------ */

const RANGES = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 6 months" },
];

const SECTION_TONE = {
  po: "bg-blue-100 text-blue-700",
  pi: "bg-violet-100 text-violet-700",
  part: "bg-amber-100 text-amber-700",
  vendor: "bg-emerald-100 text-emerald-700",
  buyer: "bg-teal-100 text-teal-700",
  stock: "bg-indigo-100 text-indigo-700",
  kit: "bg-orange-100 text-orange-700",
  payment: "bg-lime-100 text-lime-700",
  receiving: "bg-cyan-100 text-cyan-700",
  invoice: "bg-rose-100 text-rose-700",
  user: "bg-slate-200 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

const SECTION_BAR = {
  po: "bg-blue-500",
  pi: "bg-violet-500",
  part: "bg-amber-500",
  vendor: "bg-emerald-500",
  buyer: "bg-teal-500",
  stock: "bg-indigo-500",
  kit: "bg-orange-500",
  payment: "bg-lime-500",
  receiving: "bg-cyan-500",
  invoice: "bg-rose-500",
  user: "bg-slate-500",
  other: "bg-slate-400",
};

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

const actionLabel = (a = "") => {
  const [seg, verb] = String(a).split(".");
  const nice = (s) => String(s || "").replace(/-/g, " ");
  return verb ? `${nice(seg)} · ${nice(verb)}` : nice(seg);
};

const hourLabel = (h) => {
  const x = h % 12 === 0 ? 12 : h % 12;
  return `${x} ${h < 12 ? "AM" : "PM"}`;
};

const shortDay = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

function browserOf(ua = "") {
  const b = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${b} on ${os}` : b;
}

function Tile({ label, value, sub, icon: Icon, tone }) {
  return (
    <Card className="flex items-center gap-3 px-3 py-3">
      {Icon ? (
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary",
            tone
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight">{value}</div>
        <div className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {sub ? <div className="truncate text-[11px] text-muted-foreground">{sub}</div> : null}
      </div>
    </Card>
  );
}

function Panel({ title, hint, right, children, className }) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </Card>
  );
}

function RangeSelect({ value, onChange }) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-card px-2 text-sm"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {RANGES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

/** Daily activity: one bar per day, with the documents-created part darker. */
function DailyChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const every = Math.ceil(data.length / 8);
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]">
        {data.map((d) => {
          const h = (d.count / max) * 100;
          const docH = d.count ? (d.documents / d.count) * 100 : 0;
          return (
            <div
              key={d.date}
              className="group relative flex h-full flex-1 items-end"
              title={`${shortDay(d.date)} — ${d.count} actions, ${d.documents} documents, ${d.failed} failed`}
            >
              <div
                className="relative w-full overflow-hidden rounded-t bg-primary/25 transition-colors group-hover:bg-primary/40"
                style={{ height: `${Math.max(h, d.count ? 3 : 0)}%` }}
              >
                <div className="absolute bottom-0 w-full bg-primary" style={{ height: `${docH}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted-foreground">
        {data.map((d, i) => (
          <div key={d.date} className="flex-1 overflow-visible whitespace-nowrap">
            {i % every === 0 ? shortDay(d.date) : ""}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary/25" /> All actions
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary" /> Documents created
        </span>
      </div>
    </div>
  );
}

function HourChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {data.map((d) => (
          <div
            key={d.hour}
            className="flex h-full flex-1 items-end"
            title={`${hourLabel(d.hour)} — ${d.count} actions`}
          >
            <div
              className="w-full rounded-t bg-emerald-500/70"
              style={{ height: `${Math.max((d.count / max) * 100, d.count ? 4 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>11 PM</span>
      </div>
    </div>
  );
}

function SectionBars({ rows, showDocs }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No activity in this period.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.entityType}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="font-medium">{SECTION_LABEL[r.entityType] || r.entityType}</span>
            <span className="text-muted-foreground">
              {r.count}
              {showDocs && r.documents ? ` · ${r.documents} created` : ""}
              {r.failed ? ` · ${r.failed} failed` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-secondary">
            <div
              className={cn("h-full rounded", SECTION_BAR[r.entityType] || "bg-slate-400")}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function peakHour(hourly = []) {
  const top = [...hourly].sort((a, b) => b.count - a.count)[0];
  return top && top.count > 0 ? `${hourLabel(top.hour)} – ${hourLabel((top.hour + 1) % 24)}` : "—";
}
function busiestDay(daily = []) {
  const top = [...daily].sort((a, b) => b.count - a.count)[0];
  return top && top.count > 0 ? `${shortDay(top.date)} (${top.count} actions)` : "—";
}

function RolePill({ role }) {
  return (
    <Badge variant={role === "admin" ? "default" : "outline"} className="capitalize">
      {role}
    </Badge>
  );
}
function StatusPill({ active }) {
  return (
    <Badge className={active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}>
      {active ? "Active" : "Inactive"}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Team overview                                                      */
/* ------------------------------------------------------------------ */

function Overview() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const { sort, toggle, apply } = useSort();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get("/users/insights/overview", { params: { days } });
      setData(d);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load the usage dashboard");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const list = data?.users || [];
    const term = q.trim().toLowerCase();
    const filtered = term
      ? list.filter((u) => `${u.name} ${u.username} ${u.role}`.toLowerCase().includes(term))
      : list;
    return apply(filtered, {
      name: (u) => u.name,
      role: (u) => u.role,
      last: (u) => (u.lastActiveAt ? new Date(u.lastActiveAt).getTime() : null),
      actions: (u) => u.actions,
      documents: (u) => u.documents,
      decisions: (u) => u.decisions,
      days: (u) => u.activeDays,
      failed: (u) => u.failed,
    });
  }, [data, q, apply]);

  const t = data?.totals;
  const dormant = (data?.users || []).filter((u) => u.isActive && !u.actions && !u.logins);
  const maxActions = Math.max(1, ...(data?.users || []).map((u) => u.actions));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">User usage dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Who is using the system, how much, and for what. Click a person to see everything they
            have done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelect value={days} onChange={setDays} />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/users">
              <UsersIcon className="mr-1.5 h-3.5 w-3.5" /> Manage users
            </Link>
          </Button>
        </div>
      </div>

      {!data ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "No data."}
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Tile
              icon={UsersIcon}
              label="Active users"
              value={`${t.activeUsers} / ${t.users}`}
              sub={t.dormantUsers ? `${t.dormantUsers} not seen` : "everyone active"}
            />
            <Tile icon={Activity} label="Actions" value={t.actions.toLocaleString("en-IN")} />
            <Tile
              icon={FileText}
              label="Documents created"
              value={t.documents.toLocaleString("en-IN")}
              tone="text-primary"
            />
            <Tile icon={ShieldCheck} label="Approvals decided" value={t.decisions} />
            <Tile icon={LogIn} label="Sign-ins" value={t.logins} />
            <Tile
              icon={AlertTriangle}
              label="Failed actions"
              value={t.failed}
              sub={t.actions ? `${Math.round((t.failed / (t.actions + t.failed || 1)) * 100)}% of all` : ""}
              tone={t.failed ? "text-destructive" : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Team activity by day"
              hint={`Busiest day: ${busiestDay(data.daily)}`}
            >
              <DailyChart data={data.daily} />
            </Panel>
            <Panel title="Where the work happens" hint="Actions per section">
              <SectionBars rows={data.bySection} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Peak working hours"
              hint={`Most active: ${peakHour(data.hourly)} (IST)`}
            >
              <HourChart data={data.hourly} />
            </Panel>
            <Panel
              title="Not seen in this period"
              hint="Active accounts with no activity or sign-in"
              right={<UserX className="h-4 w-4 text-muted-foreground" />}
            >
              {dormant.length ? (
                <ul className="space-y-1.5">
                  {dormant.slice(0, 8).map((u) => (
                    <li key={u._id}>
                      <Link
                        to={`/user-insights/${u._id}`}
                        className="flex items-center justify-between rounded px-1.5 py-1 text-xs hover:bg-secondary"
                      >
                        <span className="font-medium">{u.name}</span>
                        <span className="text-muted-foreground">
                          last sign-in {u.lastLoginAt ? relativeTime(u.lastLoginAt) : "never"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Everyone has been active.
                </p>
              )}
            </Panel>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">User leaderboard</h3>
                <p className="text-[11px] text-muted-foreground">
                  Click a column to sort, click a person to open their full record.
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-9 w-56 pl-7"
                  placeholder="Search name, username, role"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="User" sortKey="name" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Last active" sortKey="last" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Actions" sortKey="actions" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Documents" sortKey="documents" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Approvals" sortKey="decisions" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Active days" sortKey="days" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <SortableHead label="Failed" sortKey="failed" sort={sort} onSort={toggle} className="h-auto px-3 py-2 text-xs font-medium" />
                    <TableCell className="h-auto px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Mostly works in
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow
                      key={u._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/user-insights/${u._id}`)}
                    >
                      <TableCell className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {initials(u.name)}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{u.name}</div>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              @{u.username}
                              {!u.isActive && (
                                <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-700">
                                  inactive
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <RolePill role={u.role} />
                      </TableCell>
                      <TableCell className="px-3 py-2 text-xs" title={fmtDateTime(u.lastActiveAt)}>
                        {u.lastActiveAt ? relativeTime(u.lastActiveAt) : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-right text-sm font-semibold">{u.actions}</span>
                          <div className="hidden h-1.5 w-20 overflow-hidden rounded bg-secondary sm:block">
                            <div
                              className="h-full rounded bg-primary"
                              style={{ width: `${(u.actions / maxActions) * 100}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-sm">{u.documents}</TableCell>
                      <TableCell className="px-3 py-2 text-sm">{u.decisions}</TableCell>
                      <TableCell className="px-3 py-2 text-sm">
                        {u.activeDays}
                        <span className="text-[11px] text-muted-foreground"> / {data.days}</span>
                      </TableCell>
                      <TableCell
                        className={cn("px-3 py-2 text-sm", u.failed ? "text-destructive" : "text-muted-foreground")}
                      >
                        {u.failed}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        {u.topSection ? (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[11px]",
                              SECTION_TONE[u.topSection] || SECTION_TONE.other
                            )}
                          >
                            {SECTION_LABEL[u.topSection] || u.topSection}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
                        No users match.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One user                                                           */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "documents", label: "Documents made", icon: FileText },
  { key: "records", label: "Records on file", icon: FolderOpen },
  { key: "timeline", label: "Activity timeline", icon: Clock },
  { key: "access", label: "Sign-ins & access", icon: ShieldCheck },
];

function ActivityRow({ row, onOpen, selected }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-secondary/50",
        selected && "bg-primary/10 hover:bg-primary/10"
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          SECTION_TONE[row.entityType] || SECTION_TONE.other
        )}
      >
        {SECTION_LABEL[row.entityType] || row.entityType}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{row.description || actionLabel(row.action)}</span>
        <span className="block text-[11px] text-muted-foreground">
          {fmtDateTime(row.createdAt)} · {relativeTime(row.createdAt)}
          {row.entityLabel ? ` · ${row.entityLabel}` : ""}
        </span>
      </span>
      {row.success === false && (
        <Badge variant="destructive" className="shrink-0">
          Failed
        </Badge>
      )}
    </button>
  );
}

/** Which "records on file" can be opened as a document, and as what. */
const RECORD_KIND = { po: "po", pi: "pi", kitIssue: "kit-issue" };

/** Inline document viewer — the same preview the Activity log uses, shown in the page. */
function DocViewer({ docRef, title, subtitle, onClose, onDetails }) {
  return (
    <Card className="flex min-h-[24rem] flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {docRef ? docKindLabel(docRef.kind) : "Document"}
          </div>
          <div className="truncate text-sm font-semibold">{title || "—"}</div>
          {subtitle ? <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onDetails ? (
            <Button variant="outline" size="sm" className="h-8" onClick={onDetails}>
              Full details
            </Button>
          ) : null}
          {onClose ? (
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {docRef ? (
          <ActivityDocumentPreview key={`${docRef.kind}-${docRef.id}`} docRef={docRef} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center text-xs text-muted-foreground">
            <FileText className="h-6 w-6 opacity-50" />
            This action has no document that can be previewed (for example a template or a saved
            draft).
            <span>Use “Full details” to see what was entered.</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function UserDetail({ id }) {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("summary");
  const [docFilter, setDocFilter] = useState("all");
  const [selDoc, setSelDoc] = useState(null); // activity row id selected in "Documents made"
  const [recRef, setRecRef] = useState(null); // { kind, id, title, subtitle } from "Records on file"

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/users/insights/${id}`, { params: { days } });
      setData(d);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load this user's record");
    } finally {
      setLoading(false);
    }
  }, [id, days]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (row) => {
    setDetailTab(resolveDocRef(row) ? "document" : "summary");
    setDetail(row);
  };

  const permLabel = useMemo(
    () => Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label])),
    []
  );

  if (!data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/user-insights")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All users
        </Button>
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {loading ? "Loading…" : "User not found."}
        </Card>
      </div>
    );
  }

  const { user, kpi, lifetime } = data;
  const docs =
    docFilter === "all" ? data.documents : data.documents.filter((d) => d.entityType === docFilter);
  const selectedRow = docs.find((d) => d._id === selDoc) || docs[0] || null;
  const selectedRef = selectedRow ? resolveDocRef(selectedRow) : null;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/user-insights")}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> All users
      </Button>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {initials(user.name)}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-tight">{user.name}</h1>
              <RolePill role={user.role} />
              <StatusPill active={user.isActive} />
            </div>
            <p className="text-xs text-muted-foreground">
              @{user.username}
              {user.email ? ` · ${user.email}` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Member since {fmtDate(user.createdAt)} · last sign-in{" "}
              {user.lastLoginAt ? `${relativeTime(user.lastLoginAt)} (${fmtDateTime(user.lastLoginAt)})` : "never"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelect value={days} onChange={setDays} />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Tile icon={Activity} label="Actions" value={kpi.actions} />
        <Tile icon={FileText} label="Documents made" value={kpi.documents} tone="text-primary" />
        <Tile icon={ShieldCheck} label="Approvals decided" value={kpi.decisions} />
        <Tile icon={Download} label="Downloads" value={kpi.downloads} />
        <Tile icon={LogIn} label="Sign-ins" value={kpi.logins} />
        <Tile
          icon={CalendarDays}
          label="Active days"
          value={`${kpi.activeDays}/${data.days}`}
        />
        <Tile
          icon={CheckCircle2}
          label="Success rate"
          value={kpi.successRate === null ? "—" : `${kpi.successRate}%`}
          tone="text-emerald-600"
        />
        <Tile
          icon={AlertTriangle}
          label="Failed"
          value={kpi.failed}
          tone={kpi.failed ? "text-destructive" : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "documents" && data.documents.length ? (
              <span className="rounded bg-secondary px-1 text-[10px]">{data.documents.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Activity by day"
              hint={`Busiest day: ${busiestDay(data.daily)}`}
            >
              <DailyChart data={data.daily} />
            </Panel>
            <Panel title="Work by section" hint="Actions in this period">
              <SectionBars rows={data.bySection} showDocs />
            </Panel>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="When they work"
              hint={`Most active: ${peakHour(data.hourly)} (IST)`}
            >
              <HourChart data={data.hourly} />
            </Panel>
            <Panel title="Most frequent actions">
              {data.topActions.length ? (
                <ul className="space-y-1.5">
                  {data.topActions.map((a) => (
                    <li key={a.action} className="flex items-center justify-between text-xs">
                      <span className="capitalize">{actionLabel(a.action)}</span>
                      <span className="font-semibold">{a.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No activity in this period.
                </p>
              )}
            </Panel>
          </div>
          <Panel title="At a glance">
            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">First recorded activity</dt>
                <dd className="font-medium">{fmtDate(lifetime.firstSeen)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last recorded activity</dt>
                <dd className="font-medium">{lifetime.lastSeen ? relativeTime(lifetime.lastSeen) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Total actions ever logged</dt>
                <dd className="font-medium">{lifetime.totalLogged.toLocaleString("en-IN")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Average response time</dt>
                <dd className="font-medium">{kpi.avgResponseMs ? `${kpi.avgResponseMs} ms` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approvals reviewed (all time)</dt>
                <dd className="font-medium">{data.reviews.total}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Approvals reviewed (this period)</dt>
                <dd className="font-medium">{data.reviews.inWindow}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Purchase bills paid</dt>
                <dd className="font-medium">{data.reviews.billsPaid}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}

      {tab === "documents" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">
              Created / issued in the last {data.days} days:
            </span>
            <button
              type="button"
              onClick={() => setDocFilter("all")}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px]",
                docFilter === "all" ? "border-primary bg-primary/10 text-primary" : "border-border"
              )}
            >
              All ({data.documents.length})
            </button>
            {Object.entries(data.documentTally).map(([k, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setDocFilter(k)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px]",
                  docFilter === k ? "border-primary bg-primary/10 text-primary" : "border-border"
                )}
              >
                {SECTION_LABEL[k] || k} ({n})
              </button>
            ))}
          </div>

          {docs.length ? (
            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="max-h-[75vh] overflow-y-auto lg:col-span-2">
                {docs.map((r) => (
                  <ActivityRow
                    key={r._id}
                    row={r}
                    selected={selectedRow?._id === r._id}
                    onOpen={(row) => setSelDoc(row._id)}
                  />
                ))}
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  Latest 100 shown. Pick a document to view it on the right.
                </p>
              </Card>
              <div className="lg:col-span-3">
                <div className="lg:sticky lg:top-2">
                  <DocViewer
                    docRef={selectedRef}
                    title={selectedRow?.entityLabel || selectedRow?.description}
                    subtitle={
                      selectedRow
                        ? `${SECTION_LABEL[selectedRow.entityType] || selectedRow.entityType} · ${fmtDateTime(selectedRow.createdAt)}`
                        : ""
                    }
                    onDetails={selectedRow ? () => open(selectedRow) : undefined}
                  />
                </div>
              </div>
            </div>
          ) : (
            <Card className="py-10 text-center text-xs text-muted-foreground">
              No documents created in this period.
            </Card>
          )}
        </div>
      )}

      {tab === "records" && (
        <div className="space-y-4">
          {recRef && (
            <DocViewer
              docRef={{ kind: recRef.kind, id: recRef.id }}
              title={recRef.title}
              subtitle={recRef.subtitle}
              onClose={() => setRecRef(null)}
            />
          )}
        <div className="grid gap-4 md:grid-cols-2">
          {data.records.map((rec) => (
            <Panel
              key={rec.key}
              title={rec.label}
              hint={`${rec.total} in total · ${rec.inWindow} in the last ${data.days} days`}
              right={<span className="text-2xl font-semibold">{rec.total}</span>}
            >
              {rec.recent.length ? (
                <ul className="divide-y divide-border">
                  {rec.recent.map((r) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-start justify-between gap-3 py-1.5 text-xs",
                        RECORD_KIND[rec.key] && "-mx-1.5 cursor-pointer rounded px-1.5 hover:bg-secondary/60",
                        recRef?.id === r.id && "bg-primary/10"
                      )}
                      onClick={
                        RECORD_KIND[rec.key]
                          ? () =>
                              setRecRef({
                                kind: RECORD_KIND[rec.key],
                                id: r.id,
                                title: r.label,
                                subtitle: [r.sub, fmtDate(r.at)].filter(Boolean).join(" · "),
                              })
                          : undefined
                      }
                      title={RECORD_KIND[rec.key] ? "Click to view the document" : undefined}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.label || "—"}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {r.sub ? `${r.sub} · ` : ""}
                          {fmtDate(r.at)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {r.amount !== null && r.amount !== undefined ? (
                          <div className="font-medium">{inr(r.amount)}</div>
                        ) : null}
                        {r.status ? (
                          <div className="text-[11px] capitalize text-muted-foreground">
                            {String(r.status).replace(/_/g, " ")}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">Nothing on record.</p>
              )}
            </Panel>
          ))}
        </div>
        </div>
      )}

      {tab === "timeline" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Latest activity</h3>
              <p className="text-[11px] text-muted-foreground">
                The 30 most recent actions. Open the Activity log for the full history.
              </p>
            </div>
            {data.recent.length ? (
              data.recent.map((r) => <ActivityRow key={r._id} row={r} onOpen={open} />)
            ) : (
              <p className="py-10 text-center text-xs text-muted-foreground">No activity yet.</p>
            )}
          </Card>
          <Card>
            <div className="border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Recent failures
              </h3>
              <p className="text-[11px] text-muted-foreground">Actions that did not go through</p>
            </div>
            {data.failures.length ? (
              data.failures.map((r) => <ActivityRow key={r._id} row={r} onOpen={open} />)
            ) : (
              <p className="py-10 text-center text-xs text-muted-foreground">No failed actions.</p>
            )}
          </Card>
        </div>
      )}

      {tab === "access" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Recent sign-ins" hint="Latest sign-in and sign-out events">
            {data.sessions.length ? (
              <ul className="divide-y divide-border">
                {data.sessions.map((s) => (
                  <li key={s._id} className="flex items-start justify-between gap-3 py-1.5 text-xs">
                    <div>
                      <div className="font-medium">
                        {s.action === "auth.login" ? "Signed in" : "Signed out"}
                        {s.success === false ? " — failed" : ""}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {browserOf(s.userAgent)}
                        {s.ip ? ` · ${s.ip}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                      {fmtDateTime(s.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-xs text-muted-foreground">No sign-ins logged.</p>
            )}
          </Panel>
          <Panel
            title="Rights granted"
            hint={
              user.role === "admin"
                ? "Admins hold every right"
                : `${user.permissions.length} of ${PERMISSIONS.length} rights`
            }
            right={<UserIcon className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="flex flex-wrap gap-1.5">
              {user.permissions.map((p) => (
                <span key={p} className="rounded bg-secondary px-2 py-0.5 text-[11px]">
                  {permLabel[p] || p}
                </span>
              ))}
              {!user.permissions.length && (
                <span className="text-xs text-muted-foreground">No rights granted.</span>
              )}
            </div>
            <div className="mt-4">
              <Button variant="outline" size="sm" asChild>
                <Link to="/users">Edit rights in Users &amp; rights</Link>
              </Button>
            </div>
          </Panel>
        </div>
      )}

      <ActivityDetailDialog row={detail} initialTab={detailTab} onClose={() => setDetail(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function UserInsights() {
  const { id } = useParams();
  return id ? <UserDetail key={id} id={id} /> : <Overview />;
}