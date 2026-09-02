import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VendorRegistrationForm from "@/components/VendorRegistrationForm";
import api from "@/lib/api";
import { Search, ShieldCheck, UserPlus, Loader2, Ban, AlertTriangle } from "lucide-react";

// Vendors saved before the active/inactive flag existed count as active.
const isActive = (v) => (v?.activeStatus || "active") !== "inactive";

export default function VendorStep({ onVendorReady }) {
  const [searchName, setSearchName] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [matchedVendor, setMatchedVendor] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const boxRef = useRef(null);

  // Close the dropdown when clicking outside the search box
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Live, debounced, partial + case-insensitive vendor search
  useEffect(() => {
    const term = searchName.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/vendors", { params: { search: term } });
        setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not search vendors");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [searchName]);

  const pickVendor = (vendor) => {
    setMatchedVendor(vendor);
    setShowForm(false);
    setOpen(false);
    setSearchName(vendor.companyName);
  };

  const startRegistration = () => {
    setMatchedVendor(null);
    setShowForm(true);
    setOpen(false);
  };

  const handleRegistered = (vendor) => {
    setMatchedVendor(vendor);
    setShowForm(false);
  };

  const term = searchName.trim();
  const approved = results.filter((v) => v.status === "approved");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Step 1 · Vendor</CardTitle>
          <CardDescription>
            Start typing the vendor name — matching vendors appear as you type. If the vendor isn't listed,
            register it here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div ref={boxRef} className="relative z-40">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="e.g. DU… (type any part of the vendor name)"
              value={searchName}
              onChange={(e) => {
                setSearchName(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              autoComplete="off"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}

            {open && term && (
              <div className="absolute left-0 top-full z-[100] mt-1 w-full overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-xl isolate">
                <ul className="max-h-64 overflow-y-auto bg-card">
                  {results.map((v) => (
                    <li key={v._id}>
                      <button
                        type="button"
                        onClick={() => pickVendor(v)}
                        className={`flex w-full items-center justify-between gap-3 bg-card px-3 py-2 text-left text-sm hover:bg-secondary ${isActive(v) ? "" : "opacity-70"}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{v.companyName}</span>
                          {v.address && (
                            <span className="block truncate text-xs text-muted-foreground">{v.address}</span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {!isActive(v) && (
                            <Badge variant="destructive">
                              <Ban className="h-3 w-3" /> Inactive
                            </Badge>
                          )}
                          <Badge variant={v.status === "approved" ? "success" : v.status === "pending" ? "warning" : "destructive"}>
                            {v.status}
                          </Badge>
                        </span>
                      </button>
                    </li>
                  ))}
                  {!searching && results.length === 0 && (
                    <li className="px-3 py-3 text-sm text-muted-foreground">
                      No vendor matches “{term}”.
                    </li>
                  )}
                </ul>
                <div className="border-t border-border bg-card">
                  <button
                    type="button"
                    onClick={startRegistration}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-secondary"
                  >
                    <UserPlus className="h-4 w-4" />
                    Register “{term}” as a new vendor
                  </button>
                </div>
              </div>
            )}
          </div>

          {matchedVendor && (
            <div className="mt-4 flex items-center justify-between gap-4 rounded-md border border-border p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{matchedVendor.companyName}</p>
                  {!isActive(matchedVendor) && (
                    <Badge variant="destructive">
                      <Ban className="h-3 w-3" /> Marked inactive
                    </Badge>
                  )}
                  {matchedVendor.status === "approved" ? (
                    <Badge variant="success">
                      <ShieldCheck className="h-3 w-3" /> Registered &amp; approved
                    </Badge>
                  ) : (
                    <Badge variant="warning">{matchedVendor.status}</Badge>
                  )}
                </div>
                {matchedVendor.address && (
                  <p className="mt-1 text-sm text-muted-foreground">{matchedVendor.address}</p>
                )}
                {!isActive(matchedVendor) && (
                  <p className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      This vendor has been marked <strong>inactive</strong>
                      {matchedVendor.inactiveReason ? ` — ${matchedVendor.inactiveReason}` : ""}. Continue only
                      if you are receiving against an older commitment.
                    </span>
                  </p>
                )}
                {matchedVendor.status !== "approved" && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Awaiting purchase-head approval before a PO can be uploaded.
                  </p>
                )}
              </div>
              {matchedVendor.status === "approved" && (
                <Button onClick={() => onVendorReady(matchedVendor)}>Continue</Button>
              )}
            </div>
          )}

          {term && !searching && approved.length === 0 && !matchedVendor && !showForm && (
            <div className="mt-4 rounded-md border border-accent/30 bg-accent/5 p-3 text-sm text-accent">
              No approved vendor found for “{term}”. Register the vendor to continue.
            </div>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Vendor registration form
            </CardTitle>
            <CardDescription>Matches the TISPL / PLC vendor registration form fields.</CardDescription>
          </CardHeader>
          <CardContent>
            <VendorRegistrationForm
              initialName={term}
              onRegistered={handleRegistered}
              onCancel={() => setShowForm(false)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
