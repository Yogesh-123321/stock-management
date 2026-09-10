import Part from "../models/Part.js";

/*
  Builds the TT UNIQUE PART NUMBER for a company code + category + part
  type/batch no. combination:

    TT UNIQUE PART NUMBER = COMPANY CODE + CATEGORY + PART TYPE/BATCH NO.
    e.g. TT + AY + FAN  =>  TTAYFAN

  There is no running serial number appended anymore. Each
  company-code/category/batch-no combination now IS the part number, so it
  can only ever belong to one part — if that exact combination is already
  in the master, this is a real conflict (not a case for auto-incrementing
  a suffix onto it), so it throws instead of silently generating the "next"
  number.
*/
export class DuplicatePartNumberError extends Error {
  constructor(ttUniquePartNumber, existingPart) {
    super(
      `Part number ${ttUniquePartNumber} already exists${
        existingPart?.itemDescription ? ` (${existingPart.itemDescription})` : ""
      }. Choose a different company code, category or part type/batch no. — or use the existing part instead of creating a new one.`
    );
    this.name = "DuplicatePartNumberError";
    this.status = 409;
    this.ttUniquePartNumber = ttUniquePartNumber;
  }
}

export const buildPartNumber = async (companyCode, category, partTypeBatchNo) => {
  const ttUniquePartNumber = `${companyCode}${category}${partTypeBatchNo}`.toUpperCase();

  const existing = await Part.findOne({ ttUniquePartNumber }).select("itemDescription");
  if (existing) {
    throw new DuplicatePartNumberError(ttUniquePartNumber, existing);
  }

  return { ttUniquePartNumber };
};