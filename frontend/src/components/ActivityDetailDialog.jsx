import { useState } from "react";
import { AlertTriangle, Cog, FileText, Info, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ActivityPayload from "@/components/ActivityPayload";
import ActivityDocumentPreview from "@/components/ActivityDocumentPreview";
import {
  SECTION_LABEL,
  docKindLabel,
  explainStatus,
  fmtDateTime,
  relativeTime,
  resolveDocRef,
} from "@/lib/activityFormat";
import { cn } from "@/lib/utils";

/*
  Opens when a row of the Activity log is clicked.

    Summary    what happened, who, when, the result — and what was entered,
               in plain fields and tables (not raw JSON)
    Document   the PO / PI / invoice / vendor / part / kit issue the action was
               about, shown right here (only when the entry relates to one)
    Technical  endpoint, IP, timing and the untouched recorded data
*/

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function SummaryTab({ row, docRef, onOpenDocument }) {
  const deleted = row.method === "DELETE" && row.success !== false;
  return (
    <div className="space-y-5 px-6 py-4">
      <div className="rounded-md border border-border bg-card p-4">
        <p className="text-base font-medium">{row.description || row.action}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
          <Fact label="Who">
            {row.userName || "—"}
            {row.userRole ? (
              <span className="ml-1.5 text-[11px] uppercase text-muted-foreground">{row.userRole}</span>
            ) : null}
          </Fact>
          <Fact label="When">
            {fmtDateTime(row.createdAt)}
            <span className="ml-1.5 text-xs text-muted-foreground">({relativeTime(row.createdAt)})</span>
          </Fact>
          <Fact label="Section">{SECTION_LABEL[row.entityType] || row.entityType || "—"}</Fact>
          <Fact label="Reference">{row.entityLabel || "—"}</Fact>
          <Fact label="Result">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                row.success ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              )}
            >
              {row.success ? "Went through" : `Failed (${row.statusCode || "error"})`}
            </span>
          </Fact>
        </dl>

        {!row.success && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{explainStatus(row.statusCode)}</span>
          </div>
        )}

        {deleted && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This record was deleted, so there is no document left to show.</span>
          </div>
        )}

        {docRef && (
          <Button size="sm" variant="outline" className="mt-3" onClick={onOpenDocument}>
            <FileText className="mr-1.5 h-4 w-4" /> View {docKindLabel(docRef.kind).toLowerCase()}
          </Button>
        )}
      </div>

      <div>
        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          Details recorded
        </p>
        <ActivityPayload meta={row.meta} />
      </div>
    </div>
  );
}

function TechnicalTab({ row }) {
  return (
    <div className="space-y-4 px-6 py-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3">
        <Fact label="Action key">
          <span className="font-mono text-xs">{row.action}</span>
        </Fact>
        <Fact label="Method">{row.method || "—"}</Fact>
        <Fact label="Status">
          {row.statusCode || "—"} ({row.success ? "OK" : "failed"})
        </Fact>
        <Fact label="Endpoint">
          <span className="break-all font-mono text-xs">{row.path || "—"}</span>
        </Fact>
        <Fact label="Duration">{row.durationMs != null ? `${row.durationMs} ms` : "—"}</Fact>
        <Fact label="IP address">{row.ip || "—"}</Fact>
        <Fact label="Record ID">
          <span className="break-all font-mono text-xs">{row.entityId || "—"}</span>
        </Fact>
        <Fact label="Browser / device">
          <span className="text-xs">{row.userAgent || "—"}</span>
        </Fact>
      </dl>

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
          Raw recorded data (JSON)
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-border bg-muted p-3 text-[11px]">
          {JSON.stringify(row.meta || {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function DetailBody({ row, initialTab }) {
  const docRef = resolveDocRef(row);
  const [tab, setTab] = useState(initialTab === "document" && docRef ? "document" : "summary");

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-6 pb-3">
        <TabsList>
          <TabsTrigger value="summary" className="gap-1.5">
            <Info className="h-3.5 w-3.5" /> Summary
          </TabsTrigger>
          {docRef && (
            <TabsTrigger value="document" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Document
            </TabsTrigger>
          )}
          <TabsTrigger value="technical" className="gap-1.5">
            <Cog className="h-3.5 w-3.5" /> Technical
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="summary" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <SummaryTab row={row} docRef={docRef} onOpenDocument={() => setTab("document")} />
      </TabsContent>

      {docRef && (
        <TabsContent value="document" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <ActivityDocumentPreview docRef={docRef} />
        </TabsContent>
      )}

      <TabsContent value="technical" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <TechnicalTab row={row} />
      </TabsContent>
    </Tabs>
  );
}

export default function ActivityDetailDialog({ row, initialTab = "summary", onClose }) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 px-6 py-4 pr-12">
          <DialogTitle>{row?.description || row?.action || "Activity"}</DialogTitle>
          <DialogDescription>
            {row ? `${row.userName || "Unknown"} · ${fmtDateTime(row.createdAt)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {/* key: switching to another entry starts it fresh on the right tab */}
        {row ? <DetailBody key={row._id} row={row} initialTab={initialTab} /> : null}
      </DialogContent>
    </Dialog>
  );
}