import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import BuyerRegistrationForm from "@/components/BuyerRegistrationForm";
import PartyDocuments from "@/components/PartyDocuments";
import api from "@/lib/api";
import { Search, Eye, Download, UserPlus, Pencil, Check, X } from "lucide-react";

const statusVariant = { pending: "warning", approved: "success", rejected: "destructive" };

export default function Buyers() {
  const [buyers, setBuyers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/buyers", { params: search ? { search } : {} });
      setBuyers(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load buyers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const act = async (id, action) => {
    try {
      await api.patch(`/buyers/${id}/${action}`, { approvedBy: "Sales head" });
      toast.success(`Buyer ${action}d`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Action failed");
    }
  };

  const downloadForm = async (buyer) => {
    setDownloading(true);
    try {
      const { data } = await api.get(`/buyers/${buyer._id}/form`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data]));
      const safeName = (buyer.companyName || "Buyer").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}_Buyer_Registration_Form.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Could not generate the form — try again");
    } finally {
      setDownloading(false);
    }
  };

  const term = search.trim();
  const noMatches = !loading && buyers.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Buyers</h1>
          <p className="text-sm text-muted-foreground mt-1">{buyers.length} buyer(s) on record</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search buyer name"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setRegisterOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Register buyer
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">All buyers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[32%]">Company</TableHead>
                <TableHead className="w-[22%]">GST no.</TableHead>
                <TableHead className="w-[16%]">Nature</TableHead>
                <TableHead className="w-[12%]">Status</TableHead>
                <TableHead className="w-[18%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={5}>Loading…</TableEmpty>}
              {noMatches && (
                <TableEmpty colSpan={5}>
                  <div className="flex flex-col items-center gap-3 py-2">
                    <span>{term ? `No buyer matches “${term}”.` : "No buyers found."}</span>
                    <Button size="sm" onClick={() => setRegisterOpen(true)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      {term ? `Register “${term}” as a new buyer` : "Register a new buyer"}
                    </Button>
                  </div>
                </TableEmpty>
              )}
              {!loading &&
                buyers.map((b) => (
                  <TableRow key={b._id}>
                    <TableCell className="font-medium min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{b.companyName}</span>
                        {b.isMsme && <Badge variant="secondary" className="shrink-0 text-[10px] px-1">MSME</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="id-chip truncate max-w-full inline-block align-middle">
                        {b.taxRegistrationNo || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate min-w-0">{b.natureOfCompany}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[b.status]} className="text-[10px] px-1.5 py-0">{b.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View" onClick={() => setDetail(b)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => setEditing(b)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {b.status === "pending" && (
                          <>
                            <Button size="sm" className="h-7 w-7 p-0" title="Approve" onClick={() => act(b._id, "approve")}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="destructive" className="h-7 w-7 p-0" title="Reject" onClick={() => act(b._id, "reject")}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Buyer registration form
            </DialogTitle>
            <DialogDescription>
              Same field set as the vendor registration form. New buyers start as pending until they are
              approved.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 pb-6">
            <BuyerRegistrationForm
              key={registerOpen ? "open" : "closed"}
              initialName={term}
              onCancel={() => setRegisterOpen(false)}
              onRegistered={() => {
                setRegisterOpen(false);
                setSearch("");
                load();
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {editing && (
            <>
              <DialogHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="h-4 w-4" /> Edit buyer
                </DialogTitle>
                <DialogDescription>
                  Update the registration details for <strong>{editing.companyName}</strong>. The approval
                  status stays unchanged.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto px-6 pb-6">
                <BuyerRegistrationForm
                  key={editing._id}
                  buyer={editing}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    load();
                  }}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {detail && (
            <>
              <DialogHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
                {/* Title block and actions stack so a long registration no. can never push
                    the Edit / Download buttons outside the dialog. */}
                <div className="min-w-0 pr-8">
                  <DialogTitle className="break-words">{detail.companyName}</DialogTitle>
                  <DialogDescription asChild>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="id-chip max-w-full break-all whitespace-normal text-left leading-snug">
                        {detail.buyerRegistrationNo || "No registration no."}
                      </span>
                      {detail.isMsme && <Badge variant="secondary">MSME</Badge>}
                    </div>
                  </DialogDescription>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const b = detail;
                      setDetail(null);
                      setEditing(b);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadForm(detail)} disabled={downloading}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    {downloading ? "Preparing..." : "Download"}
                  </Button>
                </div>
              </DialogHeader>
              <div className="overflow-y-auto px-6 pb-6">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <Field label="Status">
                    <Badge variant={statusVariant[detail.status]}>{detail.status}</Badge>
                  </Field>
                  <Field label="Nature of company">{detail.natureOfCompany || "—"}</Field>
                  <Field label="Nature of business">{detail.natureOfBusiness || "—"}</Field>
                  <Field label="Contact person">{detail.contactPersonName || "—"}</Field>
                  <Field label="Phone">{detail.phone || "—"}</Field>
                  <Field label="Email">{detail.email || "—"}</Field>
                  <Field label="MSME">{detail.isMsme ? "Yes" : "No"}</Field>
                  <Field label="MSME / Udyam no.">{detail.msmeNumber || "—"}</Field>
                  <Field label="Tax / GST registration" full>{detail.taxRegistrationNo || "—"}</Field>
                  <Field label="Excise registration" full>{detail.exciseRegistrationNo || "—"}</Field>
                  <Field label="Address" full>{detail.address || "—"}</Field>
                  <Field label="Bank details" full>
                    <span className="whitespace-pre-line">{detail.bankDetails || "—"}</span>
                  </Field>
                  <Field label="Supporting documents" full>
                    <PartyDocuments party={detail} />
                  </Field>
                  {detail.signatoryName && (
                    <Field label="Signatory">
                      {detail.signatoryName}
                      {detail.signatoryDesignation ? ` — ${detail.signatoryDesignation}` : ""}
                    </Field>
                  )}
                </dl>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground font-display mb-0.5">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
