import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  PackagePlus,
  Users,
  UserCheck,
  Boxes,
  FileText,
  FileSpreadsheet,
  Receipt,
  Clock,
  Play,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

const STEP_LABEL = {
  1: "Vendor",
  2: "Purchase order",
  3: "Proforma invoice",
  4: "Stock entry",
  5: "Tax invoice",
};
const TOTAL_STEPS = 5;

const fmtDate = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};

const fmtWhen = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const fmtAmount = (n) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const asArray = (d) => (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []);

/* ------------------------------------------------------------------ */
/* Small stat tile — deliberately compact                              */
/* ------------------------------------------------------------------ */
function Stat({ to, icon: Icon, label, value, hint, tone = "default", loading }) {
  const tones = {
    default: "bg-slate-100 text-slate-600",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    sky: "bg-sky-100 text-sky-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return (
    <Link
      to={to}
      className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block text-lg font-semibold leading-tight">
          {loading ? <span className="inline-block h-4 w-8 animate-pulse rounded bg-slate-200 align-middle" /> : value}
        </span>
        {hint ? <span className="block truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </Link>
  );
}

function SectionCard({ title, description, action, children }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">{title}</CardTitle>
          {description ? <CardDescription className="text-xs">{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="pt-0 pb-3">{children}</CardContent>
    </Card>
  );
}

function Empty({ children }) {
  return <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [parts, setParts] = useState([]);
  const [openPOs, setOpenPOs] = useState([]);
  const [openPIs, setOpenPIs] = useState([]);
  const [taxInvoices, setTaxInvoices] = useState([]);
  const [generatedPIs, setGeneratedPIs] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const safe = (p) => p.then((r) => asArray(r.data)).catch(() => []);
    const [s, v, b, p, po, pi, tax, gen] = await Promise.all([
      safe(api.get("/receiving-sessions", { params: { status: "in_progress" } })),
      safe(api.get("/vendors")),
      safe(api.get("/buyers")),
      safe(api.get("/parts")),
      safe(api.get("/purchase-orders", { params: { documentType: "po", lifecycleStatus: "open" } })),
      safe(api.get("/purchase-orders", { params: { documentType: "pi", lifecycleStatus: "open" } })),
      safe(api.get("/tax-invoices")),
      safe(api.get("/pi-generator")),
    ]);
    setSessions(s);
    setVendors(v);
    setBuyers(b);
    setParts(p);
    setOpenPOs(po);
    setOpenPIs(pi);
    setTaxInvoices(tax);
    setGeneratedPIs(gen);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const outOfStock = useMemo(
    () => parts.filter((x) => Number(x.quantityInStock || 0) <= 0),
    [parts]
  );

  const recentPIs = useMemo(
    () =>
      [...generatedPIs]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 5),
    [generatedPIs]
  );

  const recentInvoices = useMemo(
    () =>
      [...taxInvoices]
        .sort((a, b) => new Date(b.createdAt || b.invoiceDate || 0) - new Date(a.createdAt || a.invoiceDate || 0))
        .slice(0, 5),
    [taxInvoices]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Receiving, documents and stock at a glance — pick up wherever you left off.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild size="sm">
            <Link to="/receive">
              <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
              Receive material
            </Link>
          </Button>
        </div>
      </div>

      {/* Compact stat strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          to="/receive"
          icon={Clock}
          label="In progress"
          value={sessions.length}
          hint="Saved deliveries"
          tone="amber"
          loading={loading}
        />
        <Stat
          to="/documents"
          icon={FileText}
          label="Open POs"
          value={openPOs.length}
          tone="sky"
          loading={loading}
        />
        <Stat
          to="/documents"
          icon={FileSpreadsheet}
          label="Open PIs"
          value={openPIs.length}
          tone="violet"
          loading={loading}
        />
        <Stat
          to="/documents"
          icon={Receipt}
          label="Tax invoices"
          value={taxInvoices.length}
          tone="emerald"
          loading={loading}
        />
        <Stat to="/parts" icon={Boxes} label="Parts" value={parts.length} loading={loading} />
        <Stat
          to="/vendors"
          icon={Users}
          label="Vendors"
          value={vendors.length}
          hint={`${buyers.length} buyers`}
          loading={loading}
        />
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Deliveries in progress */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Deliveries in progress"
            description="Every receiving step can be saved and resumed on another day."
            action={
              <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <Link to="/receive">
                  Open <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            }
          >
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-md bg-slate-100" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <Empty>
                Nothing pending — start a new delivery from{" "}
                <Link to="/receive" className="font-medium underline">
                  Receive material
                </Link>
                .
              </Empty>
            ) : (
              <ul className="divide-y divide-border">
                {sessions.slice(0, 6).map((s) => {
                  const step = Number(s.currentStep || 2);
                  const pct = Math.round((Math.min(step, TOTAL_STEPS) / TOTAL_STEPS) * 100);
                  return (
                    <li key={s._id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.vendor?.companyName || "Vendor"}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          Next: {STEP_LABEL[step] || "—"} · saved {fmtWhen(s.updatedAt || s.createdAt)}
                        </p>
                      </div>
                      <div className="hidden w-28 shrink-0 sm:block">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-right text-[10px] text-muted-foreground">
                          Step {Math.min(step, TOTAL_STEPS)} / {TOTAL_STEPS}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs">
                        <Link to="/receive">
                          <Play className="mr-1 h-3 w-3" />
                          Resume
                        </Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Quick actions */}
        <SectionCard title="Quick actions" description="Jump straight into the common jobs.">
          <div className="grid grid-cols-2 gap-2">
            {[
              { to: "/receive", label: "Receive material", icon: PackagePlus },
              { to: "/pi-generator", label: "Generate PI", icon: FileSpreadsheet },
              { to: "/vendors", label: "Vendors", icon: Users },
              { to: "/buyers", label: "Buyers", icon: UserCheck },
              { to: "/parts", label: "Parts master", icon: Boxes },
              { to: "/documents", label: "PO / PI / invoices", icon: FileText },
            ].map(({ to, label, icon: Icon }) => (
              <Link
                key={to + label}
                to={to}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs font-medium transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </Link>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent generated PIs */}
        <SectionCard
          title="Recent proforma invoices"
          description="Generated from the PI generator."
          action={
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link to="/pi-generator">
                All <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        >
          {recentPIs.length === 0 ? (
            <Empty>No PIs generated yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentPIs.map((pi) => (
                <li key={pi._id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{pi.invoiceNo}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{pi.buyerName || "—"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium">₹{fmtAmount(pi.grandTotal || pi.totalAmount)}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(pi.createdAt || pi.invoiceDate)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Recent tax invoices */}
        <SectionCard
          title="Recent tax invoices"
          description="Latest invoices booked against deliveries."
          action={
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link to="/documents">
                All <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        >
          {recentInvoices.length === 0 ? (
            <Empty>No tax invoices recorded yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentInvoices.map((inv) => (
                <li key={inv._id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{inv.invoiceNumber || inv.invoiceNo || "—"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {inv.vendor?.companyName || inv.buyerName || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium">₹{fmtAmount(inv.totalAmount)}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtDate(inv.invoiceDate || inv.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Stock attention */}
        <SectionCard
          title="Stock needing attention"
          description="Parts currently showing zero stock."
          action={
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link to="/parts">
                Parts <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        >
          {outOfStock.length === 0 ? (
            <Empty>All parts have stock on hand.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {outOfStock.slice(0, 5).map((p) => (
                <li key={p._id} className="flex items-center gap-2 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{p.ttUniquePartNumber || p.manufacturerPartNumber}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{p.itemDescription || "—"}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    0 in stock
                  </span>
                </li>
              ))}
              {outOfStock.length > 5 ? (
                <li className="pt-1.5 text-[11px] text-muted-foreground">
                  +{outOfStock.length - 5} more parts out of stock
                </li>
              ) : null}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
