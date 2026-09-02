import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatIndianNumber } from "./numberToWordsIndian.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "tispl-logo.jpeg");

/* The buying entity on the purchase order — exactly as printed on the
   reference PO (Invoice To / Consignee blocks). */
export const PO_COMPANY = {
  name: "TECHNOTRENDZ SOLUTIONS PRIVATE LIMITED",
  address:
    "Plot No. 101 (HUDA),Sector 59,HSIIDC Industrial Estate,Faridabad-Haryana-121004",
  gstin: "06AAFCT7227C1ZJ",
  stateName: "Haryana",
  stateCode: "06",
  email: "info@technotrendz.co.in",
};

export const DEFAULT_DECLARATION =
  "2). Dispatch Each Lot only after Clearance from our QA department on Test Report, R.M. Report & Third Party R.M. Report.\n" +
  "3)Supplier to Replenish any Rejected / Unaccepted Quantity on Next Day of the Report by Technotrendz (Rejected Qty to be settled without hindrance on our Production ). Else Any Financial loss shall be on Supplier's account.";

export const DEFAULT_DECLARATION_FOOT =
  "4)Suppler to send Original Dispatch documents, Test Certificate, Material Test Reports along with the shipment and on email to Stores & QA department";

// 29-Apr-26 — the exact date format used on the reference PO.
const fmtDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
};

const fmtQty = (qty, unit) => `${formatIndianNumber(Number(qty) || 0, 2)} ${unit || "NOS"}`;

const taxRows = (po) => {
  const rows = [];
  const rate = Number(po.taxRate) || 0;
  if (po.taxType === "CGST_SGST" && rate) {
    rows.push(["CGST INPUT", (Number(po.taxAmount) || 0) / 2]);
    rows.push(["SGST INPUT", (Number(po.taxAmount) || 0) / 2]);
  } else if (po.taxType === "IGST" && rate) {
    rows.push(["IGST INPUT", Number(po.taxAmount) || 0]);
  }
  if (Number(po.roundOff)) rows.push(["ROUND OFF", Number(po.roundOff)]);
  return rows;
};

/**
 * Renders the Purchase Order as a PDF laid out to match the Technotrendz PO
 * template: the title band, the Invoice To / Consignee / Supplier column beside
 * the voucher-details grid, the goods table (Sl No. · Description of Goods ·
 * HSN/SAC · Due on · Quantity · Rate · per · Amount), the totals, the amount in
 * words, the declaration and the signature block — repeated across pages when
 * the items do not fit on one sheet.
 *
 * Returns a Promise<Buffer> so the controller can send it directly.
 */
