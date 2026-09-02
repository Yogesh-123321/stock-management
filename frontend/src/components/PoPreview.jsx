import logo from "@/assets/tispl-logo.jpg";

const fmtDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
};

const fmtIndian = (value, decimals = 2) => {
  const number = Number(value) || 0;
  const [integer, decimal] = Math.abs(number).toFixed(decimals).split(".");
  const lastThree = integer.slice(-3);
  const leading = integer.slice(0, -3);
  const grouped = leading ? `${leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${number < 0 ? "-" : ""}${grouped}${decimal ? `.${decimal}` : ""}`;
};

const company = {
  name: "TECHNOTRENDZ SOLUTIONS PRIVATE LIMITED",
  address: "Plot No. 101 (HUDA),Sector 59,HSIIDC Industrial Estate,Faridabad-Haryana-121004",
  gstin: "06AAFCT7227C1ZJ",
  stateName: "Haryana",
  stateCode: "06",
  email: "info@technotrendz.co.in",
};

const taxRows = (po) => {
  const rows = [];
  const rate = Number(po.taxRate) || 0;
  const amount = Number(po.taxAmount) || 0;
  if (po.taxType === "CGST_SGST" && rate) {
    rows.push(["CGST INPUT", amount / 2]);
    rows.push(["SGST INPUT", amount / 2]);
  } else if (po.taxType === "IGST" && rate) {
    rows.push(["IGST INPUT", amount]);
  }
  if (Number(po.roundOff)) rows.push(["ROUND OFF", Number(po.roundOff)]);
  return rows;
};

const DEFAULT_DECLARATION =
  "2). Dispatch Each Lot only after Clearance from our QA department on Test Report, R.M. Report & Third Party R.M. Report.\n" +
  "3)Supplier to Replenish any Rejected / Unaccepted Quantity on Next Day of the Report by Technotrendz (Rejected Qty to be settled without hindrance on our Production ). Else Any Financial loss shall be on Supplier's account.";

const DECLARATION_FOOT =
  "4)Suppler to send Original Dispatch documents, Test Certificate, Material Test Reports along with the shipment and on email to Stores & QA department";

