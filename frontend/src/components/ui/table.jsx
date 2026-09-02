import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="w-full overflow-x-auto thin-scroll rounded-lg border border-border">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-secondary/70 [&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

// Zebra striping is applied here (not on TableRow) so header rows are never
// striped. Even rows get a subtle tinted band; hover still wins over both.
const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      "[&_tr:last-child]:border-0 [&_tr:nth-child(odd)]:bg-card [&_tr:nth-child(even)]:bg-muted/50",
      className
    )}
    {...props}
  />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("border-b border-border transition-colors hover:bg-secondary/60", className)}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-7 px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground font-display",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-2.5 py-1 align-middle leading-tight", className)} {...props} />
));
TableCell.displayName = "TableCell";

const TableEmpty = ({ colSpan, children }) => (
  <tr>
    <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </td>
  </tr>
);

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
