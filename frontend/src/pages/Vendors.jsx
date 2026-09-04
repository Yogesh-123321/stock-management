import { useEffect, useMemo, useState } from "react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty } from "@/components/ui/table";
import VendorRegistrationForm from "@/components/VendorRegistrationForm";
import VendorItemsHover from "@/components/VendorItemsHover";
import PartyDocuments from "@/components/PartyDocuments";
import api from "@/lib/api";
import { Search, Eye, Download, UserPlus, Pencil, Ban, RotateCcw, Check, X, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

const statusVariant = { pending: "warning", approved: "success", rejected: "destructive" };

// Legacy vendors saved before the active/inactive flag existed count as active.
export const isVendorActive = (v) => (v?.activeStatus || "active") !== "inactive";

// GST number lives on taxRegistrationNo in the registration form; fall back to
// any legacy field name so older records still show their GSTIN.
export const vendorGst = (v) =>
  (v?.taxRegistrationNo || v?.gstNumber || v?.gstin || "").toString().trim();

const STATUS_ORDER = { pending: 0, approved: 1, rejected: 2 };

// Sort keys shown in the table header. `get` returns a comparable value.
const SORTS = {
  companyName: { label: "Company", get: (v) => (v.companyName || "").toLowerCase() },
  gst: { label: "GST no.", get: (v) => vendorGst(v).toLowerCase() },
  natureOfCompany: { label: "Nature", get: (v) => (v.natureOfCompany || "").toLowerCase() },
  status: { label: "Status", get: (v) => STATUS_ORDER[v.status] ?? 9 },
  active: { label: "Active", get: (v) => (isVendorActive(v) ? 0 : 1) },
  createdAt: { label: "Newest first", get: (v) => new Date(v.createdAt || 0).getTime() },
};

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [pendingInactive, setPendingInactive] = useState(null);
  const [inactiveReason, setInactiveReason] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sortKey, setSortKey] = useState("companyName");
  const [sortDir, setSortDir] = useState("asc");

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const get = SORTS[sortKey]?.get || SORTS.companyName.get;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...vendors].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === bv) return (a.companyName || "").localeCompare(b.companyName || "");
      // Empty values always sink to the bottom, whichever direction is picked.
      if (av === "") return 1;
      if (bv === "") return -1;
      return (av > bv ? 1 : -1) * dir;
    });
  }, [vendors, sortKey, sortDir]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/vendors", { params: search ? { search } : {} });
      setVendors(data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load vendors");
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
      await api.patch(`/vendors/${id}/${action}`, { approvedBy: "Purchase head" });
      toast.success(`Vendor ${action}d`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Action failed");
    }
  };

  const downloadForm = async (vendor) => {
    setDownloading(true);
    try {
      const { data } = await api.get(`/vendors/${vendor._id}/form`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([data]));
      const safeName = (vendor.companyName || "Vendor").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeName}_Supplier_Evaluation_Form.docx`;
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

  const downloadAllForms = async () => {
    setDownloadingAll(true);
    try {
      const { data } = await api.get("/vendors/export/all-forms", {
        params: search ? { search } : {},
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = "All_Vendors_Supplier_Evaluation_Forms.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not generate the combined form — try again");
    } finally {
      setDownloadingAll(false);
    }
  };

  const setActiveStatus = async (vendor, activeStatus, reason) => {
    setSavingStatus(true);
    try {
      await api.patch(`/vendors/${vendor._id}/active-status`, { activeStatus, reason });
      toast.success(
        activeStatus === "inactive"
          ? `${vendor.companyName} marked inactive`
          : `${vendor.companyName} is active again`
      );
      setPendingInactive(null);
      setInactiveReason("");
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update vendor status");
    } finally {
      setSavingStatus(false);
    }
  };

  const SortHead = ({ sortKeyName, children, className = "" }) => {
    const active = sortKey === sortKeyName;
    const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(sortKeyName)}
          className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
            active ? "text-foreground font-semibold" : ""
          }`}
          title={`Sort by ${SORTS[sortKeyName].label.toLowerCase()}`}
        >
          {children}
          <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} />
        </button>
      </TableHead>
    );
  };

  const term = search.trim();
  const noMatches = !loading && vendors.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-1">{vendors.length} vendor(s) on record</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search vendor name"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={downloadAllForms}
            disabled={downloadingAll || noMatches}
            title="Download every listed vendor's Supplier Evaluation Form as one .docx"
          >
            <Download className="h-4 w-4 mr-2" />
            {downloadingAll ? "Preparing..." : "Download all"}
          </Button>
          <Button onClick={() => setRegisterOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" /> Register vendor
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">All vendors</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <SortHead sortKeyName="companyName" className="w-[28%]">Company</SortHead>
                <SortHead sortKeyName="gst" className="w-[18%]">GST no.</SortHead>
                <SortHead sortKeyName="natureOfCompany" className="w-[14%]">Nature</SortHead>
                <SortHead sortKeyName="status" className="w-[10%]">Status</SortHead>
                <SortHead sortKeyName="active" className="w-[10%]">Active</SortHead>
                <TableHead className="w-[18%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableEmpty colSpan={6}>Loading…</TableEmpty>}
              {noMatches && (
                <TableEmpty colSpan={6}>
                  <div className="flex flex-col items-center gap-3 py-2">
                    <span>
                      {term ? `No vendor matches “${term}”.` : "No vendors found."}
                    </span>
                    <Button size="sm" onClick={() => setRegisterOpen(true)}>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      {term ? `Register “${term}” as a new vendor` : "Register a new vendor"}
                    </Button>
                  </div>
                </TableEmpty>
              )}
              {!loading &&
                sorted.map((v) => (
                  <TableRow key={v._id} className={isVendorActive(v) ? "" : "opacity-60"}>
                    <TableCell className="font-medium min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
<VendorItemsHover vendorId={v._id} remarks={v.remarks}>
                          <span className="truncate cursor-help border-b border-dotted border-muted-foreground/50">
                            {v.companyName}
                          </span>
                        </VendorItemsHover>
                        {v.isMsme && <Badge variant="secondary" className="shrink-0 text-[10px] px-1">MSME</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="id-chip truncate max-w-full inline-block align-middle">
                      {vendorGst(v) || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate min-w-0">{v.natureOfCompany}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[v.status]} className="text-[10px] px-1.5 py-0">{v.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {isVendorActive(v) ? (
                        <Badge variant="success" className="text-[10px] px-1.5 py-0">Active</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View" onClick={() => setDetail(v)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Edit" onClick={() => setEditing(v)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {v.status === "pending" && (
                          <>
                            <Button size="sm" className="h-7 w-7 p-0" title="Approve" onClick={() => act(v._id, "approve")}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="destructive" className="h-7 w-7 p-0" title="Reject" onClick={() => act(v._id, "reject")}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {isVendorActive(v) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Mark this vendor inactive"
                            onClick={() => {
                              setInactiveReason("");
                              setPendingInactive(v);
                            }}
                          >
                            <Ban className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="Mark this vendor active again"
                            disabled={savingStatus}
                            onClick={() => setActiveStatus(v, "active")}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
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
              <UserPlus className="h-4 w-4" /> Vendor registration form
            </DialogTitle>
            <DialogDescription>
              Matches the TISPL / PLC vendor registration form fields. New vendors start as pending until the
              purchase head approves them.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 pb-6">
            <VendorRegistrationForm
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
                  <Pencil className="h-4 w-4" /> Edit vendor
                </DialogTitle>
                <DialogDescription>
                  Update the registration details for <strong>{editing.companyName}</strong>. The approval
                  status stays unchanged.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto px-6 pb-6">
                <VendorRegistrationForm
                  key={editing._id}
                  vendor={editing}
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
                        {detail.vendorRegistrationNo || "No registration no."}
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
                      const v = detail;
                      setDetail(null);
                      setEditing(v);
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
                  <Field label="Vendor state">
                    {isVendorActive(detail) ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Inactive</Badge>
                    )}
                  </Field>
                  {!isVendorActive(detail) && (
                    <Field label="Inactive reason" full>{detail.inactiveReason || "—"}</Field>
                  )}
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

      <Dialog
        open={!!pendingInactive}
        onOpenChange={(open) => {
          if (!open) {
            setPendingInactive(null);
            setInactiveReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          {pendingInactive && (
            <>
              <DialogHeader>
                <DialogTitle>Mark vendor inactive?</DialogTitle>
                <DialogDescription>
                  <strong>{pendingInactive.companyName}</strong> stays on record with all its purchase
                  orders and stock history. It will be flagged as inactive wherever it is picked — including
                  the receive-material vendor step — and can be reactivated any time.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wide text-muted-foreground font-display">
                  Reason (optional)
                </label>
                <Input
                  placeholder="e.g. no longer supplying / blacklisted"
                  value={inactiveReason}
                  onChange={(e) => setInactiveReason(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPendingInactive(null);
                    setInactiveReason("");
                  }}
                  disabled={savingStatus}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setActiveStatus(pendingInactive, "inactive", inactiveReason)}
                  disabled={savingStatus}
                >
                  {savingStatus ? "Saving..." : "Mark inactive"}
                </Button>
              </DialogFooter>
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