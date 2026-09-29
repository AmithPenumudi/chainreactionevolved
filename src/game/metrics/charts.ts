/*
 * Chart geometry for the internal dashboard, kept pure so the maths is testable without a DOM.
 * Rendering (SVG strings, hover, theming) lives in scripts/dashboard.mjs.
 */

export interface Scale {
  /** Data value -> pixel position. */
  (value: number): number;
  domainMax: number;
  ticks: number[];
}

/** Rounds up to a clean 1/2/5 × 10^n step, so axis ticks land on readable numbers. */
export function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * A linear scale from 0 to a rounded-up maximum, with clean ticks.
 * Always anchored at zero: a bar chart that starts anywhere else misstates its own ratios.
 */
export function linearScale(maxValue: number, pixels: number, targetTicks = 4): Scale {
  const step = niceStep(Math.max(maxValue, 1) / targetTicks);
  const domainMax = Math.max(step, Math.ceil(Math.max(maxValue, 0) / step) * step);
  const ticks: number[] = [];
  for (let t = 0; t <= domainMax + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  const scale = ((value: number) => pixels - (value / domainMax) * pixels) as Scale;
  scale.domainMax = domainMax;
  scale.ticks = ticks;
  return scale;
}

export interface Band {
  x: number;
  width: number;
  centre: number;
}

/**
 * Evenly spaced slots across a width. `barWidth` is capped at 24px per the mark spec — a bar
 * that fills its whole slot reads as a solid block, and the leftover space is what separates
 * neighbours (a 2px surface gap), not a stroke around each bar.
 */
export function bands(count: number, width: number, maxBar = 24): Band[] {
  if (count <= 0) return [];
  const slot = width / count;
  const barWidth = Math.max(1, Math.min(maxBar, slot - 2));
  return Array.from({ length: count }, (_, i) => {
    const centre = i * slot + slot / 2;
    return { x: centre - barWidth / 2, width: barWidth, centre };
  });
}

/** Points for a polyline across evenly spaced x positions. */
export function linePoints(values: number[], scale: Scale, width: number): [number, number][] {
  if (values.length === 0) return [];
  if (values.length === 1) return [[width / 2, scale(values[0])]];
  const stepX = width / (values.length - 1);
  return values.map((v, i) => [i * stepX, scale(v)]);
}

export interface StackSegment {
  key: string;
  value: number;
  /** Pixel offset from the start of the bar. */
  x: number;
  width: number;
  share: number;
}

/**
 * Lays out a horizontal 100% stacked bar. A 2px gap in the surface colour separates touching
 * segments; zero-valued categories are dropped so they cannot produce a sliver with a label.
 */
export function stackLayout(
  entries: { key: string; value: number }[],
  width: number,
  gap = 2,
): StackSegment[] {
  const present = entries.filter((e) => e.value > 0);
  const total = present.reduce((n, e) => n + e.value, 0);
  if (total <= 0 || present.length === 0) return [];
  const available = width - gap * (present.length - 1);
  let cursor = 0;
  return present.map((e) => {
    const share = e.value / total;
    const w = available * share;
    const seg = { key: e.key, value: e.value, x: cursor, width: w, share };
    cursor += w + gap;
    return seg;
  });
}

/** 1,284 / 12.9K / 3.4M — compact enough for a stat tile without losing the magnitude. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** Hours as "3h 20m" / "45m" / "—", for play-time figures. */
export function duration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0m";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Whether a label fits inside a mark with comfortable padding. Used to decide between an
 * in-segment label and letting the legend and table carry the value — a clipped label is
 * worse than no label.
 */
export function labelFits(text: string, markWidth: number, charWidth = 6.2, padding = 8): boolean {
  return text.length * charWidth + padding * 2 <= markWidth;
}
