import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatIndianNumber } from "./numberToWordsIndian.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "tispl-logo.jpeg");

const COMPANY = {
  name: "TECHNOTRENDZ INNOVATIVE SOLUTIONS PVT. LTD",
  corporateOffice:
    "Corporate Office : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004, INDIA",
  registeredOfficeLabel: "Regis. Office",
  registeredOffice: " : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004",
  worksAddress:
    "Second Floor, Plot No-101 (HUDA), Sector-59, HSIIDC Industrial Estate, Faridabad-121004, Haryana, India",
  gstin: "GSTIN/UIN: 06AANCT1097L1ZS",
};

const fmtDate = (d) =>
  d
    ? new Date(d)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
        .toUpperCase()
        .replace(/ /g, "-")
    : "";

const fmtShortDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "";

const taxLabel = (pi) => {
  if (pi.taxType === "NONE" || !pi.taxRate) return null;
  if (pi.taxType === "CGST_SGST") return `CGST @${pi.taxRate / 2}% + SGST @${pi.taxRate / 2}%`;
  return `IGST @${pi.taxRate}%`;
};

/**
 * Renders the Proforma Invoice as a PDF laid out to match the TISPL PI
 * template (the same layout the .xlsx used to produce): a single bordered
 * sheet with the logo/corporate-office header, the company / invoice-no /
 * date band, the notes band, the buyer block, the item table, totals,
 * amount in words, bank details and the signature block.
 *
 * Returns a Promise<Buffer> so the controller can send it directly.
 */
