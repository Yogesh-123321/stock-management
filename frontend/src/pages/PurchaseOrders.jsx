import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import { SortableHead, useSort } from "@/components/SortableHead";
import api from "@/lib/api";
import { FileText } from "lucide-react";

const statusVariant = {
  uploaded: "secondary",
  stock_entry_in_progress: "warning",
  completed: "success",
};

export default function PurchaseOrders() {
  const [pos, setPos] = useState([]);
  const [taxInvoices, setTaxInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const poSort = useSort();
  const invSort = useSort();
  const sortedPos = poSort.apply(pos, {
    vendor: (r) => r.vendor?.companyName,
    documentType: (r) => r.documentType,
    documentNumber: (r) => r.documentNumber,
    received: (r) => (r.receivedDate ? new Date(r.receivedDate).getTime() : null),
    status: (r) => r.status,
  });
  const sortedInvoices = invSort.apply(taxInvoices, {
    vendor: (r) => r.vendor?.companyName,
    invoiceNumber: (r) => r.invoiceNumber,
    invoiceDate: (r) => (r.invoiceDate ? new Date(r.invoiceDate).getTime() : null),
    against: (r) => `${r.purchaseOrder?.documentType || ""} ${r.purchaseOrder?.documentNumber || ""}`.trim(),
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/purchase-orders");
        setPos(data);
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not load purchase orders");
      } finally {
        setLoading(false);
      }
    })();

    (async () => {
      setLoadingInvoices(true);
      try {
        const { data } = await api.get("/tax-invoices");
        setTaxInvoices(data);
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not load tax invoices");
      } finally {
        setLoadingInvoices(false);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold mb-1">Purchase orders / invoices</h1>
      <p className="text-sm text-muted-foreground mb-6">{pos.length} document(s) uploaded</p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">All uploaded documents</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Vendor" sortKey="vendor" sort={poSort.sort} onSort={poSort.toggle} />
                <SortableHead label="Document type" sortKey="documentType" sort={poSort.sort} onSort={poSort.toggle} />
                <SortableHead label="Document no." sortKey="documentNumber" sort={poSort.sort} onSort={poSort.toggle} />
                <SortableHead label="Received" sortKey="received" sort={poSort.sort} onSort={poSort.toggle} />
                <SortableHead label="Status" sortKey="status" sort={poSort.sort} onSort={poSort.toggle} />
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
              {!loading && pos.length === 0 && <TableEmpty colSpan={6}>No documents uploaded yet.</TableEmpty>}
              {!loading &&
                sortedPos.map((po) => (
                  <TableRow key={po._id}>
                    <TableCell className="font-medium">{po.vendor?.companyName || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{po.documentType}</TableCell>
                    <TableCell className="font-mono-tech text-xs">{po.documentNumber || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(po.receivedDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[po.status]}>{po.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <a
                        href={po.documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> View
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base font-display">Tax invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Vendor" sortKey="vendor" sort={invSort.sort} onSort={invSort.toggle} />
                <SortableHead label="Invoice no." sortKey="invoiceNumber" sort={invSort.sort} onSort={invSort.toggle} />
                <SortableHead label="Invoice date" sortKey="invoiceDate" sort={invSort.sort} onSort={invSort.toggle} />
                <SortableHead label="Against document" sortKey="against" sort={invSort.sort} onSort={invSort.toggle} />
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingInvoices && <TableEmpty colSpan={5}>Loading…</TableEmpty>}
              {!loadingInvoices && taxInvoices.length === 0 && (
                <TableEmpty colSpan={5}>No tax invoices uploaded yet.</TableEmpty>
              )}
              {!loadingInvoices &&
                sortedInvoices.map((inv) => (
                  <TableRow key={inv._id}>
                    <TableCell className="font-medium">{inv.vendor?.companyName || "—"}</TableCell>
                    <TableCell className="font-mono-tech text-xs">{inv.invoiceNumber || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inv.purchaseOrder?.documentType} {inv.purchaseOrder?.documentNumber || ""}
                    </TableCell>
                    <TableCell>
                      <a
                        href={inv.documentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5" /> View
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}