// frontend/src/components/ChallanPreview.jsx
import { Fragment } from "react";
import logo from "@/assets/tispl-logo.jpg";

const TZ = "Asia/Kolkata";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (value) => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return null;
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
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
};
const fmtDate = (v) => {
  const p = parts(v);
  return p ? `${p.day}-${MONTHS[Number(p.month) - 1]}-${p.year}` : "";
};
const fmtDateTime = (v) => {
  const p = parts(v);
  return p ? `${fmtDate(v)} at ${p.hour}:${p.minute}` : "";
};

const fmtIndian = (value) => {
  const number = Number(value) || 0;
  const [integer, decimal] = Math.abs(number).toFixed(2).split(".");
  const lastThree = integer.slice(-3);
  const leading = integer.slice(0, -3);
  const grouped = leading ? `${leading.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${number < 0 ? "-" : ""}${grouped}.${decimal}`;
};

const COMPANY = {
  name: "TECHNOTRENDZ SOLUTIONS PRIVATE LIMITED",
  address: "Plot No. 101 (HUDA),Sector 59,HSIIDC Industrial Estate,Faridabad-Haryana-121004",
  gstin: "06AAFCT7227C1ZJ",
  state: "Haryana",
  code: "06",
  email: "info@technotrendz.co.in",
};

