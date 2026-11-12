import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { UserPlus, KeyRound, Save, ShieldCheck, ShieldAlert, User as UserIcon, RefreshCw, BarChart3 } from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";

const ROLE_LABEL = { super_admin: "Super admin", admin: "Admin", user: "User" };

const EMPTY = { name: "", username: "", email: "", password: "", role: "user" };

const NEW_USER_SCHEMA = {
  name: { required: true, requiredMessage: "Full name is required", regex: "personName", maxLength: 80 },
  username: { required: true, requiredMessage: "Username is required", regex: "username" },
  password: { required: true, requiredMessage: "Password is required", minLength: 6 },
};

function PermissionGrid({ value, disabled, onToggle, allowAdminOnly = false, lockedKeys = [] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
        <div key={group} className="rounded-md border border-border p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </p>
          <div className="space-y-1">
            {perms.map((p) =>
              p.adminOnly && !allowAdminOnly ? (
                // Approval rights (and user management) belong to the central
                // admin only — shown here so it's clear, but never assignable.
                <div
                  key={p.key}
                  className="flex items-start gap-2 rounded px-1 py-0.5 text-[12px] text-muted-foreground"
                  title="Admin only — users can raise requests, only the admin approves"
                >
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {p.label}
                    <span className="ml-1 rounded bg-secondary px-1 text-[10px] uppercase tracking-wide">
                      Admin only
                    </span>
                  </span>
                </div>
              ) : (
                <label
                  key={p.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-secondary",
                    (disabled || lockedKeys.includes(p.key)) && "cursor-not-allowed opacity-60"
                  )}
                  title={lockedKeys.includes(p.key) ? "You don't hold this right, so you can't hand it out" : undefined}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5"
                    checked={value.includes(p.key)}
                    disabled={disabled || lockedKeys.includes(p.key)}
                    onChange={() => onToggle(p.key)}
                  />
                  <span>
                    {p.label}
                    {p.adminOnly && (
                      <span className="ml-1 rounded bg-secondary px-1 text-[10px] uppercase tracking-wide">
                        Admin right
                      </span>
                    )}
                  </span>
                </label>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Users() {
  const { user: me, refresh } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [draft, setDraft] = useState({});
  const [openId, setOpenId] = useState(null);
  const [assignableRoles, setAssignableRoles] = useState(["user"]);
  const [myPermissions, setMyPermissions] = useState([]);
  const v = useFormValidation(NEW_USER_SCHEMA);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/users");
      setUsers(data.users || []);
      setAssignableRoles(data.assignableRoles || ["user"]);
      setMyPermissions(data.myPermissions || []);
      // Users: the rights granted to them. Admins: everything they currently
      // hold (a super admin unticks to revoke). Super admins hold everything.
      setDraft(
        Object.fromEntries(
          (data.users || []).map((u) => [
            u._id,
            u.role === "super_admin" ? [] : u.role === "admin" ? u.permissions || [] : u.storedPermissions || [],
          ])
        )
      );
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const allKeys = useMemo(() => PERMISSIONS.map((p) => p.key), []);

  const createUser = async (e) => {
    e.preventDefault();
    if (!v.validateAll(form)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setCreating(true);
    try {
      await api.post("/users", form);
      toast.success(`${form.name} can now sign in`);
      setForm(EMPTY);
      v.reset();
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not create the user");
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id, body, message) => {
    try {
      await api.patch(`/users/${id}`, body);
      toast.success(message);
      load();
      if (id === me?._id) refresh();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not update the user");
    }
  };

  const resetPassword = async (u) => {
    const pwd = window.prompt(`New password for ${u.name} (min 6 characters)`);
    if (!pwd) return;
    try {
      await api.patch(`/users/${u._id}/password`, { newPassword: pwd });
      toast.success("Password reset — share it with the user");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not reset the password");
    }
  };

  const toggle = (id, key) =>
    setDraft((d) => {
      const list = d[id] || [];
      return { ...d, [id]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] };
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Add a user
          </CardTitle>
          <CardDescription>
            New accounts start with the standard rights for their level — tick or untick anything
            below after creating them.
            {me?.role === "super_admin"
              ? " As a super admin you can also create admins and control their rights."
              : " Only a super admin can create admins."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createUser} className="grid gap-2 sm:grid-cols-6 items-start">
            <div className="sm:col-span-2">
              <Input
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => v.handleBlur("name", form.name, form)}
                required
              />
              <FieldError error={v.fieldError("name")} />
            </div>
            <div>
              <Input
                placeholder="Username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                onBlur={() => v.handleBlur("username", form.username, form)}
                required
              />
              <FieldError error={v.fieldError("username")} />
            </div>
            <div>
              <Input
                placeholder="Password"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                onBlur={() => v.handleBlur("password", form.password, form)}
                required
              />
              <FieldError error={v.fieldError("password")} />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] || r}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add user"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Users & permission rights</CardTitle>
            <CardDescription>
              Super admins hold every right and are the only ones who can manage admins. Admins hold
              every right unless a super admin unticks some. For users, tick exactly what they may do
              — approval rights stay locked to admins.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" asChild>
              <Link to="/user-insights">
                <BarChart3 className="mr-1.5 h-3.5 w-3.5" /> Usage dashboard
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-2">
          {users.map((u) => {
            const isSuper = u.role === "super_admin";
            const isAdmin = u.role === "admin";
            const isTopLevel = isSuper || isAdmin;
            const isSelf = u._id === me?._id;
            const canManage = Boolean(u.canManage);
            const open = openId === u._id;
            // rights the signed-in person can't hand out (only matters for plain admins)
            const lockedKeys =
              me?.role === "super_admin" ? [] : allKeys.filter((k) => !myPermissions.includes(k));
            return (
              <div key={u._id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => setOpenId(open ? null : u._id)}
                  >
                    {isSuper ? (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                    ) : isAdmin ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <UserIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {u.name}
                        {u._id === me?._id && (
                          <span className="ml-1 text-[11px] text-muted-foreground">(you)</span>
                        )}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">@{u.username}</span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={isTopLevel ? "default" : "outline"}>
                      {ROLE_LABEL[u.role] || u.role}
                    </Badge>
                    <Badge
                      className={cn(
                        u.isActive
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      )}
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {canManage && assignableRoles.length > 1 && (
                      <select
                        className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                        value={u.role}
                        disabled={isSelf}
                        onChange={(e) => {
                          const role = e.target.value;
                          if (
                            role === "super_admin" &&
                            !window.confirm(`Make ${u.name} a super admin? They will be able to manage every admin.`)
                          )
                            return;
                          patch(u._id, { role }, "Role updated");
                        }}
                      >
                        {assignableRoles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r] || r}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button size="sm" variant="outline" className="h-8" asChild>
                      <Link to={`/user-insights/${u._id}`}>
                        <BarChart3 className="mr-1 h-3.5 w-3.5" /> Activity
                      </Link>
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => resetPassword(u)}
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset
                      </Button>
                    )}
                    {canManage && (
                    <Button
                      size="sm"
                      variant={u.isActive ? "destructive" : "outline"}
                      className="h-8"
                      disabled={isSelf}
                      onClick={() =>
                        patch(
                          u._id,
                          { isActive: !u.isActive },
                          u.isActive ? "User deactivated" : "User activated"
                        )
                      }
                    >
                      {u.isActive ? "Deactivate" : "Activate"}
                    </Button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="space-y-2 border-t border-border bg-secondary/30 px-3 py-3">
                    {!canManage ? (
                      <p className="text-[12px] text-muted-foreground">
                        {isTopLevel
                          ? "Admin accounts and their rights can only be managed by a super admin."
                          : "You can't manage this account."}
                      </p>
                    ) : isSuper ? (
                      <p className="text-[12px] text-muted-foreground">
                        Super admins hold every right and control all admins. Their rights can't be
                        restricted. {isSelf ? "" : "Use the role dropdown above to change their level."}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">
                            {(draft[u._id] || []).length} of {allKeys.length} rights{" "}
                            {isAdmin ? "held (untick to revoke)" : "granted"}
                          </p>
                          {!isSelf && (
                            <Button
                              size="sm"
                              className="h-8"
                              onClick={() =>
                                patch(u._id, { permissions: draft[u._id] || [] }, "Permissions saved")
                              }
                            >
                              <Save className="mr-1 h-3.5 w-3.5" /> Save permissions
                            </Button>
                          )}
                        </div>
                        {isAdmin && (
                          <p className="text-[11px] text-muted-foreground">
                            This admin holds every right except the ones you untick here — including
                            approvals and user management.
                          </p>
                        )}
                        <PermissionGrid
                          value={draft[u._id] || []}
                          disabled={isSelf}
                          allowAdminOnly={isAdmin}
                          lockedKeys={isAdmin ? [] : lockedKeys}
                          onToggle={(key) => toggle(u._id, key)}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {users.length === 0 && !loading && (
            <p className="py-6 text-center text-xs text-muted-foreground">No users yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}