/*
  Converts a non-negative integer (rupees) to words using the Indian
  numbering system (Lakh/Crore), matching how amounts are written out on
  the PI template, e.g. 236000 -> "Two Lakh Thirty Six Thousand".

  Only whole rupees are supported (paise are rounded to the nearest
  rupee before conversion) since that's what the template shows.
*/

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

const twoDigits = (n) => {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? " " + ONES[o] : ""}`;
};

const threeDigits = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
};

// Splits into crore / lakh / thousand / hundred groups per the Indian system.
export const numberToWordsIndian = (value) => {
  let n = Math.round(Number(value) || 0);
  if (n === 0) return "Zero";
  if (n < 0) return `Minus ${numberToWordsIndian(-n)}`;

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(" ").replace(/\s+/g, " ").trim();
};

// e.g. amountInWordsRupees(236000) -> "Rupees Two Lakh Thirty Six Thousand Only"
export const amountInWordsRupees = (value) => `Rupees ${numberToWordsIndian(value)} Only`;

// Indian digit grouping for display, e.g. 200000 -> "2,00,000"
export const formatIndianNumber = (value) => {
  const n = Number(value) || 0;
  const isNegative = n < 0;
  const [intPart, decPart] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split(".");

  let formatted;
  if (intPart.length <= 3) {
    formatted = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    formatted = `${grouped},${last3}`;
  }

  return `${isNegative ? "-" : ""}${formatted}${decPart ? "." + decPart : ""}`;
};