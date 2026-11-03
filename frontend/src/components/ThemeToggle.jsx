import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/*
  Light / dark switch.
    variant="sidebar"  — for the always-dark sidebar (light text on translucent white)
    variant="header"   — compact icon button for the top bar
*/
export default function ThemeToggle({ variant = "header", className }) {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const Icon = isDark ? Sun : Moon;

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={toggle}
        title={label}
        aria-label={label}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1.5 text-[11px] text-white hover:bg-white/[0.12]",
          className
        )}
      >
        <Icon className="h-3 w-3" /> {isDark ? "Light mode" : "Dark mode"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
        className
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}