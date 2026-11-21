// backend/src/utils/generateChallanPdf.js
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatIndianNumber } from "./numberToWordsIndian.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "tispl-logo.jpeg");

export const COMPANY = {
  name: "TECHNOTRENDZ SOLUTIONS PRIVATE LIMITED",
  addressLines: "Plot No. 101 (HUDA),Sector 59,HSIIDC Industrial Estate,Faridabad-Haryana-121004",
  gstin: "06AAFCT7227C1ZJ",
  stateName: "Haryana",
  stateCode: "06",
  email: "info@technotrendz.co.in",
};
export const COMPANY_STATE_CODE = COMPANY.stateCode;

/* ---- date helpers (always IST so the printed time matches the office clock) ---- */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TZ = "Asia/Kolkata";

const istParts = (d) => {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(dt)
      .map((p) => [p.type, p.value])
  );
};

// 19-Nov-26
export const fmtShortDate = (d) => {
  const p = d ? istParts(d) : null;
  return p ? `${p.day}-${MONTHS[Number(p.month) - 1]}-${p.year}` : "";
};

// 19-Nov-26 at 14:07
export const fmtIssueDateTime = (d) => {
  const p = d ? istParts(d) : null;
  return p ? `${p.day}-${MONTHS[Number(p.month) - 1]}-${p.year} at ${p.hour}:${p.minute}` : "";
};

const fmt = (n) => formatIndianNumber(n);

// Helvetica (a built-in PDF font) has no rupee sign, so it is drawn as a vector.
// (x, y) is the top-left corner of the glyph; `size` is the font size it sits beside.
const drawRupee = (doc, x, y, size) => {
  const w = size * 0.55;
  const h = size * 0.72;
  doc.save().lineWidth(size * 0.11).lineCap("butt").lineJoin("miter").strokeColor("#000");
  doc.moveTo(x, y).lineTo(x + w, y).stroke(); // top bar
  doc.moveTo(x, y + h * 0.22).lineTo(x + w, y + h * 0.22).stroke(); // second bar
  doc
    .moveTo(x + w * 0.12, y)
    .lineTo(x + w * 0.5, y)
    .bezierCurveTo(x + w * 0.98, y, x + w * 0.98, y + h * 0.48, x + w * 0.5, y + h * 0.48)
    .lineTo(x + w * 0.12, y + h * 0.48)
    .lineTo(x + w * 0.72, y + h)
    .stroke(); // bowl + leg
  doc.restore();
  return w;
};

// Total quantity is shown with its unit only when every line uses the same one.
export const totalQuantityLabel = (items = []) => {
  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const units = [...new Set(items.map((it) => it.unit || "NOS"))];
  return `${total.toFixed(2)}${units.length === 1 ? ` ${units[0]}` : ""}`;
};

// Splits the tax into the columns shown on the tax summary.
export const taxBreakup = (ch) => {
  if (!ch.taxType || ch.taxType === "NONE" || !ch.taxRate) return [];
  if (ch.taxType === "CGST_SGST") {
    const half = Number((ch.taxAmount / 2).toFixed(2));
    return [
      { name: "CGST", rate: ch.taxRate / 2, amount: half },
      { name: "SGST", rate: ch.taxRate / 2, amount: Number((ch.taxAmount - half).toFixed(2)) },
    ];
  }
  return [{ name: "IGST", rate: ch.taxRate, amount: ch.taxAmount }];
};

/**
 * Renders a Delivery Challan as an A4 PDF laid out like the TISPL challan
 * template. Long item lists continue onto extra pages; totals, tax summary
 * and the signature block are printed on the last page.
 * Returns Promise<Buffer>.
 */