export default function PoPreview({ po }) {
  if (!po) return null;

  const items = po.items || [];
  const unit = items[0]?.unit || "NOS";
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const rows = taxRows(po);

  const consignee = {
    name: po.consigneeName || company.name,
    address: po.consigneeAddress || company.address,
    email: po.consigneeEmail || company.email,
    gstin: po.consigneeGSTIN || company.gstin,
    stateName: po.consigneeStateName || company.stateName,
    stateCode: po.consigneeStateCode || company.stateCode,
  };

  return (
    <article className="mx-auto w-[816px] shrink-0 bg-white p-[28px] font-[Arial,sans-serif] text-[9px] leading-[1.2] text-black shadow-sm print:w-full print:p-0 print:shadow-none">
      <h2 className="pb-1 text-center text-[15px] font-bold">PURCHASE ORDER</h2>

      <div className="border border-black">
        {/* header: party column | voucher grid */}
        <section className="grid grid-cols-[62%_38%]">
          <div className="border-r border-black">
            {/* Invoice To */}
            <div className="flex gap-2 border-b border-black p-1.5" style={{ minHeight: 96 }}>
              <img src={logo} alt="Technotrendz" className="h-[72px] w-[72px] shrink-0 object-contain" />
              <div className="min-w-0">
                <div>Invoice To</div>
                <div className="text-[10px] font-bold">{company.name}</div>
                <div className="text-[8px]">{company.address}</div>
                <div className="text-[8.5px]">GSTIN/UIN: {company.gstin}</div>
                <div className="text-[8.5px]">
                  State Name : {company.stateName}, Code : {company.stateCode}
                </div>
                <div className="text-[8.5px]">E-Mail : {company.email}</div>
              </div>
            </div>

            {/* Consignee */}
            <div className="border-b border-black p-1.5" style={{ minHeight: 108 }}>
              <div>Consignee (Ship to)</div>
              <div className="text-[10px] font-bold">{consignee.name}</div>
              <div className="whitespace-pre-line">{consignee.address}</div>
              <div className="mt-1">e-mail : {consignee.email}</div>
              <div className="mt-1 grid grid-cols-[76px_1fr]">
                <span>GSTIN/UIN</span>
                <span>: {consignee.gstin}</span>
                <span>State Name</span>
                <span>
                  : {consignee.stateName}, Code : {consignee.stateCode}
                </span>
              </div>
            </div>

            {/* Supplier */}
            <div className="p-1.5" style={{ minHeight: 84 }}>
              <div>Supplier (Bill from)</div>
              <div className="text-[10px] font-bold">{po.supplierName}</div>
              <div className="whitespace-pre-line">{po.supplierAddress}</div>
              <div className="mt-1 grid grid-cols-[76px_1fr]">
                <span>GSTIN/UIN</span>
                <span>: {po.supplierGSTIN || ""}</span>
                <span>State Name</span>
                <span>
                  : {po.supplierStateName || ""}
                  {po.supplierStateCode ? `, Code : ${po.supplierStateCode}` : ""}
                </span>
              </div>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-[55%_45%] border-b border-black">
              <div className="border-r border-black px-1 py-0.5" style={{ minHeight: 38 }}>
                Voucher No.
                <div className="text-[10px] font-bold">{po.voucherNo}</div>
              </div>
              <div className="px-1 py-0.5">
                Dated
                <div className="text-[10px] font-bold">{fmtDate(po.voucherDate)}</div>
              </div>
            </div>
            <div className="grid grid-cols-[55%_45%] border-b border-black">
              <div className="border-r border-black px-1 py-0.5" style={{ minHeight: 38 }} />
              <div className="px-1 py-0.5">
                Mode/Terms of Payment
                <div className="text-[9.5px] font-bold whitespace-pre-line">{po.paymentTerms}</div>
              </div>
            </div>
            <div className="grid grid-cols-[55%_45%] border-b border-black">
              <div className="border-r border-black px-1 py-0.5" style={{ minHeight: 38 }}>
                Reference No. &amp; Date.
                <div className="text-[9.5px] font-bold">{po.referenceNo}</div>
              </div>
              <div className="px-1 py-0.5">
                Other References
                <div className="text-[9.5px] font-bold">{po.otherReferences}</div>
              </div>
            </div>
            <div className="grid grid-cols-[55%_45%] border-b border-black">
              <div className="border-r border-black px-1 py-0.5" style={{ minHeight: 32 }}>
                Dispatched through
                <div className="text-[9.5px] font-bold">{po.dispatchedThrough}</div>
              </div>
              <div className="px-1 py-0.5">
                Destination
                <div className="text-[9.5px] font-bold">{po.destination}</div>
              </div>
            </div>
            <div className="px-1 py-0.5" style={{ minHeight: 132 }}>
              Terms of Delivery
              <div className="text-[9.5px] font-bold whitespace-pre-line">{po.termsOfDelivery}</div>
            </div>
          </div>
        </section>

        {/* items */}
        <table className="w-full table-fixed border-collapse border-t border-black">
          <colgroup>
            <col className="w-[5%]" />
            <col className="w-[41%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[8%]" />
            <col className="w-[5%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-black align-top">
              <th className="border-r border-black px-1 py-1 text-left font-normal">
                Sl
                <br />
                No.
              </th>
              <th className="border-r border-black px-1 py-1 font-normal">Description of Goods</th>
              <th className="border-r border-black px-1 py-1 font-normal">HSN/SAC</th>
              <th className="border-r border-black px-1 py-1 font-normal">Due on</th>
              <th className="border-r border-black px-1 py-1 font-normal">Quantity</th>
              <th className="border-r border-black px-1 py-1 font-normal">Rate</th>
              <th className="border-r border-black px-1 py-1 font-normal">per</th>
              <th className="px-1 py-1 font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="align-top">
                <td className="border-r border-black px-1 py-1 text-right">{i + 1}</td>
                <td className="border-r border-black px-1 py-1">
                  <div className="font-bold">{item.description}</div>
                  {item.partNo && <div className="pl-2 italic">{item.partNo}</div>}
                </td>
                <td className="border-r border-black px-1 py-1 text-center">{item.hsnSac || ""}</td>
                <td className="border-r border-black px-1 py-1 text-center italic">
                  {fmtDate(item.dueOn || po.voucherDate)}
                </td>
                <td className="border-r border-black px-1 py-1 text-right font-bold">
                  {fmtIndian(item.quantity)} {item.unit || "NOS"}
                </td>
                <td className="border-r border-black px-1 py-1 text-right">{fmtIndian(item.rate)}</td>
                <td className="border-r border-black px-1 py-1">{item.per || item.unit || "NOS"}</td>
                <td className="px-1 py-1 text-right font-bold">{fmtIndian(item.amount)}</td>
              </tr>
            ))}

            {/* sub-total, taxes and round off */}
            {rows.length > 0 && (
              <>
                <tr className="align-top">
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-r border-black" />
                  <td className="border-t border-black px-1 py-0.5 text-right">{fmtIndian(po.subTotal)}</td>
                </tr>
                {rows.map(([label, value]) => (
                  <tr key={label} className="align-top">
                    <td className="border-r border-black" />
                    <td className="border-r border-black px-1 py-0.5 text-right font-bold italic">{label}</td>
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="border-r border-black" />
                    <td className="px-1 py-0.5 text-right font-bold">{fmtIndian(value)}</td>
                  </tr>
                ))}
              </>
            )}

            {/* spacer keeps the sheet close to the printed proportions */}
            <tr className="align-top">
              <td className="border-r border-black" style={{ height: 40 }} />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td />
            </tr>

            <tr className="border-t border-black font-bold">
              <td className="border-r border-black" />
              <td className="border-r border-black px-1 py-1 text-right">Total</td>
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black px-1 py-1 text-right">
                {fmtIndian(totalQty)} {unit}
              </td>
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="px-1 py-1 text-right">{fmtIndian(po.totalAmount)}</td>
            </tr>
          </tbody>
        </table>

        {/* amount in words */}
        <div className="border-t border-black px-1 py-1">
          <div className="flex items-start justify-between">
            <span>Amount Chargeable (in words)</span>
            <span className="italic">E. &amp; O.E</span>
          </div>
          <div className="text-[10px] font-bold">{po.amountInWords}</div>
        </div>

        {/* declaration + signature */}
        <div className="grid grid-cols-[55%_45%] border-t border-black" style={{ minHeight: 110 }}>
          <div className="border-r border-black px-1 py-1">
            <div>Declaration</div>
            <div className="whitespace-pre-line">{po.declaration || DEFAULT_DECLARATION}</div>
            <div className="mt-1 text-[6.5px]">{DECLARATION_FOOT}</div>
          </div>
          <div className="relative">
            <div className="absolute inset-x-0 bottom-[46px] border-b border-black" />
            <div className="absolute inset-x-0 bottom-[26px] text-center text-[9.5px] font-bold">
              for {company.name}
            </div>
            <div className="absolute inset-x-0 bottom-1 pr-1 text-right">Authorised Signatory</div>
          </div>
        </div>
      </div>

      <p className="pt-1 text-center">This is a Computer Generated Document</p>
    </article>
  );
}
