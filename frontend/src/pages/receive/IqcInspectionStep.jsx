import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import api from "@/lib/api";
import IqcReportForm from "@/components/IqcReportForm";
import { ClipboardList, ClipboardCheck, XCircle } from "lucide-react";

const TABS = [
  { key: "in_iqc_stock", label: "IQC stock", description: "Awaiting an IQC report — not yet in main stock." },
  { key: "rejected", label: "Rejected stock", description: "Failed IQC — kept out of main stock permanently." },
];

export default function IqcStock() {
  const [tab, setTab] = useState("in_iqc_stock");
  const [entries, setEntries] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openEntryId, setOpenEntryId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, templatesRes] = await Promise.all([
        api.get("/stock-entries/iqc-stock", { params: { status: tab } }),
        api.get("/iqc-templates"),
      ]);
      setEntries(Array.isArray(entriesRes.data) ? entriesRes.data : []);
      setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
    } catch {
      setEntries([]);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const handleResolved = (updatedEntry) => {
    setOpenEntryId(null);
    // The line no longer belongs on this tab (it's now accepted/rejected).
    setEntries((prev) => prev.filter((e) => e._id !== updatedEntry._id));
  };

  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-semibold mb-1">IQC stock</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Material that has passed the tax invoice step but hasn't reached the parts master — either still waiting on
        inspection, or already rejected during it.
      </p>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "default" : "outline"} onClick={() => setTab(t.key)}>
            {t.key === "rejected" ? <XCircle className="h-4 w-4 mr-1.5" /> : <ClipboardList className="h-4 w-4 mr-1.5" />}
            {t.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{activeTab.label}</CardTitle>
          <CardDescription>{activeTab.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nothing here right now.</p>
          ) : tab === "rejected" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part no.</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Inspected by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e._id}>
                    <TableCell className="font-mono text-xs">{e.part?.ttUniquePartNumber}</TableCell>
                    <TableCell className="truncate max-w-[240px]" title={e.part?.itemDescription}>
                      {e.part?.itemDescription}
                    </TableCell>
                    <TableCell>{e.vendor?.companyName}</TableCell>
                    <TableCell className="text-right">{e.quantityReceived}</TableCell>
                    <TableCell>{e.iqcReport?.inspectedBy || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e._id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5 mr-1.5">
                          {e.part?.ttUniquePartNumber}
                        </span>
                        {e.part?.itemDescription}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {e.vendor?.companyName} · Qty received: {e.quantityReceived}
                      </p>
                    </div>
                    <Badge variant="warning">In IQC stock</Badge>
                  </div>

                  <div className="mt-2">
                    {openEntryId === e._id ? (
                      <IqcReportForm
                        entry={e}
                        templates={templates}
                        onDone={handleResolved}
                        onCancel={() => setOpenEntryId(null)}
                      />
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={() => setOpenEntryId(e._id)}>
                        <ClipboardCheck className="h-4 w-4 mr-1.5" />
                        Fill IQC report
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}