export function generatePiPdf(pi) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 30 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const M = 30;
    const X = M;
    const W = doc.page.width - M * 2; // 535
    const Y = M;

    // --- Column geometry (item table columns drive every band boundary) ---
    const colW = { sl: 40, particulars: 245, hsn: 60, qty: 55, rate: 65, amount: 70 };
    const xSl = X;
    const xParticulars = xSl + colW.sl;
    const xHsn = xParticulars + colW.particulars;
    const xQty = xHsn + colW.hsn;
    const xRate = xQty + colW.qty;
    const xAmount = xRate + colW.rate;
    const xEnd = X + W;

    // Left / middle / right band boundaries (mirror the template's merges)
    const bandLeft = xSl;
    const bandMid = xHsn;
    const bandRight = xQty;

    // --- Band heights ------------------------------------------------------
    const H_HEADER = 60;
    const H_TITLE = 18;
    const H_INVOICE = 30;
    const H_NOTES = 85;
    const H_BUYER = 95;
    const H_THEAD = 14;
    const H_TOTAL = 18;
    const H_WORDS = 14;
    const H_BANK = 45;
    const H_SIGN = 70;

    const fixed =
      H_HEADER + H_TITLE + H_INVOICE + H_NOTES + H_BUYER + H_THEAD + H_TOTAL + H_WORDS + H_BANK + H_SIGN;
    const H_BODY = doc.page.height - M * 2 - fixed;

    const line = (x1, y1, x2, y2) => doc.lineWidth(0.8).moveTo(x1, y1).lineTo(x2, y2).stroke();
    const rect = (x, y, w, h) => doc.lineWidth(0.8).rect(x, y, w, h).stroke();
    const put = (text, x, y, w, opts = {}) => {
      const { size = 8, bold = true, align = "left", pad = 3, height, lineGap = 0, lineBreak = true } = opts;
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(size)
        .fillColor("#000")
        .text(String(text ?? ""), x + pad, y + pad, {
          width: w - pad * 2,
          align,
          lineGap,
          lineBreak,
          ...(height ? { height, ellipsis: false } : {}),
        });
    };

    // Shrinks the font until the text fits the cell on a single line, so
    // long invoice numbers never wrap the way they would in a fixed size.
    const fitSize = (text, w, max = 8, min = 5) => {
      let size = max;
      while (size > min) {
        doc.font("Helvetica-Bold").fontSize(size);
        if (doc.widthOfString(String(text || "")) <= w - 6) break;
        size -= 0.25;
      }
      return size;
    };

    let y = Y;

    // --- Header: logo + corporate office ----------------------------------
    rect(X, y, W, H_HEADER);
    if (fs.existsSync(LOGO_PATH)) {
      doc.image(LOGO_PATH, X + 8, y + 8, { fit: [46, 44] });
    }
    put(COMPANY.corporateOffice, X, y + 22, W - 6, { size: 8, align: "right" });
    y += H_HEADER;

    // --- Title -------------------------------------------------------------
    rect(X, y, W, H_TITLE);
    put("PROFORMA INVOICE", X, y + 3, W, { size: 11, align: "center" });
    y += H_TITLE;

    // --- Company name / Invoice No / Date ----------------------------------
    rect(X, y, W, H_INVOICE);
    line(bandMid, y, bandMid, y + H_INVOICE);
    line(bandRight, y, bandRight, y + H_INVOICE);
    put(COMPANY.name, bandLeft, y + 5, bandMid - bandLeft, { size: 8.5 });
    put("Invoice No.", bandMid, y + 1, bandRight - bandMid, { size: 7 });
    put(pi.invoiceNo || "", bandMid, y + 9, bandRight - bandMid, {
      size: fitSize(pi.invoiceNo, bandRight - bandMid, 7.5),
      lineBreak: false,
    });
    put(fmtDate(pi.invoiceDate), bandRight, y + 1, xEnd - bandRight, { size: 7.5 });
    y += H_INVOICE;

    // --- Registered office / works address | Special note | Payment terms --
    rect(X, y, W, H_NOTES);
    line(bandMid, y, bandMid, y + H_NOTES);
    line(bandRight, y, bandRight, y + H_NOTES);

    const leftW = bandMid - bandLeft;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#000");
    doc.text(COMPANY.registeredOfficeLabel, bandLeft + 3, y + 4, { continued: true, width: leftW - 6 });
    doc.font("Helvetica").text(COMPANY.registeredOffice, { width: leftW - 6 });
    put("Works Address:", bandLeft, y + 26, leftW, { size: 8 });
    put(COMPANY.worksAddress, bandLeft, y + 35, leftW, { size: 8 });
    put(COMPANY.gstin, bandLeft, y + 62, leftW, { size: 8 });

    put("Special  Note :", bandMid, y, bandRight - bandMid, { size: 7 });
    put(pi.specialNote || "", bandMid, y + 8, bandRight - bandMid, { size: 5.5, bold: false });

    put("Mode/Terms of Payment :", bandRight, y, xEnd - bandRight, { size: 7.5 });
    put(pi.paymentTerms || "", bandRight, y + 9, xEnd - bandRight, { size: 7.5 });
    y += H_NOTES;

    // --- Buyer block + Dated ------------------------------------------------
    rect(X, y, W, H_BUYER);
    line(bandMid, y, bandMid, y + H_BUYER);
    line(bandRight, y, bandRight, y + H_BUYER);

    put("Buyer:", bandLeft, y, leftW, { size: 8 });
    const buyerLines = [
      pi.buyerName,
      pi.buyerAddress,
      pi.buyerGSTIN ? `GSTIN/UIN : ${pi.buyerGSTIN}` : null,
      pi.buyerContact ? `Contact : ${pi.buyerContact}` : null,
      pi.buyerEmail ? `Email: ${pi.buyerEmail}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    put(buyerLines, bandLeft, y + 22, leftW, { size: 8, lineGap: 1 });
    put(`Dated :${fmtShortDate(pi.buyerDated || pi.invoiceDate)}`, bandRight, y, xEnd - bandRight, {
      size: 7.5,
    });
    y += H_BUYER;

    // --- Item table header ---------------------------------------------------
    const tableTop = y;
    rect(X, y, W, H_THEAD);
    [xParticulars, xHsn, xQty, xRate, xAmount].forEach((x) => line(x, y, x, y + H_THEAD));
    put("Sl No.", xSl, y + 2, colW.sl, { size: 7.5, align: "center" });
    put("Particulars", xParticulars, y + 2, colW.particulars, { size: 7.5, align: "center" });
    put("HSN/SAC", xHsn, y + 2, colW.hsn, { size: 7.5, align: "center" });
    put("Quantity", xQty, y + 2, colW.qty, { size: 7.5, align: "center" });
    put("Rate", xRate, y + 2, colW.rate, { size: 7.5, align: "center" });
    put("Amount", xAmount, y + 2, colW.amount, { size: 7.5, align: "center" });
    y += H_THEAD;

    // --- Item rows (drawn inside one tall bordered body block) -------------
    const bodyTop = y;
    rect(X, bodyTop, W, H_BODY);
    [xParticulars, xHsn, xQty, xRate, xAmount].forEach((x) => line(x, bodyTop, x, bodyTop + H_BODY));

    let rowY = bodyTop + 2;
    (pi.items || []).forEach((item, i) => {
      put(`Description : ${item.description}`, xParticulars, rowY, colW.particulars, { size: 8 });
      const descHeight = doc.heightOfString(`Description : ${item.description}`, {
        width: colW.particulars - 6,
      });
      const valueY = rowY + Math.max(descHeight, 10) - 1;
      put(String(i + 1), xSl, valueY, colW.sl, { size: 8, align: "center" });
      put(item.hsnSac || "", xHsn, valueY, colW.hsn, { size: 8, align: "center" });
      put(Number(item.quantity).toFixed(2), xQty, valueY, colW.qty, { size: 8, align: "right" });
      put(formatIndianNumber(item.rate), xRate, valueY, colW.rate, { size: 8, align: "left" });
      put(formatIndianNumber(item.amount), xAmount, valueY, colW.amount, { size: 8, align: "right" });
      rowY = valueY + 18;
    });

    // --- Tax line -------------------------------------------------------------
    const label = taxLabel(pi);
    if (label) {
      put(label, xRate, rowY, colW.rate, { size: 8, align: "left" });
      put(formatIndianNumber(pi.taxAmount), xAmount, rowY, colW.amount, { size: 8, align: "right" });
    }
    y = bodyTop + H_BODY;

    // --- Total row --------------------------------------------------------------
    rect(X, y, W, H_TOTAL);
    [xParticulars, xHsn, xQty, xRate].forEach((x) => line(x, y, x, y + H_TOTAL));
    put("Total Amount of the ORDER", xParticulars, y + 3, colW.particulars, { size: 8 });
    put(formatIndianNumber(pi.totalAmount), xRate, y + 2, xEnd - xRate, { size: 10 });
    y += H_TOTAL;

    // --- Amount in words ---------------------------------------------------------
    rect(X, y, W, H_WORDS);
    put(`Amount (in words) : ${pi.amountInWords || ""}`, X, y + 2, W, { size: 8 });
    y += H_WORDS;

    // --- Bank details --------------------------------------------------------------
    rect(X, y, W, H_BANK);
    put("BANK DETAIL FOR PAYNEMT :", X, y + 1, W, { size: 7.5 });
    put(pi.bankDetails || "", X, y + 16, W, { size: 7.5, bold: false, lineGap: 1 });
    y += H_BANK;

    // --- Signature block ---------------------------------------------------------------
    rect(X, y, W, H_SIGN);
    line(bandRight, y, bandRight, y + H_SIGN);
    put("For Technotrendz Innovative Solutions Pvt Ltd", bandRight, y + 2, xEnd - bandRight, {
      size: 7.5,
    });
    put("Authorised Signatory", bandRight, y + H_SIGN - 14, xEnd - bandRight, {
      size: 7.5,
      bold: false,
      align: "center",
    });

    // Outer border around the whole sheet
    rect(X, Y, W, doc.page.height - M * 2);
    void tableTop;

    doc.end();
  });
}
