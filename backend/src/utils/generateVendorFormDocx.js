import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  VerticalAlign,
  VerticalMergeType,
} from "docx";

// Mirrors the TISPL / PLC "Supplier Evaluation Form" vendor registration
// template exactly: same section order, same labels, same table structure.
// Any field the vendor record doesn't have is left blank rather than
// showing a placeholder — the form is meant to be printable/filable either
// way.

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

const LABEL_WIDTH = 2700;
const VALUE_WIDTH = 6300;
const FULL_WIDTH = LABEL_WIDTH + VALUE_WIDTH;

const clean = (v) => (v && String(v).trim() ? String(v).trim() : "");

function textCell({ text, width, bold = false, span = 1, shaded = false, align, verticalMerge, size }) {
  const lines = text ? String(text).split("\n") : [""];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: CELL_BORDERS,
    columnSpan: span,
    verticalMerge,
    verticalAlign: VerticalAlign.CENTER,
    shading: shaded ? { fill: "F2F2F2" } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: lines.map(
      (line, i) =>
        new Paragraph({
          alignment: align,
          spacing: i > 0 ? { before: 40 } : undefined,
          children: [new TextRun({ text: line, bold, size: size || 20 })],
        })
    ),
  });
}

function sectionHeaderRow(label) {
  return new TableRow({
    children: [textCell({ text: label, width: FULL_WIDTH, bold: true, span: 2 })],
  });
}

function fieldRow(label, value, { boldValue = false } = {}) {
  return new TableRow({
    children: [
      textCell({ text: label, width: LABEL_WIDTH }),
      textCell({ text: clean(value), width: VALUE_WIDTH, bold: boldValue }),
    ],
  });
}

export async function generateVendorFormDocx(vendor) {
  const phoneEmail = [clean(vendor.phone), clean(vendor.email)].filter(Boolean).join(", ");
  const contactPerson = [clean(vendor.contactPersonName), clean(vendor.contactDesignation)]
    .filter(Boolean)
    .join(" — ");

  const isApproved = vendor.status === "approved";
  const isRejected = vendor.status === "rejected";

  const headerTable = new Table({
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    columnWidths: [1900, 7100],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1900, type: WidthType.DXA },
            borders: CELL_BORDERS,
            verticalMerge: VerticalMergeType.RESTART,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph("")],
          }),
          new TableCell({
            width: { size: 7100, type: WidthType.DXA },
            borders: CELL_BORDERS,
            margins: { top: 80, bottom: 40, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "TECHNOTRENDZ INNOVATIVE SOLUTIONS PVT LTD", bold: true, size: 22 })],
              }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1900, type: WidthType.DXA },
            borders: CELL_BORDERS,
            verticalMerge: VerticalMergeType.CONTINUE,
            children: [new Paragraph("")],
          }),
          new TableCell({
            width: { size: 7100, type: WidthType.DXA },
            borders: CELL_BORDERS,
            margins: { top: 40, bottom: 80, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: "SUPPLIER EVALUATION FORM", bold: true, size: 22 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const generalTable = new Table({
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    columnWidths: [LABEL_WIDTH, VALUE_WIDTH],
    rows: [
      sectionHeaderRow("GENERAL"),
      fieldRow("Vendor Registration No", vendor.vendorRegistrationNo, { boldValue: true }),
      fieldRow("Name of the Company", vendor.companyName),
      fieldRow("Full address of Company", vendor.address),
      fieldRow("Telephone/Fax/e-mail", phoneEmail),
      fieldRow("Contact Person(s) with Designation", contactPerson),
      fieldRow("Nature of the Company", vendor.natureOfCompany),
      fieldRow("Nature of Business", vendor.natureOfBusiness),
      sectionHeaderRow("FINANCIAL & COMMERCIAL"),
      fieldRow("Name and address of your Bankers", vendor.bankDetails),
      fieldRow("Principle customers", vendor.principleCustomers),
      fieldRow("Sales Tax registration No.", vendor.taxRegistrationNo),
      fieldRow("Excise Registration No.", vendor.exciseRegistrationNo),
    ],
  });

  const signatoryTable = new Table({
    width: { size: 6500, type: WidthType.DXA },
    columnWidths: [1800, 4700],
    indent: { size: 1500, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          textCell({ text: "Name", width: 1800 }),
          textCell({ text: clean(vendor.signatoryName), width: 4700 }),
        ],
      }),
      new TableRow({
        children: [
          textCell({ text: "Designation", width: 1800 }),
          textCell({ text: clean(vendor.signatoryDesignation), width: 4700 }),
        ],
      }),
    ],
  });

  const checkedByLine = clean(vendor.approvedBy)
    ? `PREPAID & CHECKED BY — ${clean(vendor.approvedBy)}`
    : "PREPAID & CHECKED BY —";

  const remarksParagraphs = [
    new Paragraph({ children: [new TextRun({ text: "Remarks:", bold: true, size: 20 })] }),
    new Paragraph({ children: [new TextRun({ text: "" })] }),
  ];
  if (clean(vendor.remarks)) {
    remarksParagraphs.push(
      new Paragraph({ children: [new TextRun({ text: clean(vendor.remarks), size: 20 })] })
    );
  }
  remarksParagraphs.push(
    new Paragraph({ children: [new TextRun({ text: checkedByLine, bold: true, size: 20 })] })
  );

  const remarksTable = new Table({
    width: { size: FULL_WIDTH, type: WidthType.DXA },
    columnWidths: [FULL_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: FULL_WIDTH, type: WidthType.DXA },
            borders: CELL_BORDERS,
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            children: remarksParagraphs,
          }),
        ],
      }),
    ],
  });

  const approvalWord = isApproved ? "APPROVED" : isRejected ? "NOT APPROVED" : "APPROVED / NOT APPROVED";

  const approvalBox = new Table({
    width: { size: 3400, type: WidthType.DXA },
    columnWidths: [3400],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3400, type: WidthType.DXA },
            borders: CELL_BORDERS,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: approvalWord, bold: true, size: 20 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          headerTable,
          new Paragraph({ text: "", spacing: { after: 200 } }),
          generalTable,
          new Paragraph({ text: "", spacing: { after: 160 } }),
          signatoryTable,
          new Paragraph({ text: "", spacing: { after: 160 } }),
          remarksTable,
          new Paragraph({ text: "", spacing: { after: 160 } }),
          new Paragraph({
            children: [new TextRun({ text: "In-charge Comment:", bold: true, size: 20 })],
          }),
          new Paragraph({
            children: [new TextRun({ text: clean(vendor.approvalComment), size: 20 })],
            spacing: { after: 160 },
          }),
          new Paragraph({ children: [new TextRun({ text: "Date:", bold: true, size: 20 })], spacing: { after: 240 } }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "SIGNATURE OF THE HEAD - PURCHASE", bold: true, size: 20 })],
            spacing: { after: 200 },
          }),
          approvalBox,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}