export function generatePoPdf(po) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 20, autoFirstPage: false });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const M = 20;
    const X = M;
    const PAGE_W = 595.28; // A4
    const PAGE_H = 841.89;
    const W = PAGE_W - M * 2;
    const PAGE_BOTTOM = PAGE_H - M - 14; // 14pt reserved for the footnote

    // --- helpers ----------------------------------------------------------
    const line = (x1, y1, x2, y2) => doc.lineWidth(0.7).moveTo(x1, y1).lineTo(x2, y2).stroke();
    const rect = (x, y, w, h) => doc.lineWidth(0.7).rect(x, y, w, h).stroke();
    const put = (text, x, y, w, opts = {}) => {
      const { size = 8, bold = false, italic = false, align = "left", pad = 2, lineGap = 0, lineBreak = true } = opts;
      const font = bold
        ? italic
          ? "Helvetica-BoldOblique"
          : "Helvetica-Bold"
        : italic
          ? "Helvetica-Oblique"
          : "Helvetica";
      doc
        .font(font)
        .fontSize(size)
        .fillColor("#000")
        .text(String(text ?? ""), x + pad, y + pad, { width: w - pad * 2, align, lineGap, lineBreak });
    };
    const heightOf = (text, w, opts = {}) => {
      const { size = 8, bold = false, pad = 2 } = opts;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      return doc.heightOfString(String(text ?? ""), { width: w - pad * 2 });
    };

    // --- column geometry ---------------------------------------------------
    const colW = { sl: 26, desc: 230, hsn: 55, due: 55, qty: 62, rate: 45, per: 27, amount: 55 };
    const xSl = X;
    const xDesc = xSl + colW.sl;
    const xHsn = xDesc + colW.desc;
    const xDue = xHsn + colW.hsn;
    const xQty = xDue + colW.due;
    const xRate = xQty + colW.qty;
    const xPer = xRate + colW.rate;
    const xAmount = xPer + colW.per;
    const xEnd = X + W;
    const colLines = [xDesc, xHsn, xDue, xQty, xRate, xPer, xAmount];

    // --- band heights -------------------------------------------------------
    const H_TITLE = 22;
    const H_INVOICE_TO = 78;
    const H_CONSIGNEE = 90;
    const H_SUPPLIER = 68;
    const H_HEAD = H_INVOICE_TO + H_CONSIGNEE + H_SUPPLIER; // 236
    const H_THEAD = 20;
    const H_TOTAL_ROW = 18;
    const H_WORDS = 30;
    const H_DECL = 95;
    const H_BOTTOM = H_TOTAL_ROW + H_WORDS + H_DECL;
    const H_TAX_BLOCK = 52; // sub-total / tax / round-off lines above the total row

    const xMid = X + 341; // left party column | right voucher grid
    const xMidSplit = xMid + Math.round((xEnd - xMid) * 0.55);

    const bodyTop = M + H_TITLE + H_HEAD + H_THEAD;
    const capFull = PAGE_BOTTOM - bodyTop;
    const capLast = capFull - H_BOTTOM - H_TAX_BLOCK;

    // --- header (repeated on every page) -------------------------------------
    const drawHeader = (pageNo) => {
      let y = M;
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#000")
        .text(pageNo === 1 ? "PURCHASE ORDER" : `PURCHASE ORDER(Page  ${pageNo})`, X, y + 3, {
          width: W,
          align: "center",
        });
      y += H_TITLE;

      rect(X, y, W, H_HEAD);
      line(xMid, y, xMid, y + H_HEAD);

      // ---- left column: Invoice To ----
      let ly = y;
      if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, X + 6, ly + 6, { fit: [58, 58] });
      const txtX = X + 70;
      const txtW = xMid - txtX;
      put("Invoice To", txtX, ly + 3, txtW, { size: 8 });
      put(PO_COMPANY.name, txtX, ly + 14, txtW, { size: 8, bold: true });
      put(PO_COMPANY.address, txtX, ly + 24, txtW, { size: 6.5 });
      put(`GSTIN/UIN: ${PO_COMPANY.gstin}`, txtX, ly + 44, txtW, { size: 7 });
      put(`State Name :  ${PO_COMPANY.stateName}, Code : ${PO_COMPANY.stateCode}`, txtX, ly + 54, txtW, { size: 7 });
      put(`E-Mail : ${PO_COMPANY.email}`, txtX, ly + 64, txtW, { size: 7 });
      ly += H_INVOICE_TO;
      line(X, ly, xMid, ly);

      // ---- left column: Consignee (ship to) ----
      const consignee = {
        name: po.consigneeName || PO_COMPANY.name,
        address: po.consigneeAddress || PO_COMPANY.address,
        email: po.consigneeEmail || PO_COMPANY.email,
        gstin: po.consigneeGSTIN || PO_COMPANY.gstin,
        stateName: po.consigneeStateName || PO_COMPANY.stateName,
        stateCode: po.consigneeStateCode || PO_COMPANY.stateCode,
      };
      put("Consignee (Ship to)", X, ly + 1, xMid - X, { size: 7.5 });
      put(consignee.name, X, ly + 11, xMid - X, { size: 8.5, bold: true });
      put(consignee.address, X, ly + 22, xMid - X, { size: 7.5 });
      put(`e-mail : ${consignee.email}`, X, ly + 42, xMid - X, { size: 7.5 });
      put("GSTIN/UIN", X, ly + 54, 70, { size: 7.5 });
      put(`: ${consignee.gstin}`, X + 72, ly + 54, xMid - X - 72, { size: 7.5 });
      put("State Name", X, ly + 66, 70, { size: 7.5 });
      put(`: ${consignee.stateName}, Code : ${consignee.stateCode}`, X + 72, ly + 66, xMid - X - 72, { size: 7.5 });
      ly += H_CONSIGNEE;
      line(X, ly, xMid, ly);

      // ---- left column: Supplier (bill from) ----
      put("Supplier (Bill from)", X, ly + 1, xMid - X, { size: 7.5 });
      put(po.supplierName || "", X, ly + 11, xMid - X, { size: 8.5, bold: true });
      put(po.supplierAddress || "", X, ly + 22, xMid - X, { size: 7.5 });
      put("GSTIN/UIN", X, ly + 42, 70, { size: 7.5 });
      put(`: ${po.supplierGSTIN || ""}`, X + 72, ly + 42, xMid - X - 72, { size: 7.5 });
      put("State Name", X, ly + 54, 70, { size: 7.5 });
      put(
        `: ${po.supplierStateName || ""}${po.supplierStateCode ? `, Code : ${po.supplierStateCode}` : ""}`,
        X + 72,
        ly + 54,
        xMid - X - 72,
        { size: 7.5 },
      );

      // ---- right column: voucher grid ----
      const rowH = [32, 32, 32, 26];
      let ry = y;
      const cell = (label, value, x, w, yy, h, opts = {}) => {
        put(label, x, yy + 1, w, { size: 7.5 });
        if (value) put(value, x, yy + 12, w, { size: opts.size || 8.5, bold: true });
      };

      // row 1 — Voucher No. | Dated
      line(xMidSplit, ry, xMidSplit, ry + rowH[0]);
      cell("Voucher No.", po.voucherNo || "", xMid, xMidSplit - xMid, ry);
      cell("Dated", fmtDate(po.voucherDate), xMidSplit, xEnd - xMidSplit, ry);
      ry += rowH[0];
      line(xMid, ry, xEnd, ry);

      // row 2 — (blank) | Mode/Terms of Payment
      line(xMidSplit, ry, xMidSplit, ry + rowH[1]);
      cell("Mode/Terms of Payment", po.paymentTerms || "", xMidSplit, xEnd - xMidSplit, ry);
      ry += rowH[1];
      line(xMid, ry, xEnd, ry);

      // row 3 — Reference No. & Date. | Other References
      line(xMidSplit, ry, xMidSplit, ry + rowH[2]);
      cell("Reference No. & Date.", po.referenceNo || "", xMid, xMidSplit - xMid, ry);
      cell("Other References", po.otherReferences || "", xMidSplit, xEnd - xMidSplit, ry);
      ry += rowH[2];
      line(xMid, ry, xEnd, ry);

      // row 4 — Dispatched through | Destination
      line(xMidSplit, ry, xMidSplit, ry + rowH[3]);
      cell("Dispatched through", po.dispatchedThrough || "", xMid, xMidSplit - xMid, ry);
      cell("Destination", po.destination || "", xMidSplit, xEnd - xMidSplit, ry);
      ry += rowH[3];
      line(xMid, ry, xEnd, ry);

      // row 5 — Terms of Delivery (full width of the right column)
      put("Terms of Delivery", xMid, ry + 1, xEnd - xMid, { size: 7.5 });
      if (po.termsOfDelivery) put(po.termsOfDelivery, xMid, ry + 12, xEnd - xMid, { size: 7.5, bold: true });

      y += H_HEAD;

      // ---- table head ----
      rect(X, y, W, H_THEAD);
      colLines.forEach((x) => line(x, y, x, y + H_THEAD));
      put("Sl\nNo.", xSl, y + 1, colW.sl, { size: 7 });
      put("Description of Goods", xDesc, y + 5, colW.desc, { size: 7.5, align: "center" });
      put("HSN/SAC", xHsn, y + 5, colW.hsn, { size: 7.5, align: "center" });
      put("Due on", xDue, y + 5, colW.due, { size: 7.5, align: "center" });
      put("Quantity", xQty, y + 5, colW.qty, { size: 7.5, align: "center" });
      put("Rate", xRate, y + 5, colW.rate, { size: 7.5, align: "center" });
      put("per", xPer, y + 5, colW.per, { size: 7.5, align: "center" });
      put("Amount", xAmount, y + 5, colW.amount, { size: 7.5, align: "center" });
    };

    // --- measure every row up-front so pagination is exact -------------------
    const items = (po.items || []).map((it, i) => {
      const descH = heightOf(it.description || "", colW.desc, { size: 8, bold: true });
      const partH = it.partNo ? heightOf(it.partNo, colW.desc - 8, { size: 7.5 }) : 0;
      return { ...it, index: i + 1, height: Math.max(descH + partH + 4, 18) };
    });

    // Greedy pagination: fill each page, and make sure the final page still has
    // room for the tax lines, the total row, the words band and the declaration.
    const pages = [[]];
    let used = 0;
    for (const item of items) {
      if (used + item.height > capFull && pages[pages.length - 1].length > 0) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(item);
      used += item.height;
    }
    if (used > capLast) pages.push([]);

    const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
    const unit = items[0]?.unit || "NOS";

    // --- draw ----------------------------------------------------------------
    pages.forEach((pageItems, pageIdx) => {
      const isLast = pageIdx === pages.length - 1;
      doc.addPage();
      drawHeader(pageIdx + 1);

      const bodyBottom = isLast ? PAGE_BOTTOM - H_BOTTOM : PAGE_BOTTOM;
      const bodyH = bodyBottom - bodyTop;
      rect(X, bodyTop, W, bodyH);
      colLines.forEach((x) => line(x, bodyTop, x, bodyTop + bodyH));

      let rowY = bodyTop + 2;
      pageItems.forEach((item) => {
        put(String(item.index), xSl, rowY, colW.sl, { size: 8, align: "right" });
        put(item.description || "", xDesc, rowY, colW.desc, { size: 8, bold: true });
        if (item.partNo) {
          const descH = heightOf(item.description || "", colW.desc, { size: 8, bold: true });
          put(item.partNo, xDesc + 8, rowY + descH, colW.desc - 8, { size: 7.5, italic: true });
        }
        put(item.hsnSac || "", xHsn, rowY, colW.hsn, { size: 8, align: "center" });
        put(fmtDate(item.dueOn || po.voucherDate), xDue, rowY, colW.due, { size: 7.5, italic: true, align: "center" });
        put(fmtQty(item.quantity, item.unit), xQty, rowY, colW.qty, { size: 7.5, bold: true, align: "right" });
        put(formatIndianNumber(item.rate, 2), xRate, rowY, colW.rate, { size: 8, align: "right" });
        put(item.per || item.unit || "NOS", xPer, rowY, colW.per, { size: 7.5, align: "left" });
        put(formatIndianNumber(item.amount, 2), xAmount, rowY, colW.amount, { size: 8, bold: true, align: "right" });
        rowY += item.height;
      });

      if (!isLast) {
        put("continued ...", xDesc, bodyBottom - 16, xEnd - xDesc - 6, { size: 8.5, align: "right" });
        doc
          .font("Helvetica")
          .fontSize(8)
          .text("This is a Computer Generated Document", X, PAGE_BOTTOM + 2, { width: W, align: "center" });
        return;
      }

      // ---- sub-total, tax and round-off, right-aligned inside the body ----
      const rows = taxRows(po);
      let ty = Math.max(rowY + 6, bodyBottom - H_TAX_BLOCK);
      if (rows.length > 0) {
        line(xAmount, ty - 3, xEnd, ty - 3);
        put(formatIndianNumber(po.subTotal, 2), xAmount, ty, colW.amount, { size: 8, align: "right" });
        ty += 14;
        rows.forEach(([label, value]) => {
          put(label, xDesc, ty, colW.desc, { size: 8, bold: true, italic: true, align: "right" });
          put(formatIndianNumber(value, 2), xAmount, ty, colW.amount, { size: 8, bold: true, align: "right" });
          ty += 12;
        });
      }

      // ---- total row ----
      let y = bodyBottom;
      rect(X, y, W, H_TOTAL_ROW);
      colLines.forEach((x) => line(x, y, x, y + H_TOTAL_ROW));
      put("Total", xDesc, y + 4, colW.desc, { size: 8.5, bold: true, align: "right" });
      put(`${formatIndianNumber(totalQty, 2)} ${unit}`, xQty, y + 4, colW.qty, {
        size: 7.5,
        bold: true,
        align: "right",
      });
      put(formatIndianNumber(po.totalAmount, 2), xAmount, y + 3, colW.amount, {
        size: 8.5,
        bold: true,
        align: "right",
      });
      y += H_TOTAL_ROW;

      // ---- amount chargeable (in words) ----
      rect(X, y, W, H_WORDS);
      put("Amount Chargeable (in words)", X, y + 1, W * 0.6, { size: 7.5 });
      put("E. & O.E", xAmount - 40, y + 1, colW.amount + 40, { size: 7.5, italic: true, align: "right" });
      put(po.amountInWords || "", X, y + 13, W, { size: 8.5, bold: true });
      y += H_WORDS;

      // ---- declaration + signature ----
      rect(X, y, W, H_DECL);
      const signX = X + W * 0.55;
      line(signX, y + H_DECL - 40, signX, y + H_DECL);
      line(signX, y + H_DECL - 40, xEnd, y + H_DECL - 40);
      put("Declaration", X, y + 1, signX - X, { size: 7.5 });
      put(po.declaration || DEFAULT_DECLARATION, X, y + 11, signX - X, { size: 7.5, lineGap: 0.5 });
      put(DEFAULT_DECLARATION_FOOT, X, y + H_DECL - 14, signX - X, { size: 5.5 });
      put(`for ${PO_COMPANY.name}`, signX, y + H_DECL - 36, xEnd - signX, { size: 8, bold: true, align: "center" });
      put("Authorised Signatory", signX, y + H_DECL - 14, xEnd - signX, { size: 8, align: "right" });

      doc
        .font("Helvetica")
        .fontSize(8)
        .text("This is a Computer Generated Document", X, PAGE_BOTTOM + 2, { width: W, align: "center" });
    });

    doc.end();
  });
}
