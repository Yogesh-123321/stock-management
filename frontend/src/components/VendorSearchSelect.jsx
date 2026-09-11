import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import VendorRegistrationForm from "@/components/VendorRegistrationForm";
import api from "@/lib/api";
import { Search, UserPlus, Loader2, Ban, X } from "lucide-react";

// Vendors saved before the active/inactive flag existed count as active.
const isActive = (v) => (v?.activeStatus || "active") !== "inactive";

/*
  Dynamic, debounced vendor search dropdown — type any part of the vendor
  name, matches appear live. If nothing (or nothing usable) turns up, a
  "Register as a new vendor" entry is right there in the dropdown, same as
  the vendor step in Receive material. Registering hands the new vendor
  straight back via onSelect once submitted — it'll typically be "pending"
  until approved, same as receiving.

  value: the currently selected vendor object (or null)
  onSelect: (vendor) => void — called with the picked/registered vendor
*/
export default function VendorSearchSelect({ value, onSelect, placeholder }) {
  const [searchName, setSearchName] = useState(value?.companyName || "");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = searchName.trim();
    if (!term || (value && term === value.companyName)) {
      setResults([]);
      setSearching(false);
      return undefined;
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
  }, [searchName, value]);

  const pickVendor = (vendor) => {
    setShowForm(false);
    setOpen(false);
    setSearchName(vendor.companyName);
    onSelect?.(vendor);
  };

  const clearVendor = () => {
    setSearchName("");
    onSelect?.(null);
  };

  const startRegistration = () => {
    setShowForm(true);
    setOpen(false);
  };

  const handleRegistered = (vendor) => {
    setShowForm(false);
    setSearchName(vendor.companyName);
    onSelect?.(vendor);
  };

  const term = searchName.trim();

  return (
    <div className="space-y-2">
      <div ref={boxRef} className="relative z-30">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9 pr-9"
          placeholder={placeholder || "Start typing the vendor name…"}
          value={searchName}
          onChange={(e) => {
            setSearchName(e.target.value);
            if (value) onSelect?.(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!searching && value && (
          <button
            type="button"
            onClick={clearVendor}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            title="Clear vendor"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {open && term && !value && (
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
                      <Badge
                        variant={v.status === "approved" ? "success" : v.status === "pending" ? "warning" : "destructive"}
                      >
                        {v.status}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
              {!searching && results.length === 0 && (
                <li className="px-3 py-3 text-sm text-muted-foreground">No vendor matches “{term}”.</li>
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

      {value && (
        <div className="flex items-center gap-1.5 text-xs">
          {!isActive(value) && (
            <Badge variant="destructive">
              <Ban className="h-3 w-3" /> Inactive
            </Badge>
          )}
          <Badge variant={value.status === "approved" ? "success" : value.status === "pending" ? "warning" : "destructive"}>
            {value.status === "approved" ? "Approved" : value.status}
          </Badge>
          {value.status !== "approved" && (
            <span className="text-muted-foreground">— awaiting approval, can't be issued to yet</span>
          )}
        </div>
      )}

      {showForm && (
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <UserPlus className="h-4 w-4" /> Vendor registration form
          </p>
          <VendorRegistrationForm
            initialName={term}
            onRegistered={handleRegistered}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}