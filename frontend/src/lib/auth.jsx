import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "@/lib/api";

const TOKEN_KEY = "tispl.token";
const AuthContext = createContext(null);

function applyToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    delete api.defaults.headers.common.Authorization;
  }
}

// Restore the token before the first request goes out.
applyToken(localStorage.getItem(TOKEN_KEY));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const signOut = useCallback(() => {
    applyToken(null);
    setUser(null);
  }, []);

  const load = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      try {
        const { data } = await api.get("/auth/setup-state");
        setNeedsSetup(Boolean(data?.needsSetup));
      } catch {
        /* backend may be starting up */
      }
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
    } catch {
      applyToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Any 401 from anywhere signs the session out.
  useEffect(() => {
    const id = api.interceptors.response.use(
      (r) => r,
      (error) => {
        if (error?.response?.status === 401) signOut();
        return Promise.reject(error);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, [signOut]);

  const signIn = useCallback(async (username, password) => {
    const { data } = await api.post("/auth/login", { username, password });
    applyToken(data.token);
    setUser(data.user);
    setNeedsSetup(false);
    return data.user;
  }, []);

  const bootstrap = useCallback(async (payload) => {
    const { data } = await api.post("/auth/bootstrap", payload);
    applyToken(data.token);
    setUser(data.user);
    setNeedsSetup(false);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      needsSetup,
      signIn,
      signOut,
      bootstrap,
      refresh: load,
      isAdmin: user?.role === "admin",
      can: (permission) =>
        Boolean(user) && (user.role === "admin" || (user.permissions || []).includes(permission)),
      canAny: (...list) =>
        Boolean(user) &&
        (user.role === "admin" || list.some((p) => (user.permissions || []).includes(p))),
    }),
    [user, loading, needsSetup, signIn, signOut, bootstrap, load]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}

/** Wrap protected routes. */
export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** Wrap a route that needs a specific permission. */
export function RequirePermission({ permission, children }) {
  const { can, loading } = useAuth();
  if (loading) return <Splash />;
  if (!can(permission)) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <p className="font-display text-base font-semibold">No access</p>
        <p className="mt-2 text-sm text-muted-foreground">
          You don't have permission to open this screen. Ask an admin to enable it for your account.
        </p>
      </div>
    );
  }
  return children;
}
