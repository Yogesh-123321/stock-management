import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatIndianNumber } from "./numberToWordsIndian.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "tispl-logo.jpeg");

const COMPANY = {
  name: "TECHNOTRENDZ INNOVATIVE SOLUTIONS PVT. LTD",
  corporateOffice: "Corporate Office : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004, INDIA",
  registeredOffice: "Regis. Office : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004",
  worksAddress:
    "Works Address: \nSecond Floor, Plot No-101 (HUDA), Sector-59, HSIIDC Industrial Estate, Faridabad-121004, Haryana, India",
  gstin: "GSTIN/UIN: 06AANCT1097L1ZS",
};

const BORDER = { style: "thin", color: { argb: "FF000000" } };
const BOX = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const fmtDate = (d) =>
  d
    ? new Date(d)
        .toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
        .toUpperCase()
    : "";

const taxLabel = (pi) => {
  if (pi.taxType === "NONE" || !pi.taxRate) return null;
  if (pi.taxType === "CGST_SGST") return `CGST @${pi.taxRate / 2}% + SGST @${pi.taxRate / 2}%`;
  return `IGST @${pi.taxRate}%`;
};

const style = (cell, { font, align, fill, border = true } = {}) => {
  cell.font = { name: "Arial", size: 11, ...font };
  cell.alignment = { vertical: "middle", wrapText: true, ...align };
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  if (border) cell.border = BOX;
};

// Excel merged cells never auto-grow to fit wrapped text (a long-standing
// Excel limitation) - a row that's too short just gets painted over by
// whatever renders below it. Worse, some Excel builds recompute/override an
// explicit row height on open for a row containing a single-row wrapped
// merge, ignoring the customHeight we wrote (observed in testing: LibreOffice
// and the raw XML both honor it, real Excel Desktop did not for the
// Regis./Works Address rows specifically).
//
// To sidestep that inconsistency entirely, text is hard-wrapped ourselves
// into explicit lines (using a conservative chars-per-line estimate) before
// it's written to the cell. That way Excel never needs to compute a wrap -
// every line already fits - so there's nothing left for its autofit logic
// to get wrong, and the row height we set matches the actual line count
// exactly, deterministically.

// Conservative chars-per-line for Arial at a given point size, scaled by the
// merged column width (1 width unit ~= 1 default-font character). Kept
// deliberately narrow so lines never need further wrapping by Excel.
const charsPerLine = (colWidthUnits, fontSize) => {
  const scale = 11 / fontSize; // smaller font fits more chars in the same width
  return Math.max(8, Math.floor(colWidthUnits * 0.95 * scale));
};

// Break a single line on word boundaries so it never exceeds maxChars.
const wrapLine = (line, maxChars) => {
  if (line.length <= maxChars) return [line];
  const words = line.split(" ");
  const out = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
};

// Hard-wrap text (preserving any existing \n breaks) to fit a column width,
// returning the pre-broken string ready to assign to a cell.
const hardWrap = (text, colWidthUnits, fontSize = 11) => {
  const maxChars = charsPerLine(colWidthUnits, fontSize);
  return String(text || "")
    .split("\n")
    .flatMap((line) => (line.length === 0 ? [""] : wrapLine(line, maxChars)))
    .join("\n");
};

const countLines = (text) => String(text || "").split("\n").length;

// Points needed for N lines at a given font size, plus cell padding.
const heightForLines = (lines, fontSize = 11) => Math.ceil(lines * fontSize * 1.45) + 4;

// Sum of column widths (in Excel width units) between two column letters, inclusive.
const colLetterToIndex = (letter) => letter.charCodeAt(0) - "A".charCodeAt(0);
const spanWidth = (colWidths, fromCol, toCol) => {
  const from = colLetterToIndex(fromCol);
  const to = colLetterToIndex(toCol);
  let sum = 0;
  for (let i = from; i <= to; i++) sum += colWidths[i];
  return sum;
};

// Distribute a total required height across N merged rows as evenly as
// possible (Excel merged-cell height = sum of each underlying row's height).
const distributeHeight = (totalHeight, rowCount) => {
  const per = Math.ceil(totalHeight / rowCount);
  return Array(rowCount).fill(per);
};


