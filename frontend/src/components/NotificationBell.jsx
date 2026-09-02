import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ShieldCheck, ShieldX, Info, Clock } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ICON = {
  approval_requested: Clock,
  approval_approved: ShieldCheck,
  approval_rejected: ShieldX,
  info: Info,
};

const TONE = {
  approval_requested: "text-amber-600",
  approval_approved: "text-emerald-600",
  approval_rejected: "text-rose-600",
  info: "text-sky-600",
};

function timeAgo(value) {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  const loadCount = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnread(data.count || 0);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications", { params: { limit: 30 } });
      setItems(data.items || []);
      setUnread(data.unreadCount || 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 30000);
    return () => clearInterval(id);
  }, [loadCount]);

  useEffect(() => {
    if (open) loadItems();
  }, [open, loadItems]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read) {
      try {
        await api.patch(`/notifications/${item._id}/read`);
      } catch {
        /* ignore */
      }
      setUnread((n) => Math.max(0, n - 1));
    }
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    try {
      await api.patch("/notifications/read-all");
      setItems((list) => list.map((i) => ({ ...i, read: true })));
      setUnread(0);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative isolate" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-secondary"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[100] mt-2 w-[340px] overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-xs font-semibold">Notifications</p>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={markAll}>
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                Nothing here yet.
              </p>
            )}
            {items.map((item) => {
              const Icon = ICON[item.type] || Info;
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn(
                    "flex w-full gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-secondary",
                    !item.read && "bg-secondary/60"
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[item.type])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{item.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                      {item.message}
                    </span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {timeAgo(item.createdAt)}
                    </span>
                  </span>
                  {!item.read && (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-active" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
