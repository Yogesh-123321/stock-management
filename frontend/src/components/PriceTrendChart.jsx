import { useMemo, useState } from "react";

/**
 * Lightweight, dependency-free line chart for the AI Price Analyzer.
 *
 * Plots the raw per-purchase price alongside a trailing moving average,
 * with a hover tooltip. Built as plain SVG (no charting library) so it
 * doesn't add a new npm dependency to the project.
 *
 * @param {{ date: string, price: number, movingAvg: number, vendor: string, reference?: string }[]} data
 */
export default function PriceTrendChart({ data = [], height = 220 }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const WIDTH = 700;
  const PAD_LEFT = 48;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 28;

  const plot = useMemo(() => {
    if (!data.length) return null;

    const prices = data.map((d) => d.price);
    const movingAvgs = data.map((d) => d.movingAvg ?? d.price);
    const allValues = [...prices, ...movingAvgs];
    let min = Math.min(...allValues);
    let max = Math.max(...allValues);
    if (min === max) {
      // Flat series — give it some breathing room so the line isn't glued
      // to an edge.
      min -= Math.max(1, min * 0.1);
      max += Math.max(1, max * 0.1);
    } else {
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;
    }

    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const innerH = height - PAD_TOP - PAD_BOTTOM;

    const xAt = (i) =>
      data.length === 1
        ? PAD_LEFT + innerW / 2
        : PAD_LEFT + (i / (data.length - 1)) * innerW;
    const yAt = (v) => PAD_TOP + innerH - ((v - min) / (max - min)) * innerH;

    const pricePoints = data.map((d, i) => [xAt(i), yAt(d.price)]);
    const avgPoints = data.map((d, i) => [xAt(i), yAt(d.movingAvg ?? d.price)]);

    return { min, max, xAt, yAt, pricePoints, avgPoints, innerW, innerH };
  }, [data, height]);

  if (!plot || !data.length) {
    return (
      <p className="text-sm text-muted-foreground">Not enough data yet to plot a trend.</p>
    );
  }

  const toPath = (points) => points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");

  // Only label a handful of x-axis ticks so dates don't overlap when there
  // are many purchases.
  const tickCount = Math.min(data.length, 5);
  const tickIdxs = Array.from({ length: tickCount }, (_, i) =>
    tickCount === 1 ? 0 : Math.round((i / (tickCount - 1)) * (data.length - 1))
  );

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  };

  const handleMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const x = (e.clientX - rect.left) * scaleX;
    let nearest = 0;
    let nearestDist = Infinity;
    plot.pricePoints.forEach(([px], i) => {
      const dist = Math.abs(px - x);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIdx(nearest);
  };

  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  const hoverX = hoverIdx != null ? plot.pricePoints[hoverIdx][0] : null;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded bg-[hsl(var(--primary))]" />
          Purchase price
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded border-t-2 border-dashed border-muted-foreground" />
          3-purchase moving avg
        </span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full touch-none select-none"
        style={{ height }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* horizontal gridlines + y-axis labels */}
        {[0, 0.5, 1].map((t) => {
          const val = plot.min + (plot.max - plot.min) * (1 - t);
          const y = PAD_TOP + plot.innerH * t;
          return (
            <g key={t}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize="9" fill="currentColor" opacity={0.6}>
                ₹{val.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* x-axis date labels */}
        {tickIdxs.map((i) => (
          <text
            key={i}
            x={plot.xAt(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill="currentColor"
            opacity={0.6}
          >
            {fmtDate(data[i].date)}
          </text>
        ))}

        {/* moving average line (dashed) */}
        <path d={toPath(plot.avgPoints)} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.5} strokeDasharray="4 3" />

        {/* price line */}
        <path d={toPath(plot.pricePoints)} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />

        {/* price points */}
        {plot.pricePoints.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={hoverIdx === i ? 4 : 2.5}
            fill="hsl(var(--primary))"
            stroke="white"
            strokeWidth={1}
          />
        ))}

        {/* hover guideline */}
        {hoverX != null && (
          <line x1={hoverX} x2={hoverX} y1={PAD_TOP} y2={PAD_TOP + plot.innerH} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="2 2" />
        )}
      </svg>

      {hovered && (
        <div className="mt-1 rounded border border-border bg-secondary/50 px-2.5 py-1.5 text-xs">
          <span className="font-medium">{fmtDate(hovered.date)}</span>
          {" · "}
          <span>₹{Number(hovered.price).toFixed(2)}</span>
          {" · "}
          <span className="text-muted-foreground">{hovered.vendor}</span>
          {hovered.reference ? <span className="text-muted-foreground"> · {hovered.reference}</span> : null}
        </div>
      )}
    </div>
  );
}