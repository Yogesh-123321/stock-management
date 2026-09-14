import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { Boxes, LogIn, ShieldPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import FieldError from "@/components/FieldError";
import { useFormValidation } from "@/lib/useFormValidation";

// Regex validation only applies to the first-run admin-creation fields —
// the sign-in form only ever gets a "required" check, since an existing
// account's username/password may pre-date these patterns and must still
// be able to sign in.
const SETUP_SCHEMA = {
  name: { required: true, requiredMessage: "Full name is required", regex: "personName", maxLength: 80 },
  username: { required: true, requiredMessage: "Username is required", regex: "username" },
  password: { required: true, requiredMessage: "Password is required", minLength: 6 },
};

export default function Login() {
  const { user, loading, needsSetup, signIn, bootstrap } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const v = useFormValidation(SETUP_SCHEMA);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  if (!loading && user) return <Navigate to={location.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (needsSetup && !v.validateAll(form)) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) {
        await bootstrap({
          name: form.name.trim(),
          username: form.username.trim(),
          password: form.password,
        });
        toast.success("Admin account created");
      } else {
        await signIn(form.username.trim(), form.password);
        toast.success("Signed in");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar">
            <Boxes className="h-5 w-5 text-white" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-semibold">TISPL Inventory</p>
            <p className="text-[11px] text-muted-foreground">
              {needsSetup ? "First-run setup" : "Sign in to continue"}
            </p>
          </div>
        </div>

        {needsSetup && (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
            No accounts exist yet. Create the central admin — it will hold every approval right and
            can add users afterwards.
          </p>
        )}

        <form onSubmit={submit} className="space-y-3">
          {needsSetup && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Full name
              </label>
              <Input
                value={form.name}
                onChange={set("name")}
                onBlur={() => needsSetup && v.handleBlur("name", form.name, form)}
                required
                autoFocus
              />
              {needsSetup && <FieldError error={v.fieldError("name")} />}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Username</label>
            <Input
              value={form.username}
              onChange={set("username")}
              onBlur={() => needsSetup && v.handleBlur("username", form.username, form)}
              autoComplete="username"
              required
              autoFocus={!needsSetup}
            />
            {needsSetup && <FieldError error={v.fieldError("username")} />}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
            <Input
              type="password"
              value={form.password}
              onChange={set("password")}
              onBlur={() => needsSetup && v.handleBlur("password", form.password, form)}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              required
            />
            {needsSetup && <FieldError error={v.fieldError("password")} />}
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {needsSetup ? (
              <>
                <ShieldPlus className="mr-1.5 h-4 w-4" /> Create admin
              </>
            ) : (
              <>
                <LogIn className="mr-1.5 h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}