const taxBreakup = (ch) => {
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

const totalQty = (items = []) => {
  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const units = [...new Set(items.map((it) => it.unit || "NOS"))];
  return `${total.toFixed(2)}${units.length === 1 ? ` ${units[0]}` : ""}`;
};

function PartyBlock({ label, p = {} }) {
  return (
    <div className="border-b border-black px-1.5 py-1 min-h-[78px]">
      <div className="text-[10px]">{label}</div>
      <div className="font-bold text-[11px]">{p.name}</div>
      {p.address && <div className="text-[10.5px]">{p.address}</div>}
      {p.gstin && <div className="text-[10.5px]">GSTIN/UIN &nbsp;&nbsp;&nbsp;&nbsp;: {p.gstin}</div>}
      {p.stateName && (
        <div className="text-[10.5px]">
          State Name &nbsp;&nbsp;: {p.stateName}
          {p.stateCode ? `, Code : ${p.stateCode}` : ""}
        </div>
      )}
    </div>
  );
}

function RefCell({ label, value, bold = true, className = "" }) {
  return (
    <div className={`px-1.5 py-0.5 min-h-[34px] ${className}`}>
      <div className="text-[9.5px] text-black/80">{label}</div>
      <div className={`text-[10.5px] ${bold ? "font-bold" : ""} break-words`}>{value}</div>
    </div>
  );
}

/** On-screen version of the Delivery Challan (the PDF is generated server-side). */
export default function ChallanPreview({ challan: ch }) {
  const breakup = taxBreakup(ch);
  const party = ch.party?.name ? ch.party : ch.dispatchTo;

  return (
    <div className="keep-white mx-auto w-[794px] max-w-full bg-white text-black p-6 font-sans">
      <div className="text-center mb-2">
        <div className="font-bold text-[15px] leading-tight">DELIVERY CHALLAN</div>
        <div className="text-[10px]">({ch.challanType || "RETURNABLE"})</div>
      </div>

      <div className="border border-black">
        <div className="grid grid-cols-[57.6%_42.4%] border-b-2 border-black">
          {/* left */}
          <div className="border-r border-black">
            <div className="flex gap-2 border-b border-black px-1.5 py-1 min-h-[62px]">
              <img src={logo} alt="" className="h-12 w-12 object-contain shrink-0" />
              <div className="text-[10px] leading-snug">
                <div className="font-bold">{COMPANY.name}</div>
                <div>{COMPANY.address}</div>
                <div>GSTIN/UIN: {COMPANY.gstin}</div>
                <div>
                  State Name : {COMPANY.state}, Code : {COMPANY.code}
                </div>
                <div>E-Mail : {COMPANY.email}</div>
              </div>
            </div>
            <PartyBlock label="Dispatch To" p={ch.dispatchTo} />
            <div className="px-1.5 py-1 min-h-[87px]">
              <div className="text-[10px]">Party</div>
              <div className="font-bold text-[11px]">{party?.name}</div>
              {party?.address && <div className="text-[10.5px]">{party.address}</div>}
              {party?.gstin && <div className="text-[10.5px]">GSTIN/UIN &nbsp;&nbsp;&nbsp;&nbsp;: {party.gstin}</div>}
              {party?.stateName && (
                <div className="text-[10.5px]">
                  State Name &nbsp;&nbsp;: {party.stateName}
                  {party.stateCode ? `, Code : ${party.stateCode}` : ""}
                </div>
              )}
            </div>
          </div>

          {/* right */}
          <div className="grid grid-cols-2 auto-rows-min">
            <RefCell label="Challan No." value={ch.challanNo} className="border-b border-r border-black" />
            <RefCell label="Dated" value={fmtDate(ch.challanDate)} className="border-b border-black" />
            <RefCell label="" value="" className="border-b border-r border-black" />
            <RefCell label="Mode/Terms of Payment" value={ch.modeTermsOfPayment} className="border-b border-black" />
            <RefCell label="Reference No. & Date." value={ch.referenceNoDate} className="border-b border-r border-black" />
            <RefCell label="Other References" value={ch.otherReferences} className="border-b border-black" />
            <RefCell label="Buyer's Order No." value={ch.buyersOrderNo} className="border-b border-r border-black" />
            <RefCell label="Dated" value={fmtDate(ch.buyersOrderDate)} className="border-b border-black" />
            <RefCell label="Dispatch Doc No." value={ch.dispatchDocNo} className="border-b border-r border-black" />
            <RefCell label="" value="" className="border-b border-black" />
            <RefCell label="Dispatched through" value={ch.dispatchedThrough} className="border-b border-r border-black" />
            <RefCell label="Destination" value={ch.destination} className="border-b border-black" />
            <RefCell label="Date & Time of Issue" value={fmtDateTime(ch.dateTimeOfIssue)} className="border-b border-r border-black" />
            <RefCell label="Motor Vehicle No." value={ch.motorVehicleNo} className="border-b border-black" />
            <RefCell label="" value="" className="border-b border-r border-black" />
            <RefCell label="Duration of Process" value={ch.durationOfProcess} className="border-b border-black" />
            <RefCell label="Nature of Processing" value={ch.natureOfProcessing} className="col-span-2 min-h-[80px]" />
          </div>
        </div>

        {/* items */}
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="border-b border-black">
              <th className="w-[5%] border-r border-black font-normal text-[8px] py-0.5">Sl No.</th>
              <th className="border-r border-black font-normal">Description of Goods</th>
              <th className="w-[12%] border-r border-black font-normal">HSN/SAC</th>
              <th className="w-[12%] border-r border-black font-normal">Quantity</th>
              <th className="w-[9%] border-r border-black font-normal">Rate</th>
              <th className="w-[5%] border-r border-black font-normal">per</th>
              <th className="w-[12%] font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(ch.items || []).map((it, i) => (
              <tr key={i} className="align-top">
                <td className="border-r border-black text-right pr-1">{i + 1}</td>
                <td className="border-r border-black px-1 font-bold">{it.description}</td>
                <td className="border-r border-black px-1">{it.hsnSac}</td>
                <td className="border-r border-black px-1 font-bold">
                  {Number(it.quantity).toFixed(2)} {it.unit || "NOS"}
                </td>
                <td className="border-r border-black px-1 text-right">{fmtIndian(it.rate)}</td>
                <td className="border-r border-black px-1 text-[9px]">{it.unit || "NOS"}</td>
                <td className="px-1 text-right font-bold">{fmtIndian(it.amount)}</td>
              </tr>
            ))}
            {breakup.length > 0 && (
              <>
                <tr>
                  <td className="border-r border-black" colSpan={6} />
                  <td className="px-1 text-right border-t border-black">{fmtIndian(ch.subTotal)}</td>
                </tr>
                {breakup.map((t) => (
                  <tr key={t.name}>
                    <td className="border-r border-black px-1 text-right font-bold italic" colSpan={4}>
                      {t.name} OUTPUT
                    </td>
                    <td className="border-r border-black px-1 text-right italic">{t.rate}</td>
                    <td className="border-r border-black px-1 italic">%</td>
                    <td className="px-1 text-right font-bold">{fmtIndian(t.amount)}</td>
                  </tr>
                ))}
              </>
            )}
            {/* spacer so the column rules run down like the printed form */}
            <tr style={{ height: 120 }}>
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <td key={k} className="border-r border-black" />
              ))}
              <td />
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-black">
              <td className="border-r border-black" />
              <td className="border-r border-black px-1 text-right">Total</td>
              <td className="border-r border-black" />
              <td className="border-r border-black px-1 font-bold">{totalQty(ch.items)}</td>
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="px-1 text-right font-bold text-[12px]">₹ {fmtIndian(ch.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="border-t border-black px-1.5 py-1">
          <div className="flex justify-between text-[9px]">
            <span>Amount Chargeable (in words)</span>
            <span className="italic">E. &amp; O.E</span>
          </div>
          <div className="font-bold text-[11.5px]">{ch.amountInWords}</div>
        </div>

        {breakup.length > 0 && (
          <>
            <div className="border-t border-black flex justify-end">
              <table className="border-collapse text-[9.5px] text-right">
                <thead>
                  <tr>
                    <th rowSpan={2} className="border border-black font-normal px-2" />
                    <th rowSpan={2} className="border border-black font-normal px-2">
                      Taxable Value
                    </th>
                    {breakup.map((t) => (
                      <th key={t.name} colSpan={2} className="border border-black font-normal text-center">
                        {t.name}
                      </th>
                    ))}
                    <th rowSpan={2} className="border border-black font-normal px-2">
                      Total Tax Amount
                    </th>
                  </tr>
                  <tr>
                    {breakup.map((t) => (
                      <Fragment key={t.name}>
                        <th key={`${t.name}r`} className="border border-black font-normal px-1">
                          Rate
                        </th>
                        <th key={`${t.name}a`} className="border border-black font-normal px-1">
                          Amount
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-black" />
                    <td className="border border-black px-2">{fmtIndian(ch.subTotal)}</td>
                    {breakup.map((t) => (
                      <Fragment key={t.name}>
                        <td key={`${t.name}r`} className="border border-black px-1">
                          {t.rate}%
                        </td>
                        <td key={`${t.name}a`} className="border border-black px-1">
                          {fmtIndian(t.amount)}
                        </td>
                      </Fragment>
                    ))}
                    <td className="border border-black px-2">{fmtIndian(ch.taxAmount)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="border border-black px-2">Total:</td>
                    <td className="border border-black px-2">{fmtIndian(ch.subTotal)}</td>
                    {breakup.map((t) => (
                      <Fragment key={t.name}>
                        <td key={`${t.name}r`} className="border border-black" />
                        <td key={`${t.name}a`} className="border border-black px-1">
                          {fmtIndian(t.amount)}
                        </td>
                      </Fragment>
                    ))}
                    <td className="border border-black px-2">{fmtIndian(ch.taxAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border-t border-black px-1.5 py-1.5 text-[10px]">
              Tax Amount (in words) : <span className="font-bold text-[11px]">&nbsp;{ch.taxAmountInWords}</span>
            </div>
          </>
        )}

        <div className="flex justify-end pt-10">
          <div className="w-1/2 border-l border-t border-black px-1.5 py-1 h-[70px] flex flex-col justify-between text-[10px]">
            <div className="font-bold text-right">for {COMPANY.name}</div>
            <div className="text-right">Authorised Signatory</div>
          </div>
        </div>
      </div>
      <div className="text-center text-[10px] mt-2">This is a Computer Generated Document</div>
    </div>
  );
}