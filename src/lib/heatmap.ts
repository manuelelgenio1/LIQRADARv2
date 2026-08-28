import type { LiqEvent } from "./market";
import { clamp } from "./format";

export type LadderLevel = {
  price: number;
  /** 0..1 normalized intensity */
  intensity: number;
  /** estimated notional resting at this level, USD */
  estUsd: number;
  tags: string[];
};

export type Ladder = { above: LadderLevel[]; below: LadderLevel[] };

const BUCKET = 60; // USDT per level
const RANGE = 0.05; // ±5 % around mark price
const LEV_BANDS: { lev: number; amp: number }[] = [
  { lev: 100, amp: 0.92 },
  { lev: 50, amp: 0.78 },
  { lev: 25, amp: 1.0 },
  { lev: 10, amp: 0.55 },
];
const SIGMA = 0.0026;

const gauss = (d: number, center: number, sigma: number) =>
  Math.exp(-((d - center) ** 2) / (2 * sigma * sigma));

/**
 * Builds an estimated liquidation ladder around the current mark price.
 * Sources of intensity:
 *  1. Distance decay (closer to price = more leverage concentrated)
 *  2. High-leverage liquidation bands (10x / 25x / 50x / 100x)
 *  3. Round-number magnets ($250 / $500 / $1.000)
 *  4. Recently executed liquidations (decaying memory, 8 min half-life)
 */
export function computeLadder(price: number, events: LiqEvent[], now: number): Ladder {
  if (!price || !isFinite(price)) return { above: [], below: [] };

  const lo = Math.ceil((price * (1 - RANGE)) / BUCKET) * BUCKET;
  const hi = Math.floor((price * (1 + RANGE)) / BUCKET) * BUCKET;

  const buckets: { price: number; raw: number; tags: string[] }[] = [];
  for (let p = lo; p <= hi; p += BUCKET) {
    if (Math.abs(p - price) < BUCKET * 0.75) continue; // leave the pin zone clear
    const d = (p - price) / price;

    let raw = Math.exp(-((d / 0.014) ** 2)) * 0.16;
    const tags: string[] = [];

    // round-number magnets
    if (p % 1000 === 0) { raw += 0.34; tags.push("redondo"); }
    else if (p % 500 === 0) { raw += 0.21; }
    else if (p % 250 === 0) { raw += 0.09; }

    // leverage bands: longs opened below liquidate at entry*(1-1/L),
    // shorts opened above at entry*(1+1/L)
    const side = d > 0 ? 1 : -1;
    for (const { lev, amp } of LEV_BANDS) {
      const band = side / lev;
      const g = gauss(d, band, SIGMA);
      if (g > 0.02) {
        raw += amp * g;
        if (g > 0.55) tags.push(`${lev}×`);
      }
    }

    buckets.push({ price: p, raw, tags });
  }

  // executed-liquidation memory
  for (const ev of events) {
    const age = now - ev.time;
    if (age > 20 * 60_000 || ev.price < lo || ev.price > hi) continue;
    const decay = Math.pow(0.5, age / 480_000);
    const w = clamp(Math.log10(ev.usd / 400 + 1) / 3.2, 0.05, 1) * decay * 0.85;
    const b = buckets.find((x) => Math.abs(x.price - ev.price) < BUCKET / 2);
    if (b) {
      b.raw += w;
      if (w > 0.5 && !b.tags.includes("ejecutada")) b.tags.push("ejecutada");
    }
  }

  const max = Math.max(0.001, ...buckets.map((b) => b.raw));
  const levels: LadderLevel[] = buckets
    .map((b) => ({
      price: b.price,
      intensity: 0.05 + 0.95 * (b.raw / max),
      estUsd: (0.05 + 0.95 * (b.raw / max)) * 42_000_000,
      tags: b.tags.slice(0, 2),
    }))
    .sort((a, b) => a.price - b.price);

  const above = levels
    .filter((l) => l.price > price)
    .slice(0, 14)
    .sort((a, b) => a.price - b.price);
  const below = levels
    .filter((l) => l.price < price)
    .sort((a, b) => b.price - a.price)
    .slice(0, 14);

  return { above, below };
}

/** maintenance-margin approximation used by the calculator */
export function liquidationPrice(
  entry: number,
  leverage: number,
  side: "long" | "short",
  mode: "isolated" | "cross"
): number {
  const mmr = mode === "isolated" ? 0.004 : 0.005;
  return side === "long"
    ? entry * (1 - 1 / leverage + mmr)
    : entry * (1 + 1 / leverage - mmr);
}
