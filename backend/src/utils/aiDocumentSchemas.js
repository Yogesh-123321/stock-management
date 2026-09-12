/*
  Registry of "what fields to ask AI for" per document type, keyed by a
  short `documentType` string the frontend passes to
  POST /api/ai/extract-document instead of repeating the field list on
  every call.

  This is the ONE file to touch when wiring a new upload screen into AI
  extraction — add an entry here, then have that screen's upload panel
  call the extract endpoint with `documentType: "yourNewKey"`. Nothing in
  aiDocumentExtract.js or the route/controller needs to change.

  (A screen can also skip this registry entirely and pass its own `fields`
  array directly in the request body — this file is a convenience, not a
  requirement.)
*/

export const DOCUMENT_SCHEMAS = {
  // Worked example — matches backend/src/models/TaxInvoice.js. Not yet
  // wired into the tax-invoice upload screen; kept here as a ready-to-use
  // reference for when that screen is connected.
  taxInvoice: [
    { name: "invoiceNumber", description: "The invoice/bill number printed on the document", type: "string" },
    { name: "invoiceDate", description: "The date the invoice was issued", type: "date (YYYY-MM-DD)" },
    { name: "vendorName", description: "The selling/issuing company's name", type: "string" },
    { name: "totalAmount", description: "The final total amount payable on the invoice", type: "number" },
    { name: "gstNumber", description: "The vendor's GSTIN, if printed on the invoice", type: "string" },
  ],
};

export const getDocumentSchema = (documentType) => DOCUMENT_SCHEMAS[documentType] || null;