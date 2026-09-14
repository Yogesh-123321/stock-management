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
  // Matches backend/src/models/TaxInvoice.js. Used by
  // receive/TaxInvoiceStep.jsx to auto-check the invoice number, date and
  // quantity typed in against what's printed on the uploaded file.
  taxInvoice: [
    { name: "invoiceNumber", description: "The invoice/bill number printed on the document", type: "string" },
    { name: "invoiceDate", description: "The date the invoice was issued", type: "date (YYYY-MM-DD)" },
    { name: "vendorName", description: "The selling/issuing company's name", type: "string" },
    { name: "totalAmount", description: "The final total amount payable on the invoice", type: "number" },
    { name: "totalQuantity", description: "The total quantity of goods billed across all line items, if a total is stated or can be summed", type: "number" },
    { name: "gstNumber", description: "The vendor's GSTIN, if printed on the invoice", type: "string" },
  ],

  // Purchase order / proforma invoice uploaded in receive/POStep.jsx and
  // receive/PIStep.jsx — checked against the PO/PI number and total
  // quantity typed into that step.
  purchaseOrderDoc: [
    { name: "documentNumber", description: "The purchase order number printed on the document", type: "string" },
    { name: "vendorName", description: "The vendor/supplier the order was placed with", type: "string" },
    { name: "orderDate", description: "The date the purchase order was issued", type: "date (YYYY-MM-DD)" },
    { name: "totalQuantity", description: "The total quantity of items ordered, summed across all line items if not stated directly", type: "number" },
  ],
  proformaInvoiceDoc: [
    { name: "documentNumber", description: "The proforma invoice number printed on the document", type: "string" },
    { name: "vendorName", description: "The vendor/supplier who issued the proforma invoice", type: "string" },
    { name: "orderDate", description: "The date the proforma invoice was issued", type: "date (YYYY-MM-DD)" },
    { name: "totalQuantity", description: "The total quantity of items covered, summed across all line items if not stated directly", type: "number" },
  ],

  // Vendor/buyer supporting documents (VendorRegistrationForm.jsx and
  // BuyerRegistrationForm.jsx, which share the same field set and both
  // wire in via PartyDocumentAutoCheck.jsx).
  partyGstDoc: [
    { name: "companyName", description: "The registered business/company name on the GST certificate", type: "string" },
    { name: "gstNumber", description: "The GSTIN (GST identification number) printed on the certificate", type: "string" },
    { name: "address", description: "The principal place of business address, if printed", type: "string" },
  ],
  partyPanDoc: [
    { name: "companyName", description: "The name printed on the PAN card (company or individual holder name)", type: "string" },
    { name: "panNumber", description: "The 10-character PAN (Permanent Account Number) printed on the card", type: "string" },
  ],
  partyBankDoc: [
    { name: "accountHolderName", description: "The name of the account holder, as printed on the cheque/passbook", type: "string" },
    { name: "bankName", description: "The name of the bank", type: "string" },
    { name: "branch", description: "The bank branch name/location, if printed", type: "string" },
    { name: "accountNumber", description: "The bank account number", type: "string" },
    { name: "ifscCode", description: "The IFSC code of the branch", type: "string" },
  ],
  partyMsmeDoc: [
    { name: "companyName", description: "The enterprise/company name on the MSME (Udyam) certificate", type: "string" },
    { name: "msmeNumber", description: "The Udyam/MSME registration number printed on the certificate (e.g. UDYAM-XX-00-0000000)", type: "string" },
  ],
};

export const getDocumentSchema = (documentType) => DOCUMENT_SCHEMAS[documentType] || null;