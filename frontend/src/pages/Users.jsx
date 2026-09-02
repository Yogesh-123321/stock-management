import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { UserPlus, KeyRound, Save, ShieldCheck, User as UserIcon, RefreshCw } from "lucide-react";
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

const EMPTY = { name: "", username: "", email: "", password: "", role: "user" };

function PermissionGrid({ value, disabled, onToggle }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
        <div key={group} className="rounded-md border border-border p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </p>
          <div className="space-y-1">
            {perms.map((p) =>
              p.adminOnly ? (
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
                    disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5"
                    checked={value.includes(p.key)}
                    disabled={disabled}
                    onChange={() => onToggle(p.key)}
                  />
                  <span>{p.label}</span>
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/users");
      setUsers(data.users || []);
      setDraft(
        Object.fromEntries(
          (data.users || []).map((u) => [u._id, u.role === "admin" ? [] : u.storedPermissions || []])
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
    setCreating(true);
    try {
      await api.post("/users", form);
      toast.success(`${form.name} can now sign in`);
      setForm(EMPTY);
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
            New accounts start with the standard user rights — tick or untick anything below after
            creating them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createUser} className="grid gap-2 sm:grid-cols-6">
            <Input
              className="sm:col-span-2"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
            <Input
              placeholder="Password"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
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
              Admins always hold every right, including all approvals. For users, tick exactly
              what they may do — approval rights stay locked to the admin.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </CardHeader>

        <CardContent className="space-y-2">
          {users.map((u) => {
            const isAdmin = u.role === "admin";
            const open = openId === u._id;
            return (
              <div key={u._id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => setOpenId(open ? null : u._id)}
                  >
                    {isAdmin ? (
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
                    <Badge variant={isAdmin ? "default" : "outline"} className="capitalize">
                      {u.role}
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
                    <select
                      className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                      value={u.role}
                      disabled={u._id === me?._id}
                      onChange={(e) => patch(u._id, { role: e.target.value }, "Role updated")}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => resetPassword(u)}
                    >
                      <KeyRound className="mr-1 h-3.5 w-3.5" /> Reset
                    </Button>
                    <Button
                      size="sm"
                      variant={u.isActive ? "destructive" : "outline"}
                      className="h-8"
                      disabled={u._id === me?._id}
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
                  </div>
                </div>

                {open && (
                  <div className="space-y-2 border-t border-border bg-secondary/30 px-3 py-3">
                    {isAdmin ? (
                      <p className="text-[12px] text-muted-foreground">
                        Admins hold every right, including all approvals and user management. Change
                        the role to “User” to restrict them.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">
                            {(draft[u._id] || []).length} of {allKeys.length} rights granted
                          </p>
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() =>
                              patch(u._id, { permissions: draft[u._id] || [] }, "Permissions saved")
                            }
                          >
                            <Save className="mr-1 h-3.5 w-3.5" /> Save permissions
                          </Button>
                        </div>
                        <PermissionGrid
                          value={draft[u._id] || []}
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
