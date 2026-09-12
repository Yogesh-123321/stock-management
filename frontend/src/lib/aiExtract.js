import api from "@/lib/api";

/*
  Central frontend helper for "read this uploaded file with AI and suggest
  field values" — every upload form calls this one function instead of
  building its own multipart request. Returns suggested values only;
  nothing is saved anywhere by calling this. The caller is responsible for
  putting the result into editable form state so the person can review and
  correct it before actually submitting the form.

  Usage (once a screen is wired up):
    const { fields } = await extractDocumentFields({ file, documentType: "taxInvoice" });
    setForm((prev) => ({ ...prev, invoiceNumber: fields.invoiceNumber ?? prev.invoiceNumber, ... }));

  Or, for a document type that has no entry yet in the backend's
  aiDocumentSchemas.js registry, pass the field list directly:
    const { fields } = await extractDocumentFields({
      file,
      fields: [{ name: "poNumber", description: "The PO number", type: "string" }],
    });
*/
export async function extractDocumentFields({ file, documentType, fields }) {
  if (!file) throw new Error("No file given to extract from");
  if (!documentType && !fields) {
    throw new Error("Provide either documentType or a fields array");
  }

  const fd = new FormData();
  fd.append("file", file);
  if (documentType) fd.append("documentType", documentType);
  if (fields) fd.append("fields", JSON.stringify(fields));

  const { data } = await api.post("/ai/extract-document", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data; // { fields: {...}, modelUsed }
}