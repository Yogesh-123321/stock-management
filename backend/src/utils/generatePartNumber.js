import Part from "../models/Part.js";

/*
  Builds the next TT UNIQUE PART NUMBER for a given companyCode + category +
  partTypeBatchNo combination, by finding the highest existing running serial
  number for that combination and incrementing it (zero-padded to 3 digits,
  matching the Master Database convention, e.g. TTAYFAN001, TTAYFAN002 ...).
*/
export const generateNextPartNumber = async (companyCode, category, partTypeBatchNo) => {
  const prefix = `${companyCode}${category}${partTypeBatchNo}`.toUpperCase();

  const existing = await Part.find({
    companyCode: companyCode.toUpperCase(),
    category: category.toUpperCase(),
    partTypeBatchNo: partTypeBatchNo.toUpperCase(),
  }).sort({ runningSerialNo: -1 });

  let nextSerial = 1;
  if (existing.length > 0) {
    const serials = existing
      .map((p) => parseInt(p.runningSerialNo, 10))
      .filter((n) => !Number.isNaN(n));
    if (serials.length > 0) nextSerial = Math.max(...serials) + 1;
  }

  const paddedSerial = String(nextSerial).padStart(3, "0");
  return {
    ttUniquePartNumber: `${prefix}${paddedSerial}`,
    runningSerialNo: paddedSerial,
  };
};
