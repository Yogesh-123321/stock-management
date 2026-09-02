import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
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
                <TableHead>Vendor</TableHead>
                <TableHead>Document type</TableHead>
                <TableHead>Document no.</TableHead>
                <TableHead>Received</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
              {!loading && pos.length === 0 && <TableEmpty colSpan={6}>No documents uploaded yet.</TableEmpty>}
              {!loading &&
                pos.map((po) => (
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
                <TableHead>Vendor</TableHead>
                <TableHead>Invoice no.</TableHead>
                <TableHead>Invoice date</TableHead>
                <TableHead>Against document</TableHead>
                <TableHead>File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingInvoices && <TableEmpty colSpan={5}>Loading…</TableEmpty>}
              {!loadingInvoices && taxInvoices.length === 0 && (
                <TableEmpty colSpan={5}>No tax invoices uploaded yet.</TableEmpty>
              )}
              {!loadingInvoices &&
                taxInvoices.map((inv) => (
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