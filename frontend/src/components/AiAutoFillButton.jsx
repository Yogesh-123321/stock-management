import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2 } from "lucide-react";
import { extractDocumentFields } from "@/lib/aiExtract";

/*
  Drop-in "Auto-fill from document" button for any upload form on the site.

  This is the ONE place the auto-fill button's look/behavior lives — every
  screen renders <AiAutoFillButton .../> next to its file input rather than
  building its own upload-and-parse button. Wiring a new screen is just:

    <AiAutoFillButton
      file={file}
      documentType="taxInvoice"           // or: fields={[{ name, description, type }]}
      onExtracted={(fields) => setForm((prev) => ({
        ...prev,
        invoiceNumber: fields.invoiceNumber ?? prev.invoiceNumber,
        // ...only fill in what came back; leave the rest of the form alone
      }))}
    />

  `onExtracted` receives the raw { fieldName: value } object from the AI —
  it's entirely up to the caller which of those values to apply and how
  (this component never touches form state itself). Nothing is ever
  submitted/saved by this button; it only proposes values for a form that
  still needs the person's own submit action, same as manual entry.
*/
export default function AiAutoFillButton({
  file,
  documentType,
  fields,
  onExtracted,
  label = "Auto-fill from document",
  size = "sm",
  variant = "outline",
  className = "",
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!file) {
      toast.error("Choose a file first");
      return;
    }
    setLoading(true);
    try {
      const result = await extractDocumentFields({ file, documentType, fields });
      onExtracted?.(result.fields, result);
      toast.success("Details suggested from the document — review before saving");
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Could not read details from that file");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={!file || loading}
      onClick={handleClick}
    >
      {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
      {loading ? "Reading document…" : label}
    </Button>
  );
}