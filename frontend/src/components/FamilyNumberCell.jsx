import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  The number cell of a family-folded table row.
  depth 0 + count > 1  -> a chevron and a "+N" pill that expand/collapse the variants
  depth 1              -> an indented variant row
*/
export default function FamilyNumberCell({ entry, onToggle, children, className }) {
  const { depth, count, key, isOpen } = entry;
  const hasVariants = depth === 0 && count > 1;
  return (
    <div className={cn("flex items-center gap-1.5", depth > 0 && "pl-6", className)}>
      {hasVariants ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(key);
          }}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Hide variants" : "Show variants"}
          className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
        </button>
      ) : depth > 0 ? (
        <span className="text-muted-foreground">↳</span>
      ) : (
        <span className="inline-block w-5" />
      )}
      <span className="min-w-0">{children}</span>
      {hasVariants && (
        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          +{count - 1}
        </span>
      )}
    </div>
  );
}