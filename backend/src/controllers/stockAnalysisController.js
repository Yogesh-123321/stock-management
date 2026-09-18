import asyncHandler from "express-async-handler";
import StockEntry from "../models/StockEntry.js";
import Part from "../models/Part.js";

/*
  Price source: StockEntry.price/unit — the rate actually entered on each
  delivery in the receiving flow (see StockEntryStep.jsx / stockBooking.js).
  That's real, per-purchase pricing, so it can genuinely vary entry to
  entry — unlike Part.price (the single current registered rate), which is
  only used here as a fallback for older entries logged before per-entry
  pricing existed, so their line doesn't just disappear from the analysis.
*/
export const getPartPriceAnalysis = asyncHandler(async (req, res) => {
  const { partId } = req.params;

  const [part, entries] = await Promise.all([
    Part.findById(partId, "price"),
    StockEntry.find({ part: partId, stockApplied: true })
      .populate("vendor", "companyName")
      .sort({ createdAt: 1 }),
  ]);

  const fallbackPrice = Number(part?.price);
  const hasFallback = Number.isFinite(fallbackPrice) && fallbackPrice > 0;

  const priced = entries
    .map((e) => {
      const own = Number(e.price);
      const price = Number.isFinite(own) && own > 0 ? own : hasFallback ? fallbackPrice : null;
      return { e, price };
    })
    .filter(({ price }) => price != null);

  if (!priced.length) {
    return res.json({
      summary: "No priced purchase history available for this part yet.",
      aiInsight: "There isn't enough priced purchase history yet for an AI read on this part. Once a few receipts come in with rates on them, insights and a trend chart will appear here.",
      insights: [],
      trend: [],
      vendorAnalysis: [],
      suggestedVendor: null,
    });
  }

  const vendorStats = {};
  let highestPrice = 0;
  let highestVendor = null;
  let lowestPrice = Infinity;
  let lowestVendor = null;

  priced.forEach(({ e, price }) => {
    const vendor = e.vendor?.companyName || "Unknown";

    if (!vendorStats[vendor]) {
      vendorStats[vendor] = {
        vendor,
        count: 0,
        totalPrice: 0,
        highest: 0,
        lowest: Infinity,
        prices: [],
        lastPurchaseDate: null,
      };
    }

    vendorStats[vendor].count++;
    vendorStats[vendor].totalPrice += price;
    vendorStats[vendor].highest = Math.max(vendorStats[vendor].highest, price);
    vendorStats[vendor].lowest = Math.min(vendorStats[vendor].lowest, price);
    vendorStats[vendor].prices.push(price);
    const entryDate = e.date || e.createdAt;
    if (entryDate && (!vendorStats[vendor].lastPurchaseDate || new Date(entryDate) > new Date(vendorStats[vendor].lastPurchaseDate))) {
      vendorStats[vendor].lastPurchaseDate = entryDate;
    }

    if (price > highestPrice) {
      highestPrice = price;
      highestVendor = vendor;
    }

    if (price < lowestPrice) {
      lowestPrice = price;
      lowestVendor = vendor;
    }
  });

  // ---- Point-in-time trend series for the chart -----------------------
  // Chronological (already sorted by createdAt asc from the query above).
  // A simple trailing moving average is included alongside each raw price
  // so the chart can plot a smoothed line next to the noisy one.
  const WINDOW = 3;
  const trend = priced.map(({ e, price }, idx) => {
    const windowSlice = priced.slice(Math.max(0, idx - WINDOW + 1), idx + 1);
    const movingAvg =
      windowSlice.reduce((sum, p) => sum + p.price, 0) / windowSlice.length;
    return {
      date: e.date || e.createdAt,
      price,
      vendor: e.vendor?.companyName || "Unknown",
      movingAvg: Number(movingAvg.toFixed(2)),
      reference: e.reference?.number || null,
    };
  });

  // ---- Overall indicators ---------------------------------------------
  const prices = priced.map((p) => p.price);
  const purchaseCount = prices.length;
  const totalSpend = prices.reduce((s, p) => s + p, 0);
  const avgPrice = totalSpend / purchaseCount;

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice =
    purchaseCount % 2 === 0
      ? (sortedPrices[purchaseCount / 2 - 1] + sortedPrices[purchaseCount / 2]) / 2
      : sortedPrices[(purchaseCount - 1) / 2];

  const variance =
    prices.reduce((s, p) => s + (p - avgPrice) ** 2, 0) / purchaseCount;
  const stdDev = Math.sqrt(variance);
  const volatilityPercent = avgPrice > 0 ? (stdDev / avgPrice) * 100 : 0;

  const latestPrice = prices[prices.length - 1];
  const latestVsAvgPercent = avgPrice > 0 ? ((latestPrice - avgPrice) / avgPrice) * 100 : 0;

  // Trend direction: compare the average of the earliest window of
  // purchases against the average of the most recent window, so a single
  // outlier reading doesn't flip the verdict.
  const earlyWindow = prices.slice(0, Math.min(WINDOW, purchaseCount));
  const recentWindow = prices.slice(Math.max(0, purchaseCount - WINDOW));
  const earlyAvg = earlyWindow.reduce((s, p) => s + p, 0) / earlyWindow.length;
  const recentAvg = recentWindow.reduce((s, p) => s + p, 0) / recentWindow.length;
  const momentumPercent = earlyAvg > 0 ? ((recentAvg - earlyAvg) / earlyAvg) * 100 : 0;

  let trendDirection = "stable";
  if (momentumPercent > 2) trendDirection = "rising";
  else if (momentumPercent < -2) trendDirection = "falling";

  const vendorAnalysisRaw = Object.values(vendorStats).map((v) => {
    const vAvg = v.totalPrice / v.count;
    const vVariance = v.prices.reduce((s, p) => s + (p - vAvg) ** 2, 0) / v.count;
    const vVolatilityPercent = vAvg > 0 ? (Math.sqrt(vVariance) / vAvg) * 100 : 0;
    return {
      ...v,
      avgPrice: vAvg,
      volatilityPercent: vVolatilityPercent,
    };
  });

  // Rank vendors by average price so the cheapest / costliest are easy to
  // flag in the UI, and express each vendor's average as a % vs the
  // overall average so "best/worst" carries a magnitude, not just a label.
  const vendorAnalysis = vendorAnalysisRaw
    .sort((a, b) => a.avgPrice - b.avgPrice)
    .map((v, idx) => {
      const { prices, ...rest } = v;
      return {
        ...rest,
        vsAvgPercent: avgPrice > 0 ? Number((((v.avgPrice - avgPrice) / avgPrice) * 100).toFixed(2)) : 0,
        volatilityPercent: Number(v.volatilityPercent.toFixed(2)),
        rank: idx + 1,
      };
    });

  const bestVendor = vendorAnalysis.length > 1 ? vendorAnalysis[0] : null;
  const worstVendor = vendorAnalysis.length > 1 ? vendorAnalysis[vendorAnalysis.length - 1] : null;

  // ---- Suggested vendor for the next purchase --------------------------
  // Not just "cheapest average" — the cheapest vendor is only recommended
  // outright when it's clearly ahead. If a close rival (within 3% on
  // price) is meaningfully more consistent (lower volatility) or has a
  // longer, more recent track record, that vendor is suggested instead so
  // a one-off low quote doesn't outrank a reliably good one.
  let suggestedVendor = null;
  if (vendorAnalysis.length === 1) {
    const only = vendorAnalysis[0];
    suggestedVendor = {
      vendor: only.vendor,
      avgPrice: Number(only.avgPrice.toFixed(2)),
      vsAvgPercent: only.vsAvgPercent,
      volatilityPercent: only.volatilityPercent,
      count: only.count,
      lastPurchaseDate: only.lastPurchaseDate,
      reason: `${only.vendor} is the only vendor on record for this part (${only.count} purchase${only.count > 1 ? "s" : ""} so far), averaging ₹${only.avgPrice.toFixed(2)}. Bringing in a second vendor would help confirm whether this pricing is competitive.`,
    };
  } else if (vendorAnalysis.length > 1) {
    const cheapest = vendorAnalysis[0];
    const runnerUp = vendorAnalysis[1];
    const priceGapToRunnerUp = runnerUp.avgPrice > 0
      ? ((runnerUp.avgPrice - cheapest.avgPrice) / runnerUp.avgPrice) * 100
      : 0;

    let pick = cheapest;
    let reasonBits = [];

    if (priceGapToRunnerUp < 3 && runnerUp.volatilityPercent < cheapest.volatilityPercent - 5 && runnerUp.count >= cheapest.count) {
      // Close on price, but the runner-up is notably steadier and at
      // least as proven — recommend the steadier one instead.
      pick = runnerUp;
      reasonBits.push(
        `${pick.vendor}'s average price (₹${pick.avgPrice.toFixed(2)}) is within ${priceGapToRunnerUp.toFixed(1)}% of the cheapest vendor, but its pricing has been noticeably more consistent (±${pick.volatilityPercent.toFixed(1)}% vs ±${cheapest.volatilityPercent.toFixed(1)}% for ${cheapest.vendor}) across ${pick.count} purchase${pick.count > 1 ? "s" : ""}.`
      );
    } else {
      reasonBits.push(
        `${pick.vendor} offers the lowest average price at ₹${pick.avgPrice.toFixed(2)} (${Math.abs(pick.vsAvgPercent).toFixed(1)}% ${pick.vsAvgPercent <= 0 ? "below" : "above"} the overall average), based on ${pick.count} past purchase${pick.count > 1 ? "s" : ""}.`
      );
    }

    if (pick.volatilityPercent <= 10) {
      reasonBits.push(`Its pricing has also been fairly consistent (±${pick.volatilityPercent.toFixed(1)}%), so the quote is a reasonable predictor of what the next order will cost.`);
    } else {
      reasonBits.push(`Its pricing has varied a fair amount in the past (±${pick.volatilityPercent.toFixed(1)}%), so it's worth confirming the quote before placing the order.`);
    }

    if (pick.lastPurchaseDate) {
      const daysAgo = Math.round((Date.now() - new Date(pick.lastPurchaseDate).getTime()) / 86400000);
      if (daysAgo > 180) {
        reasonBits.push(`Its last recorded purchase was over ${Math.floor(daysAgo / 30)} months ago, so it may be worth reconfirming current pricing.`);
      }
    }

    suggestedVendor = {
      vendor: pick.vendor,
      avgPrice: Number(pick.avgPrice.toFixed(2)),
      vsAvgPercent: pick.vsAvgPercent,
      volatilityPercent: pick.volatilityPercent,
      count: pick.count,
      lastPurchaseDate: pick.lastPurchaseDate,
      reason: reasonBits.join(" "),
    };
  }

  const increasePercent =
    lowestPrice > 0
      ? (((highestPrice - lowestPrice) / lowestPrice) * 100).toFixed(2)
      : 0;

  // ---- AI insight paragraph --------------------------------------------
  // Rule-based, deterministic "AI" read over the same numbers already
  // computed above — no external model call, so it's instant and free of
  // hallucination risk, but written up the way an analyst summary would be.
  const insightParts = [];

  insightParts.push(
    trendDirection === "rising"
      ? `Pricing for this part has been trending upward — the most recent purchases average about ${momentumPercent.toFixed(1)}% higher than the earliest ones on record.`
      : trendDirection === "falling"
      ? `Pricing for this part has been trending downward — the most recent purchases average about ${Math.abs(momentumPercent).toFixed(1)}% lower than the earliest ones on record.`
      : `Pricing for this part has stayed relatively stable over the recorded purchase history.`
  );

  insightParts.push(
    volatilityPercent > 15
      ? `Prices swing quite a bit between purchases (±${volatilityPercent.toFixed(1)}% around the average of ₹${avgPrice.toFixed(2)}), which usually points to inconsistent vendor quoting rather than a genuine market shift.`
      : `Prices have been fairly consistent between purchases (±${volatilityPercent.toFixed(1)}% around the average of ₹${avgPrice.toFixed(2)}).`
  );

  if (bestVendor && worstVendor && bestVendor.vendor !== worstVendor.vendor) {
    const gapPercent = worstVendor.avgPrice > 0
      ? (((worstVendor.avgPrice - bestVendor.avgPrice) / worstVendor.avgPrice) * 100).toFixed(1)
      : 0;
    insightParts.push(
      `${bestVendor.vendor} has offered the best pricing on average (₹${bestVendor.avgPrice.toFixed(2)}), while ${worstVendor.vendor} has been the most expensive (₹${worstVendor.avgPrice.toFixed(2)}) — about ${gapPercent}% higher. It may be worth shifting more volume to ${bestVendor.vendor} or renegotiating with ${worstVendor.vendor}.`
    );
  } else if (vendorAnalysis.length === 1) {
    insightParts.push(`All recorded purchases have come from a single vendor (${vendorAnalysis[0].vendor}), so there's no like-for-like vendor comparison yet.`);
  }

  if (latestVsAvgPercent > 5) {
    insightParts.push(`The most recent purchase price is ${latestVsAvgPercent.toFixed(1)}% above the historical average — worth a quick check before the next order.`);
  } else if (latestVsAvgPercent < -5) {
    insightParts.push(`The most recent purchase price is ${Math.abs(latestVsAvgPercent).toFixed(1)}% below the historical average — a good sign if it's expected to hold.`);
  }

  const aiInsight = insightParts.join(" ");

  res.json({
    summary: `Price increased by ${increasePercent}% from lowest recorded purchase. Highest price was supplied by ${highestVendor}.`,
    aiInsight,
    highestPrice,
    highestVendor,
    lowestPrice,
    lowestVendor,
    increasePercent,
    purchaseCount,
    avgPrice: Number(avgPrice.toFixed(2)),
    medianPrice: Number(medianPrice.toFixed(2)),
    volatilityPercent: Number(volatilityPercent.toFixed(2)),
    trendDirection,
    momentumPercent: Number(momentumPercent.toFixed(2)),
    latestPrice: Number(latestPrice.toFixed(2)),
    latestVsAvgPercent: Number(latestVsAvgPercent.toFixed(2)),
    bestVendor,
    worstVendor,
    suggestedVendor,
    vendorAnalysis,
    trend,
  });
});