export async function generatePiWorkbook(pi) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TISPL Inventory Platform";
  const ws = workbook.addWorksheet("PI", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
    },
  });

  // 12 content columns (A..L), mirrors the source template's B..M range.
  const colWidths = [4, 11, 11, 11, 11, 11, 11, 13, 11, 13, 14, 16];
  ws.columns = colWidths.map((width) => ({ width }));
  const AG = spanWidth(colWidths, "A", "G"); // left block (company/works/buyer)
  const HJ = spanWidth(colWidths, "H", "J"); // middle block (notes)
  const KL = spanWidth(colWidths, "K", "L"); // right block (terms/dated)

  let r = 1;

  // --- Header box: logo + corporate office address ---------------------
  ws.mergeCells(`A${r}:L${r + 3}`);
  style(ws.getCell(`A${r}`), {
    font: { size: 11, bold: true },
    align: { horizontal: "right", vertical: "bottom", wrapText: true },
  });
  ws.getCell(`A${r}`).value = COMPANY.corporateOffice;
  ws.getRow(r).height = 20;
  ws.getRow(r + 1).height = 20;
  ws.getRow(r + 2).height = 20;
  ws.getRow(r + 3).height = 20;

  if (fs.existsSync(LOGO_PATH)) {
    const imageId = workbook.addImage({ filename: LOGO_PATH, extension: "jpeg" });
    ws.addImage(imageId, { tl: { col: 0.15, row: r - 1 + 0.15 }, ext: { width: 70, height: 72 } });
  }
  r += 4;

  // --- Title -------------------------------------------------------------
  ws.mergeCells(`A${r}:L${r}`);
  style(ws.getCell(`A${r}`), { font: { size: 18, bold: true }, align: { horizontal: "center" }, border: false });
  ws.getCell(`A${r}`).value = "PROFORMA INVOICE";
  ws.getRow(r).height = 26;
  r += 1;

  // --- Company name / Invoice No / Date row ------------------------------
  const rowA = r;
  ws.mergeCells(`A${rowA}:G${rowA}`);
  style(ws.getCell(`A${rowA}`), { font: { size: 12, bold: true } });
  ws.getCell(`A${rowA}`).value = COMPANY.name;

  ws.mergeCells(`H${rowA}:J${rowA}`);
  style(ws.getCell(`H${rowA}`), { font: { size: 11, bold: true } });
  ws.getCell(`H${rowA}`).value = `Invoice No.\n${pi.invoiceNo}`;

  ws.mergeCells(`K${rowA}:L${rowA}`);
  style(ws.getCell(`K${rowA}`), { font: { size: 11, bold: true }, align: { horizontal: "center" } });
  ws.getCell(`K${rowA}`).value = fmtDate(pi.invoiceDate);
  ws.getRow(rowA).height = 30;
  r += 1;

  // --- Registered office / Special note / Payment terms (2-row block) ---
  // Regis. Office (row B only) and Works Address (row C only) sit in the
  // left column; Special Note and Payment Terms merge across both rows in
  // the middle/right columns. Heights are estimated from the actual text
  // so long buyer-supplied notes/terms don't get painted over.
  const rowB = r;
  const rowC = r + 1;

  const specialNoteText = `Special Note :\n${hardWrap(pi.specialNote || "", HJ, 10.5)}`;
  const paymentTermsText = `Mode/Terms of Payment :\n${hardWrap(pi.paymentTerms || "", KL, 10.5)}`;
  const registeredOfficeText = hardWrap(COMPANY.registeredOffice, AG, 11);
  const worksAddressText = `${hardWrap(COMPANY.worksAddress, AG, 11)}\n${COMPANY.gstin}`;

  const regisLines = countLines(registeredOfficeText);
  const worksLines = countLines(worksAddressText);
  const noteLines = countLines(specialNoteText);
  const termsLines = countLines(paymentTermsText);
  const middleBlockLines = Math.max(noteLines, termsLines);

  const rowBHeight = Math.max(heightForLines(regisLines, 11), 22);
  const rowCHeight = Math.max(
    heightForLines(worksLines, 11),
    heightForLines(middleBlockLines, 10.5) - rowBHeight,
    40
  );
  ws.getRow(rowB).height = rowBHeight;
  ws.getRow(rowC).height = rowCHeight;

  ws.mergeCells(`A${rowB}:G${rowB}`);
  style(ws.getCell(`A${rowB}`), { font: { size: 11 } });
  ws.getCell(`A${rowB}`).value = registeredOfficeText;

  ws.mergeCells(`H${rowB}:J${rowC}`);
  style(ws.getCell(`H${rowB}`), { font: { size: 10.5 }, align: { horizontal: "left", vertical: "top" } });
  ws.getCell(`H${rowB}`).value = specialNoteText;

  ws.mergeCells(`K${rowB}:L${rowC}`);
  style(ws.getCell(`K${rowB}`), { font: { size: 10.5, bold: true }, align: { horizontal: "left", vertical: "top" } });
  ws.getCell(`K${rowB}`).value = paymentTermsText;
  r += 1;

  // --- Works address + GSTIN ----------------------------------------------
  ws.mergeCells(`A${rowC}:G${rowC}`);
  style(ws.getCell(`A${rowC}`), { font: { size: 11 } });
  ws.getCell(`A${rowC}`).value = worksAddressText;
  r += 1;

  // --- Buyer block (tall, spans several rows) + Dated --------------------
  const rowD = r;
  const buyerLines = [
    "Buyer:",
    hardWrap(pi.buyerName, AG, 11),
    hardWrap(pi.buyerAddress, AG, 11),
    pi.buyerGSTIN ? hardWrap(`GSTIN/UIN : ${pi.buyerGSTIN}`, AG, 11) : null,
    pi.buyerContact ? hardWrap(`Contact : ${pi.buyerContact}`, AG, 11) : null,
    pi.buyerEmail ? hardWrap(`Email: ${pi.buyerEmail}`, AG, 11) : null,
  ].filter(Boolean);

  ws.mergeCells(`A${rowD}:G${rowD + 3}`);
  style(ws.getCell(`A${rowD}`), { font: { size: 11, bold: true }, align: { horizontal: "left", vertical: "top" } });
  ws.getCell(`A${rowD}`).value = buyerLines.join("\n");

  ws.mergeCells(`H${rowD}:J${rowD + 3}`);
  style(ws.getCell(`H${rowD}`));

  ws.mergeCells(`K${rowD}:L${rowD + 3}`);
  style(ws.getCell(`K${rowD}`), { font: { size: 10.5 }, align: { horizontal: "left", vertical: "top" } });
  ws.getCell(`K${rowD}`).value = pi.buyerDated ? `Dated : ${fmtDate(pi.buyerDated)}` : "";

  // Merged-cell height = sum of its underlying rows, so the required total
  // has to be spread across all 4 rows in the span, not just set on the first.
  const buyerTotalLines = countLines(buyerLines.join("\n"));
  const buyerBlockHeight = Math.max(heightForLines(buyerTotalLines, 11), 26 * 4);
  distributeHeight(buyerBlockHeight, 4).forEach((h, i) => {
    ws.getRow(rowD + i).height = h;
  });
  r += 4;

  // --- Item table header ---------------------------------------------------
  const headerRow = r;
  const headers = [
    ["A", "Sl No."], ["B", "Particulars"], ["H", "HSN/SAC"],
    ["I", "Quantity"], ["J", "Rate"], ["K", "Amount"],
  ];
  ws.mergeCells(`B${headerRow}:G${headerRow}`);
  headers.forEach(([col]) => style(ws.getCell(`${col}${headerRow}`), { font: { bold: true }, align: { horizontal: "center" } }));
  ws.getCell(`A${headerRow}`).value = "Sl No.";
  ws.getCell(`B${headerRow}`).value = "Particulars";
  ws.getCell(`H${headerRow}`).value = "HSN/SAC";
  ws.getCell(`I${headerRow}`).value = "Quantity";
  ws.getCell(`J${headerRow}`).value = "Rate";
  ws.getCell(`K${headerRow}`).value = "Amount";
  ws.mergeCells(`K${headerRow}:L${headerRow}`);
  r += 1;

  // --- Item rows -----------------------------------------------------------
  pi.items.forEach((item, i) => {
    const row = r;
    style(ws.getCell(`A${row}`), { font: { bold: true }, align: { horizontal: "center" } });
    ws.getCell(`A${row}`).value = i + 1;

    ws.mergeCells(`B${row}:G${row}`);
    style(ws.getCell(`B${row}`), { align: { horizontal: "left", vertical: "top" } });
    const descText = hardWrap(`Description : ${item.description}`, spanWidth(colWidths, "B", "G"), 11);
    ws.getCell(`B${row}`).value = descText;

    style(ws.getCell(`H${row}`), { font: { bold: true }, align: { horizontal: "center" } });
    ws.getCell(`H${row}`).value = item.hsnSac || "";

    style(ws.getCell(`I${row}`), { font: { bold: true }, align: { horizontal: "center" } });
    ws.getCell(`I${row}`).value = item.quantity;

    style(ws.getCell(`J${row}`), { font: { bold: true }, align: { horizontal: "center" } });
    ws.getCell(`J${row}`).value = formatIndianNumber(item.rate);

    ws.mergeCells(`K${row}:L${row}`);
    style(ws.getCell(`K${row}`), { font: { bold: true }, align: { horizontal: "right" } });
    ws.getCell(`K${row}`).value = formatIndianNumber(item.amount);

    const descLines = countLines(descText);
    ws.getRow(row).height = Math.max(heightForLines(descLines, 11), 30);
    r += 1;
  });

  // --- Tax row (optional) ---------------------------------------------------
  const label = taxLabel(pi);
  if (label) {
    const row = r;
    ["A", "H", "I"].forEach((c) => style(ws.getCell(`${c}${row}`)));
    ws.mergeCells(`B${row}:G${row}`);
    style(ws.getCell(`B${row}`));

    style(ws.getCell(`J${row}`), { font: { bold: true }, align: { horizontal: "right" } });
    ws.getCell(`J${row}`).value = label;

    ws.mergeCells(`K${row}:L${row}`);
    style(ws.getCell(`K${row}`), { font: { bold: true }, align: { horizontal: "right" } });
    ws.getCell(`K${row}`).value = formatIndianNumber(pi.taxAmount);
    r += 1;
  }

  // --- Total row -----------------------------------------------------------
  const totalRow = r;
  ["A"].forEach((c) => style(ws.getCell(`${c}${totalRow}`)));
  ws.mergeCells(`B${totalRow}:I${totalRow}`);
  style(ws.getCell(`B${totalRow}`), { font: { bold: true } });
  ws.getCell(`B${totalRow}`).value = "Total Amount of the ORDER";

  ws.mergeCells(`J${totalRow}:L${totalRow}`);
  style(ws.getCell(`J${totalRow}`), { font: { bold: true, size: 14 }, align: { horizontal: "right" } });
  ws.getCell(`J${totalRow}`).value = formatIndianNumber(pi.totalAmount);
  r += 1;

  // --- Amount in words -------------------------------------------------------
  ws.mergeCells(`A${r}:L${r}`);
  style(ws.getCell(`A${r}`), { font: { bold: true }, align: { horizontal: "left" }, border: false });
  ws.getCell(`A${r}`).value = `Amount (in words) : ${pi.amountInWords}`;
  r += 1;

  // --- Bank details -------------------------------------------------------
  ws.mergeCells(`A${r}:L${r}`);
  style(ws.getCell(`A${r}`), {
    font: { size: 10.5, bold: true },
    align: { horizontal: "left", vertical: "top" },
    border: false,
  });
  const bankText = `BANK DETAIL FOR PAYMENT :\n\n${hardWrap(pi.bankDetails || "", 137, 10.5)}`;
  ws.getCell(`A${r}`).value = bankText;
  ws.getRow(r).height = Math.max(heightForLines(countLines(bankText), 10.5), 60);
  r += 2;

  // --- Signature block -------------------------------------------------------
  ws.mergeCells(`J${r}:L${r}`);
  style(ws.getCell(`J${r}`), { font: { size: 10.5, bold: true }, align: { horizontal: "center" }, border: false });
  ws.getCell(`J${r}`).value = "For Technotrendz Innovative Solutions Pvt Ltd";
  r += 4;

  ws.mergeCells(`J${r}:L${r}`);
  style(ws.getCell(`J${r}`), { font: { size: 10.5 }, align: { horizontal: "center" }, border: false });
  ws.getCell(`J${r}`).value = "Authorised Signatory";

  return workbook.xlsx.writeBuffer();
}