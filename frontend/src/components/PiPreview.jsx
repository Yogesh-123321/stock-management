import logo from "@/assets/tispl-logo.jpg";

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).toUpperCase()
    : "";

const fmtIndian = (value) => {
  const number = Number(value) || 0;
  const hasDecimals = !Number.isInteger(number);
  const [integer, decimal] = Math.abs(number).toFixed(hasDecimals ? 2 : 0).split(".");
  const lastThree = integer.slice(-3);
  const leading = integer.slice(0, -3);
  const grouped = leading
    ? `${leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;
  return `${number < 0 ? "-" : ""}${grouped}${decimal ? `.${decimal}` : ""}`;
};

const taxLabel = (pi) => {
  if (!pi.taxType || pi.taxType === "NONE" || !pi.taxRate) return "";
  if (pi.taxType === "CGST_SGST") {
    return `CGST @${pi.taxRate / 2}% + SGST @${pi.taxRate / 2}%`;
  }
  return `IGST @${pi.taxRate}%`;
};

const company = {
  name: "TECHNOTRENDZ INNOVATIVE SOLUTIONS PVT. LTD",
  corporateOffice:
    "Corporate Office : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004, INDIA",
  registeredOffice:
    "Regis. Office : Plot No- 43, Ground Floor, Sector-58, Faridabad, Haryana-121004",
  worksAddress:
    "Second Floor, Plot No-101 (HUDA), Sector-59, HSIIDC Industrial Estate, Faridabad-121004, Haryana, India",
  gstin: "GSTIN/UIN: 06AANCT1097L1ZS",
};

function BuyerDetails({ pi }) {
  return (
    <>
      <strong>Buyer:</strong>
      <br />
      <strong>{pi.buyerName}</strong>
      {pi.buyerAddress && (
        <>
          <br />
          <strong className="whitespace-pre-line">{pi.buyerAddress}</strong>
        </>
      )}
      {pi.buyerGSTIN && (
        <>
          <br />
          <strong>GSTIN/UIN : {pi.buyerGSTIN}</strong>
        </>
      )}
      {pi.buyerContact && (
        <>
          <br />
          <strong>Contact : {pi.buyerContact}</strong>
        </>
      )}
      {pi.buyerEmail && (
        <>
          <br />
          <strong>Email: {pi.buyerEmail}</strong>
        </>
      )}
    </>
  );
}

export default function PiPreview({ pi }) {
  if (!pi) return null;

  const label = taxLabel(pi);

  return (
    <article className="mx-auto min-h-[1056px] w-[816px] shrink-0 bg-white px-[52px] pb-[54px] pt-[70px] font-[Arial,sans-serif] text-[9px] leading-[1.25] text-black shadow-sm print:min-h-0 print:w-full print:px-0 print:py-0 print:shadow-none">
      <div className="border border-black">
        <header className="relative flex h-[92px] items-center border-b border-black px-3">
          <img src={logo} alt="Technotrendz Innovative Solutions" className="h-[54px] w-[54px] object-contain" />
          <p className="ml-auto max-w-[455px] text-right text-[8px] font-bold">
            {company.corporateOffice}
          </p>
        </header>

        <h2 className="flex h-[18px] items-center justify-center border-b border-black text-[13px] font-bold leading-none">
          PROFORMA INVOICE
        </h2>

        <section className="grid grid-cols-[38%_20%_42%] border-b border-black">
          <div className="border-r border-black">
            <div className="flex h-[30px] items-center border-b border-black px-1 font-bold">
              {company.name}
            </div>
            <div className="h-[125px] border-b border-black px-1 py-2">
              <strong>Regis. Office :</strong> {company.registeredOffice.replace("Regis. Office : ", "")}
              <br />
              <br />
              <strong>Works Address:</strong>
              <br />
              {company.worksAddress}
              <br />
              <strong>{company.gstin}</strong>
            </div>
            <div className="h-[119px] px-1 py-1.5">
              <BuyerDetails pi={pi} />
            </div>
          </div>

          <div className="border-r border-black">
            <div className="h-[30px] border-b border-black px-1 py-1 font-bold">
              Invoice No.
              <br />
              {pi.invoiceNo}
            </div>
            <div className="h-[125px] border-b border-black px-1 py-2">
              <strong>Special Note :</strong>
              <br />
              {pi.specialNote}
            </div>
            <div className="h-[119px]" />
          </div>

          <div>
            <div className="flex h-[30px] items-start justify-center border-b border-black px-1 py-1 font-bold">
              {fmtDate(pi.invoiceDate)}
            </div>
            <div className="h-[125px] border-b border-black px-1 py-2 font-bold">
              Mode/Terms of Payment :
              <br />
              {pi.paymentTerms}
            </div>
            <div className="h-[119px] px-1 py-1.5">
              {pi.buyerDated ? `Dated : ${fmtDate(pi.buyerDated)}` : ""}
            </div>
          </div>
        </section>

        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[44%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[23%]" />
          </colgroup>
          <thead>
            <tr className="h-[18px] border-b border-black font-bold">
              <th className="border-r border-black px-1">Sl No.</th>
              <th className="border-r border-black px-1">Particulars</th>
              <th className="border-r border-black px-1">HSN/SAC</th>
              <th className="border-r border-black px-1">Quantity</th>
              <th className="border-r border-black px-1">Rate</th>
              <th className="px-1">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="h-[309px] align-top">
              <td className="border-r border-black px-1 py-3 text-center font-bold">
                {pi.items.map((_, index) => (
                  <div key={index} className="mb-3">{index + 1}</div>
                ))}
              </td>
              <td className="border-r border-black px-1 py-2 font-bold">
                {pi.items.map((item, index) => (
                  <div key={index} className="mb-3">Description : {item.description}</div>
                ))}
              </td>
              <td className="border-r border-black px-1 py-3 text-center font-bold">
                {pi.items.map((item, index) => (
                  <div key={index} className="mb-3">{item.hsnSac || "—"}</div>
                ))}
              </td>
              <td className="border-r border-black px-1 py-3 text-center font-bold">
                {pi.items.map((item, index) => (
                  <div key={index} className="mb-3">{Number(item.quantity).toFixed(2)}</div>
                ))}
              </td>
              <td className="border-r border-black px-1 py-3 text-center font-bold">
                {pi.items.map((item, index) => (
                  <div key={index} className="mb-3">{fmtIndian(item.rate)}</div>
                ))}
                {label && <div className="mt-3 italic">{label}</div>}
              </td>
              <td className="px-1 py-3 text-right font-bold">
                {pi.items.map((item, index) => (
                  <div key={index} className="mb-3">{fmtIndian(item.amount)}</div>
                ))}
                {label && <div className="mt-3">{fmtIndian(pi.taxAmount)}</div>}
              </td>
            </tr>
            <tr className="h-[20px] border-t border-black font-bold">
              <td className="border-r border-black" />
              <td className="border-r border-black px-1">Total Amount of the ORDER</td>
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="px-1" colSpan={2}>{fmtIndian(pi.totalAmount)}</td>
            </tr>
          </tbody>
        </table>

        <div className="flex min-h-[18px] items-center border-t border-black px-1 font-bold">
          Amount (in words) :&nbsp; {pi.amountInWords}
        </div>
        <div className="min-h-[18px] border-t border-black px-1 py-1 font-bold underline">
          BANK DETAIL FOR PAYMENT :
        </div>
        <div className="h-[58px] border-t border-black px-1 py-3 font-bold whitespace-pre-line">
          {pi.bankDetails || ""}
        </div>
        <footer className="grid h-[65px] grid-cols-[58%_42%] border-t border-black">
          <div className="border-r border-black" />
          <div className="relative px-1 pt-1 font-bold">
            For Technotrendz Innovative Solutions Pvt Ltd
            <span className="absolute inset-x-0 bottom-1 text-center font-normal">Authorised Signatory</span>
          </div>
        </footer>
      </div>
    </article>
  );
}
