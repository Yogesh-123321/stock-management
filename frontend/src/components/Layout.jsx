import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import toast from "react-hot-toast";
import {
  Boxes,
  Tags,
  PackagePlus,
  Users as UsersIcon,
  UserCheck,
  FileStack,
  LayoutDashboard,
  FileSpreadsheet,
  FileText,
  ShieldCheck,
  UserCog,
  LogOut,
  KeyRound,
  PackageOpen,
  Layers,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { useAuth } from "@/lib/auth";
import { ScrollText } from "lucide-react";
/** `permission: null` = visible to everyone who is signed in. */
const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, permission: null },
  { to: "/receive", label: "Receive material", icon: PackagePlus, permission: "receive.manage" },
  { to: "/vendors", label: "Vendors", icon: UsersIcon, permission: "vendor.create" },
  { to: "/buyers", label: "Buyers", icon: UserCheck, permission: "buyer.create" },
  { to: "/parts", label: "Parts master", icon: Boxes, permission: null },
  { to: "/part-categories", label: "Part categories", icon: Tags, permission: "part.approve" },
  // Kit templates + IQC templates live together on one page, as tabs.
  { to: "/templates", label: "Templates", icon: Layers, anyOf: ["kit.manage", "iqc.manage"] },
  { to: "/documents", label: "PO / PI / invoices", icon: FileStack, permission: "documents.view" },
  {
    to: "/issue-kit",
    label: "Issue kit",
    icon: PackageOpen,
    permission: "kit.issue",
    // Admins can also issue R&D stock from this page (second tab), so
    // their sidebar entry says so.
    altLabel: "Issue kit & R&D stock",
    altPermission: "part.approve",
  },
  { to: "/po-generator", label: "PO generator", icon: FileText, permission: "po.create" },
  { to: "/pi-generator", label: "PI generator", icon: FileSpreadsheet, permission: "pi.create" },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck, permission: null, badge: true },
  { to: "/users", label: "Users & rights", icon: UserCog, permission: "users.manage" },
{ to: "/activity-log", label: "Activity log", icon: ScrollText, permission: "logs.view" },
];

function useApprovalBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await api.get("/approvals/pending-count");
        if (alive) setCount(data.count || 0);
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return count;
}

function changePasswordFlow() {
  const currentPassword = window.prompt("Current password");
  if (!currentPassword) return null;
  const newPassword = window.prompt("New password (min 6 characters)");
  if (!newPassword) return null;
  return { currentPassword, newPassword };
}

export default function Layout() {
  const { user, can, canAny, signOut } = useAuth();
  const navigate = useNavigate();
  const pendingApprovals = useApprovalBadge();

  const visible = navItems
    .filter((i) => (i.anyOf ? canAny(...i.anyOf) : !i.permission || can(i.permission)))
    .map((i) => (i.altLabel && can(i.altPermission) ? { ...i, label: i.altLabel } : i));

  const onSignOut = () => {
    signOut();
    navigate("/login", { replace: true });
  };

  const onChangePassword = async () => {
    const body = changePasswordFlow();
    if (!body) return;
    try {
      await api.patch("/auth/password", body);
      toast.success("Password updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not update the password");
    }
  };

  const renderNav = (mobile = false) =>
    visible.map(({ to, label, icon: Icon, end, badge }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) =>
          mobile
            ? cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                isActive ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"
              )
            : cn(
                "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white/[0.06] text-white"
                  : "text-sidebar-muted hover:bg-white/[0.04] hover:text-white"
              )
        }
      >
        {({ isActive }) => (
          <>
            {!mobile && (
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r bg-sidebar-active transition-opacity",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
            )}
            <Icon className={cn("shrink-0", mobile ? "h-3.5 w-3.5" : "h-4 w-4")} strokeWidth={2} />
            {label}
            {badge && pendingApprovals > 0 && (
              <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                {pendingApprovals}
              </span>
            )}
          </>
        )}
      </NavLink>
    ));

  return (
    <div className="app-shell">
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-active/90">
            <Boxes className="h-4.5 w-4.5 text-white" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold text-white">TISPL</p>
            <p className="text-[11px] tracking-wide text-sidebar-muted">Inventory Receiving</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">{renderNav(false)}</nav>

        <div className="border-t border-white/[0.08] px-4 py-3">
          <p className="truncate text-[12px] font-medium text-white">{user?.name}</p>
          <p className="text-[11px] capitalize text-sidebar-muted">
            {user?.role === "admin" ? "Central admin" : "User"}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={onChangePassword}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-white hover:bg-white/[0.12]"
            >
              <KeyRound className="h-3 w-3" /> Password
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-white hover:bg-white/[0.12]"
            >
              <LogOut className="h-3 w-3" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/95 px-5 py-2.5 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <Boxes className="h-5 w-5" />
            <span className="font-display text-sm font-semibold">TISPL Inventory</span>
          </div>
          <div className="hidden text-xs text-muted-foreground md:block">
            Signed in as <span className="font-medium text-foreground">{user?.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              type="button"
              onClick={onSignOut}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary md:hidden"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
          {renderNav(true)}
        </nav>

        <main className="page-container">
          <Outlet />
        </main>
      </div>
    </div>
  );
}