export function generateChallanPdf(ch) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const X = 30;
    const W = 535;
    const xEnd = X + W;
    const Y0 = 52;
    const YB = 800;

    // ---- vertical bands --------------------------------------------------
    const H_TOP = 227;
    const H_THEAD = 16;
    const H_TOTAL = 18;
    const H_WORDS = 28;
    const H_TAXTBL = 38;
    const H_TAXWORDS = 26;
    const H_SIGN = 70;
    const H_BODY = YB - Y0 - H_TOP - H_THEAD - H_TOTAL - H_WORDS - H_TAXTBL - H_TAXWORDS - H_SIGN;

    // ---- item table columns ----------------------------------------------
    const colW = { sl: 26, desc: 244, hsn: 62, qty: 62, rate: 50, per: 28, amount: 63 };
    const xSl = X;
    const xDesc = xSl + colW.sl;
    const xHsn = xDesc + colW.desc;
    const xQty = xHsn + colW.hsn;
    const xRate = xQty + colW.qty;
    const xPer = xRate + colW.rate;
    const xAmount = xPer + colW.per;

    const leftW = 308;
    const midX = X + leftW;
    const splitX = midX + (xEnd - midX) / 2;

    const line = (x1, y1, x2, y2, w = 0.8) => doc.lineWidth(w).moveTo(x1, y1).lineTo(x2, y2).stroke("#000");
    const rect = (x, y, w, h) => doc.lineWidth(0.8).rect(x, y, w, h).stroke("#000");
    const fontFor = (bold, italic) =>
      bold && italic ? "Helvetica-BoldOblique" : bold ? "Helvetica-Bold" : italic ? "Helvetica-Oblique" : "Helvetica";
    const put = (text, x, y, w, o = {}) => {
      const { size = 8, bold = true, italic = false, align = "left", pad = 3, height, lineGap = 0 } = o;
      doc
        .font(fontFor(bold, italic))
        .fontSize(size)
        .fillColor("#000")
        .text(String(text ?? ""), x + pad, y + pad, {
          width: w - pad * 2,
          align,
          lineGap,
          ...(height ? { height, ellipsis: true } : {}),
        });
    };
    const heightOf = (text, w, size, bold = true) => {
      doc.font(fontFor(bold, false)).fontSize(size);
      return doc.heightOfString(String(text ?? ""), { width: w });
    };
    const fitSize = (text, w, max = 8.5, min = 5) => {
      let size = max;
      while (size > min) {
        doc.font("Helvetica-Bold").fontSize(size);
        if (doc.widthOfString(String(text || "")) <= w - 6) break;
        size -= 0.25;
      }
      return size;
    };

    // ---- tax / totals preparation ----------------------------------------
    const breakup = taxBreakup(ch);
    const showTax = breakup.length > 0;
    const subTotal = Number(ch.subTotal) || 0;

    // ---- split the items across pages ---------------------------------------
    const rows = (ch.items || []).map((it, i) => ({
      it,
      i,
      h: Math.max(12, heightOf(it.description || "", colW.desc - 8, 8) + 3),
    }));
    const reserve = showTax ? (breakup.length + 2) * 13 + 6 : 0;
    const avail = H_BODY - 6 - reserve;
    const pages = [];
    let cur = [];
    let used = 0;
    rows.forEach((r) => {
      if (used + r.h > avail && cur.length) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(r);
      used += r.h;
    });
    pages.push(cur);

    const partyBlock = (label, p = {}, y, h) => {
      put(label, X, y, leftW, { size: 7.5, bold: false });
      let ty = y + 13;
      put(p.name || "", X, ty - 3, leftW, { size: 8.5 });
      ty += heightOf(p.name || "", leftW - 6, 8.5) + 1;
      if (p.address) {
        put(p.address, X, ty - 3, leftW, { size: 8, bold: false });
        ty += heightOf(p.address, leftW - 6, 8, false) + 1;
      }
      if (p.gstin) {
        put(`GSTIN/UIN      : ${p.gstin}`, X, ty - 3, leftW, { size: 8, bold: false });
        ty += 10;
      }
      if (p.stateName) {
        put(
          `State Name     : ${p.stateName}${p.stateCode ? `, Code : ${p.stateCode}` : ""}`,
          X,
          ty - 3,
          leftW,
          { size: 8, bold: false }
        );
      }
      void h;
    };

    const drawPage = (pageRows, isLast, pageNo) => {
      // Title (outside the box)
      put("DELIVERY CHALLAN", X, 18, W, { size: 11, align: "center", pad: 0 });
      put(`(${ch.challanType || "RETURNABLE"})`, X, 33, W, { size: 7, bold: false, align: "center", pad: 0 });

      rect(X, Y0, W, YB - Y0);

      // ===== Top section =====
      const H_CO = 62;
      const H_DISP = 78;
      line(midX, Y0, midX, Y0 + H_TOP);
      line(X, Y0 + H_CO, midX, Y0 + H_CO);
      line(X, Y0 + H_CO + H_DISP, midX, Y0 + H_CO + H_DISP);

      // company block
      if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, X + 6, Y0 + 8, { fit: [48, 46] });
      const cx = X + 58;
      const cw = midX - cx;
      put(COMPANY.name, cx, Y0 + 1, cw, { size: 7.5 });
      put(COMPANY.addressLines, cx, Y0 + 11, cw, { size: 7, bold: false });
      put(`GSTIN/UIN: ${COMPANY.gstin}`, cx, Y0 + 29, cw, { size: 8, bold: false });
      put(`State Name :  ${COMPANY.stateName}, Code : ${COMPANY.stateCode}`, cx, Y0 + 39, cw, { size: 8, bold: false });
      put(`E-Mail : ${COMPANY.email}`, cx, Y0 + 49, cw, { size: 8, bold: false });

      partyBlock("Dispatch To", ch.dispatchTo, Y0 + H_CO, H_DISP);
      partyBlock("Party", ch.party?.name ? ch.party : ch.dispatchTo, Y0 + H_CO + H_DISP, H_TOP - H_CO - H_DISP);

      // right-hand reference grid — 8 rows (two columns), then a full-width
      // "Nature of Processing" box, exactly like the printed TISPL challan.
      const ROW_H = 20.5;
      const cells = [
        [["Challan No.", ch.challanNo, "fit"], ["Dated", fmtShortDate(ch.challanDate)]],
        [["", ""], ["Mode/Terms of Payment", ch.modeTermsOfPayment]],
        [["Reference No. & Date.", ch.referenceNoDate], ["Other References", ch.otherReferences]],
        [["Buyer's Order No.", ch.buyersOrderNo], ["Dated", fmtShortDate(ch.buyersOrderDate)]],
        [["Dispatch Doc No.", ch.dispatchDocNo], ["", ""]],
        [["Dispatched through", ch.dispatchedThrough], ["Destination", ch.destination]],
        [["Date & Time of Issue", fmtIssueDateTime(ch.dateTimeOfIssue)], ["Motor Vehicle No.", ch.motorVehicleNo]],
        [["", ""], ["Duration of Process", ch.durationOfProcess]],
      ];
      let ry = Y0;
      cells.forEach(([l, r]) => {
        [
          [l, midX, splitX - midX],
          [r, splitX, xEnd - splitX],
        ].forEach(([[label, value, mode], cx0, cw0]) => {
          if (label) put(label, cx0, ry, cw0, { size: 7, bold: false, pad: 2 });
          if (value) {
            put(value, cx0 + 0.5, ry + 9.5, cw0, {
              size: mode === "fit" ? fitSize(value, cw0, 8.5) : 8,
              pad: 0,
              height: 10,
            });
          }
        });
        ry += ROW_H;
        line(midX, ry, xEnd, ry);
      });
      // the column divider only runs beside the 8 rows; the box below is full width
      line(splitX, Y0, splitX, ry);
      const natureH = Y0 + H_TOP - ry;
      put("Nature of Processing", midX, ry, xEnd - midX, { size: 7, bold: false, pad: 2 });
      if (ch.natureOfProcessing)
        put(ch.natureOfProcessing, midX + 0.5, ry + 9.5, xEnd - midX, { size: 8, pad: 0, height: natureH - 12 });
      line(X, Y0 + H_TOP, xEnd, Y0 + H_TOP, 1.4);

      // ===== Item table header =====
      let y = Y0 + H_TOP;
      rect(X, y, W, H_THEAD);
      [xDesc, xHsn, xQty, xRate, xPer, xAmount].forEach((x) => line(x, y, x, y + H_THEAD));
      put("Sl No.", xSl, y + 1, colW.sl, { size: 5.5, bold: false, align: "center", pad: 1 });
      put("Description of Goods", xDesc, y + 3, colW.desc, { size: 7.5, bold: false, align: "center" });
      put("HSN/SAC", xHsn, y + 3, colW.hsn, { size: 7.5, bold: false, align: "center" });
      put("Quantity", xQty, y + 3, colW.qty, { size: 7.5, bold: false, align: "center" });
      put("Rate", xRate, y + 3, colW.rate, { size: 7.5, bold: false, align: "center" });
      put("per", xPer, y + 3, colW.per, { size: 7.5, bold: false, align: "center" });
      put("Amount", xAmount, y + 3, colW.amount, { size: 7.5, bold: false, align: "center" });
      y += H_THEAD;

      // ===== Body =====
      const bodyTop = y;
      [xDesc, xHsn, xQty, xRate, xPer, xAmount].forEach((x) => line(x, bodyTop, x, bodyTop + H_BODY + H_TOTAL));

      let iy = bodyTop + 3;
      pageRows.forEach(({ it, i, h }) => {
        put(String(i + 1), xSl, iy, colW.sl, { size: 8, bold: false, align: "right", pad: 2 });
        put(it.description || "", xDesc, iy, colW.desc, { size: 8 });
        put(it.hsnSac || "", xHsn, iy, colW.hsn, { size: 7.5, bold: false });
        put(`${Number(it.quantity).toFixed(2)} ${it.unit || "NOS"}`, xQty, iy, colW.qty, { size: 8 });
        put(fmt(it.rate), xRate, iy, colW.rate, { size: 7.5, bold: false, align: "right" });
        put(it.unit || "NOS", xPer, iy, colW.per, { size: 7, bold: false });
        put(fmt(it.amount), xAmount, iy, colW.amount, { size: 8, align: "right" });
        iy += h;
      });

      if (isLast && showTax) {
        iy += 3;
        line(xAmount, iy, xEnd, iy);
        put(fmt(subTotal), xAmount, iy + 1, colW.amount, { size: 8, bold: false, align: "right" });
        iy += 14;
        breakup.forEach((t) => {
          put(`${t.name} OUTPUT`, xDesc, iy, colW.desc, { size: 8.5, italic: true, align: "right" });
          put(String(t.rate), xRate, iy, colW.rate, { size: 8, bold: false, italic: true, align: "right" });
          put("%", xPer, iy, colW.per, { size: 8, bold: false, italic: true });
          put(fmt(t.amount), xAmount, iy, colW.amount, { size: 8, align: "right" });
          iy += 13;
        });
      }
      if (!isLast) {
        put("Continued on next page…", xDesc, bodyTop + H_BODY - 14, colW.desc, {
          size: 7.5,
          bold: false,
          italic: true,
          align: "right",
        });
      }

      // ===== Total row =====
      y = bodyTop + H_BODY;
      rect(X, y, W, H_TOTAL);
      if (isLast) {
        put("Total", xDesc, y + 4, colW.desc, { size: 8, bold: false, align: "right" });
        put(totalQuantityLabel(ch.items), xQty, y + 4, colW.qty, { size: 8 });
        const totalTxt = fmt(ch.totalAmount);
        let tSize = 10;
        doc.font("Helvetica-Bold").fontSize(tSize);
        while (tSize > 6 && doc.widthOfString(totalTxt) + tSize * 0.55 + 4 > colW.amount - 7) {
          tSize -= 0.5;
          doc.fontSize(tSize);
        }
        const tW = doc.widthOfString(totalTxt);
        const tx = xEnd - 4 - tW;
        doc.fillColor("#000").text(totalTxt, tx, y + 4.5, { lineBreak: false });
        drawRupee(doc, tx - tSize * 0.55 - 3, y + 5.5, tSize);
      }
      y += H_TOTAL;

      // ===== Amount in words =====
      rect(X, y, W, H_WORDS);
      if (isLast) {
        put("Amount Chargeable (in words)", X, y, W, { size: 7, bold: false });
        put("E. & O.E", X, y, W, { size: 7, bold: false, italic: true, align: "right" });
        put(ch.amountInWords || "", X, y + 11, W, { size: 8.5 });
      }
      y += H_WORDS;

      // ===== Tax summary =====
      // Same arrangement as the printed challan: "Taxable Value" | tax group(s) | "Total Tax
      // Amount" on two header rows, then the values row and a bold Total row.
      rect(X, y, W, H_TAXTBL);
      if (isLast && showTax) {
        const cTaxable = 50;
        const cRate = 32;
        const cAmt = 52;
        const cTotal = 54;
        const Wt = cTaxable + breakup.length * (cRate + cAmt) + cTotal;
        const xt = xEnd - Wt;
        const rH = H_TAXTBL / 4;

        const xGroups = xt + cTaxable;
        const xTotal = xGroups + breakup.length * (cRate + cAmt);

        // horizontal rules: values row and Total row run the full width of the box
        line(xGroups, y + rH, xTotal, y + rH); // under the tax-group titles
        line(X, y + 2 * rH, xEnd, y + 2 * rH); // above the values row
        line(X, y + 3 * rH, xEnd, y + 3 * rH); // above the Total row
        // vertical rules
        line(xt, y, xt, y + H_TAXTBL);
        line(xGroups, y, xGroups, y + H_TAXTBL);
        line(xTotal, y, xTotal, y + H_TAXTBL);
        breakup.forEach((_, k) => {
          const gx = xGroups + k * (cRate + cAmt);
          if (k > 0) line(gx, y, gx, y + H_TAXTBL);
          line(gx + cRate, y + rH, gx + cRate, y + H_TAXTBL);
        });

        const small = { size: 7, bold: false, align: "center", pad: 1 };
        // header cells that span both header rows wrap onto two lines
        put("Taxable", xt, y + 1, cTaxable, small);
        put("Value", xt, y + 1 + rH, cTaxable, small);
        put("Total", xTotal, y + 1, cTotal, small);
        put("Tax Amount", xTotal, y + 1 + rH, cTotal, small);

        const vSize = 7.5;
        const vy = y + 2 * rH + 1;
        const ty = y + 3 * rH + 1;
        breakup.forEach((t, k) => {
          const gx = xGroups + k * (cRate + cAmt);
          put(t.name, gx, y + 1, cRate + cAmt, small);
          put("Rate", gx, y + rH + 1, cRate, small);
          put("Amount", gx + cRate, y + rH + 1, cAmt, small);
          put(`${t.rate}%`, gx, vy, cRate, { size: vSize, bold: false, align: "right", pad: 2 });
          put(fmt(t.amount), gx + cRate, vy, cAmt, { size: vSize, bold: false, align: "right", pad: 2 });
          put(fmt(t.amount), gx + cRate, ty, cAmt, { size: vSize, align: "right", pad: 2 });
        });
        put(fmt(subTotal), xt, vy, cTaxable, { size: vSize, bold: false, align: "right", pad: 2 });
        put(fmt(ch.taxAmount), xTotal, vy, cTotal, { size: vSize, bold: false, align: "right", pad: 2 });
        // Total row
        put("Total:", X, ty, xt - X - 2, { size: vSize, align: "right", pad: 2 });
        put(fmt(subTotal), xt, ty, cTaxable, { size: vSize, align: "right", pad: 2 });
        put(fmt(ch.taxAmount), xTotal, ty, cTotal, { size: vSize, align: "right", pad: 2 });
      }
      y += H_TAXTBL;

      // ===== Tax amount in words =====
      rect(X, y, W, H_TAXWORDS);
      if (isLast && showTax) {
        doc.font("Helvetica").fontSize(7.5).fillColor("#000");
        doc.text("Tax Amount (in words) :  ", X + 3, y + 8, { continued: true, width: W - 6 });
        doc.font("Helvetica-Bold").fontSize(8.5).text(ch.taxAmountInWords || "");
      }
      y += H_TAXWORDS;

      // ===== Signature =====
      if (isLast) {
        const sx = X + 259;
        const sy = YB - 50;
        rect(sx, sy, xEnd - sx, 50);
        put(`for ${COMPANY.name}`, sx, sy + 4, xEnd - sx, { size: 7.5, align: "right" });
        put("Authorised Signatory", sx, YB - 16, xEnd - sx, { size: 7.5, bold: false, align: "right" });
      }

      // footer
      put("This is a Computer Generated Document", X, YB + 8, W, { size: 7.5, bold: false, align: "center", pad: 0 });
      if (pages.length > 1) {
        put(`Page ${pageNo} of ${pages.length}`, X, YB + 8, W, { size: 7, bold: false, align: "right", pad: 0 });
      }
    };

    pages.forEach((pageRows, idx) => {
      if (idx > 0) doc.addPage();
      drawPage(pageRows, idx === pages.length - 1, idx + 1);
    });

    doc.end();
  });
}