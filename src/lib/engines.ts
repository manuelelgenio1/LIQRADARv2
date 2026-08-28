/* ============================================================
 * LIQRADAR — Feature / Event / Regime / Scenario / Signal engines
 * (spec §11-§45, §71, §77)
 *
 * Funciones puras: entran datos normalizados + validados,
 * sale evidencia con provenance. Sin fetch, sin UI.
 * Reglas duras aplicadas aquí:
 *  - Agrupación por bloques para evitar double counting (§43)
 *  - Pesos dinámicos por escenario (§44)
 *  - SHORT SQUEEZE = mecanismo alcista, LONG SQUEEZE = bajista (§68)
 *  - NO TRADE es salida válida (§12/§39)
 *  - Clústeres siempre ESTIMATED (§29/§70)
 * ============================================================ */

import type {
  AbsorptionState, BlockScore, Book, BurstState, Candle, Cluster, CrossExchange,
  DataTruth, Dir, FeatureResult, FundingState, LiqEvent, MtfRow, OiRegime,
  OptionsSummary, Provenance, RegimeState, ScenarioState, SignalResult,
  SpoofLevel, Timeframe, Trade,
} from "../types";
import {
  clamp, clamp01, isFiniteNumber, mean, percentileOf, safeRatio, stdev, uid, zScore,
} from "./safe";

export interface EngineInput {
  now: number;
  demo: boolean;
  truth: DataTruth;
  price: number;
  priceTs: number;
  changePct: number;
  spotTrades: Trade[];
  futTrades: Trade[];
  liqs: LiqEvent[];
  book: Book | null;
  bookHistory: Book[];
  oiHistory: { ts: number; oi: number }[];
  fundingRate: number;
  fundingHistory: number[];
  nextFundingTime: number;
  topSeries: { ts: number; ratio: number }[];
  takerSeries: { ts: number; ratio: number }[];
  klines: Partial<Record<Timeframe, Candle[]>>;
  brackets: { bracket: number; maintenanceMarginRate: number }[];
  cross: CrossExchange[];
  options: OptionsSummary | null;
  healthLive: string[];
  healthDegraded: string[];
  healthUnavailable: string[];
  calibrationOffset: number; // §45: ajuste aprendido del journal (OOS)
}

interface CvdView { cvd: number; buy: number; sell: number; slope: number; }

function cvdOf(trades: Trade[], now: number, windowMs: number): CvdView {
  const from = now - windowMs;
  let buy = 0; let sell = 0;
  const buckets = new Array(6).fill(0) as number[];
  for (const t of trades) {
    if (t.ts < from) continue;
    const notional = t.price * t.qty;
    if (t.isBuyerMaker) sell += notional; else buy += notional;
    const idx = clamp(Math.floor(((t.ts - from) / windowMs) * 6), 0, 5);
    buckets[idx] += t.isBuyerMaker ? -notional : notional;
  }
  let slope = 0;
  for (let i = 0; i < buckets.length; i++) slope += buckets[i] * (i - 2.5);
  return { cvd: buy - sell, buy, sell, slope };
}

function prov(input: EngineInput, source: string, quality: number, truth?: DataTruth): Provenance {
  return {
    truth: truth ?? input.truth, source, fetchedAt: input.now,
    ageMs: 0, quality: clamp01(quality),
  };
}

function feat(value: number, direction: Dir, strength: number, confidence: number, p: Provenance): FeatureResult {
  return { value, direction, strength: clamp01(strength), confidence: clamp01(confidence), provenance: p };
}

/* ============================ CVD (§14-§16) ============================ */

function analyzeCvd(input: EngineInput) {
  const W = 5 * 60_000;
  const spot = cvdOf(input.spotTrades, input.now, W);
  const fut = cvdOf(input.futTrades, input.now, W);
  const hasSpot = input.spotTrades.length >= 40;
  const hasFut = input.futTrades.length >= 40;

  const norm = (c: CvdView) => safeRatio(c.cvd, c.buy + c.sell, 0);
  const dirOf = (c: CvdView, has: boolean): Dir =>
    !has ? "neutral" : c.cvd > 0 ? "bullish" : c.cvd < 0 ? "bearish" : "neutral";

  const spotFeat = feat(norm(spot), dirOf(spot, hasSpot), Math.min(1, Math.abs(norm(spot)) * 4), hasSpot ? 0.9 : 0.1,
    prov(input, "binance_spot_aggtrade", hasSpot ? 0.95 : 0.1, hasSpot ? input.truth : "UNAVAILABLE"));
  const futFeat = feat(norm(fut), dirOf(fut, hasFut), Math.min(1, Math.abs(norm(fut)) * 4), hasFut ? 0.9 : 0.1,
    prov(input, "binance_futures_aggtrade", hasFut ? 0.95 : 0.1, hasFut ? input.truth : "UNAVAILABLE"));

  // Divergencia (§16): precio vs CVD futuros vs CVD spot
  const pd: Dir = input.changePct > 0.05 ? "bullish" : input.changePct < -0.05 ? "bearish" : "neutral";
  let divergences: string[] = [];
  let alignmentScore = 0;
  if (hasSpot && hasFut) {
    const parts: [boolean, string][] = [
      [pd !== "neutral" && pd === futFeat.direction, "precio y CVD futuros alineados"],
      [futFeat.direction === spotFeat.direction, "spot confirma futuros"],
      [pd !== "neutral" && pd === spotFeat.direction, "precio y CVD spot alineados"],
    ];
    alignmentScore = parts.filter(([ok]) => ok).length / 3;
    if (pd === "bullish" && futFeat.direction === "bullish" && spotFeat.direction === "bearish")
      divergences.push("Compra apalancada sin confirmación spot (precio↑ CVDfut↑ CVDspot↓)");
    if (pd === "bearish" && futFeat.direction === "bearish" && spotFeat.direction === "bullish")
      divergences.push("Venta apalancada sin confirmación spot (precio↓ CVDfut↓ CVDspot↑)");
    if (futFeat.direction !== "neutral" && spotFeat.direction !== "neutral" && futFeat.direction !== spotFeat.direction)
      divergences.push("CVD spot y futuros en desacuerdo");
  }
  const alignment = feat(alignmentScore - 0.5, alignmentScore > 0.6 ? "bullish" : alignmentScore < 0.4 ? "bearish" : "neutral",
    Math.abs(alignmentScore - 0.5) * 2, hasSpot && hasFut ? 0.85 : 0.15,
    prov(input, "derived", hasSpot && hasFut ? 0.8 : 0.1, "ESTIMATED"));

  return { spotFeat, futFeat, alignment, divergences, spotCvdUsd: spot.cvd, futCvdUsd: fut.cvd, hasSpot, hasFut };
}

/* ============================ OI regime (§13) ============================ */

function analyzeOi(input: EngineInput) {
  const h = input.oiHistory;
  const enough = h.length >= 4;
  const last = h[h.length - 1]?.oi ?? 0;
  const lookback = (ms: number) => {
    const from = input.now - ms;
    const p = h.find((x) => x.ts >= from);
    return p?.oi ?? h[0]?.oi ?? 0;
  };
  const chg15 = safeRatio(last - lookback(15 * 60_000), lookback(15 * 60_000));
  const chg5 = safeRatio(last - lookback(5 * 60_000), lookback(5 * 60_000));
  const chg5prev = safeRatio(lookback(5 * 60_000) - lookback(10 * 60_000), lookback(10 * 60_000));
  const velocity = chg5;
  const acceleration = chg5 - chg5prev;
  const values = h.map((x) => x.oi);
  const percentile = percentileOf(values, last);

  const pUp = input.changePct > 0.03;
  const pDown = input.changePct < -0.03;
  const oiUp = chg15 > 0.004;
  const oiDown = chg15 < -0.004;

  let regime: OiRegime = "NEUTRAL";
  if (pUp && oiUp) regime = "LONG_BUILD";
  else if (pDown && oiUp) regime = "SHORT_BUILD";
  else if (pUp && oiDown) regime = "SHORT_UNWIND";
  else if (pDown && oiDown) regime = "LONG_UNWIND";

  const score =
    regime === "LONG_BUILD" ? 0.55 + Math.min(0.45, Math.abs(chg15) * 30) :
    regime === "SHORT_BUILD" ? -(0.55 + Math.min(0.45, Math.abs(chg15) * 30)) :
    regime === "SHORT_UNWIND" ? 0.25 :
    regime === "LONG_UNWIND" ? -0.25 : 0;

  const f = feat(chg15, score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral",
    Math.min(1, Math.abs(chg15) * 40), enough ? 0.85 : 0.1,
    prov(input, "binance_openinterest", enough ? 0.9 : 0.1, enough ? input.truth : "UNAVAILABLE"));

  return { feature: f, regime, changePct: chg15 * 100, velocity, acceleration, percentile, enough, oiBtc: last };
}

/* ============================ Funding (§18/§32) ============================ */

function analyzeFunding(input: EngineInput) {
  const rate = input.fundingRate;
  const hist = input.fundingHistory;
  const enough = hist.length >= 20 && isFiniteNumber(rate);
  const percentile = enough ? percentileOf(hist, rate) : 0.5;
  const z = enough ? zScore(hist, rate) : 0;

  let state: FundingState = "NORMAL";
  if (enough && percentile >= 0.95 && rate > 0.0002) state = "EXTREME_LONGING";
  else if (enough && percentile <= 0.05 && rate < -0.0002) state = "EXTREME_SHORTING";
  else if (enough && Math.abs(z) > 1.2) state = "ELEVATED";

  // No es "positivo = bajista absoluto": el extremo inclina, no dicta (§18)
  const score = clamp(-z * 0.35, -1, 1);
  const f = feat(rate * 100, score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral",
    clamp01(Math.abs(z) / 2.5), enough ? 0.85 : 0.1,
    prov(input, "binance_funding", enough ? 0.9 : 0.1, enough ? input.truth : "UNAVAILABLE"));

  const crossRates = input.cross.map((c) => c.funding).filter((x): x is number => isFiniteNumber(x));
  const crossAvg = crossRates.length ? mean(crossRates) : undefined;

  return { feature: f, state, percentile, z, enough, crossAvg, crossCount: crossRates.length };
}

/* ============================ Top trader positioning (§19) ============================ */

function analyzePositioning(input: EngineInput) {
  const s = input.topSeries;
  const enough = s.length >= 10;
  const last = s[s.length - 1]?.ratio ?? 1;
  const ratios = s.map((x) => x.ratio);
  const z = enough ? zScore(ratios, last) : 0;
  const deltas = ratios.slice(1).map((v, i) => v - ratios[i]);
  let persistence = 0;
  const sgn = Math.sign(deltas[deltas.length - 1] ?? 0);
  for (let i = deltas.length - 1; i >= 0 && Math.sign(deltas[i]) === sgn && sgn !== 0; i--) persistence++;

  let state: OiRegime = "NEUTRAL";
  if (enough && Math.abs(z) > 0.5) state = z > 0 ? "LONG_BUILD" : "SHORT_BUILD";
  else if (enough && sgn !== 0 && persistence >= 3) state = sgn > 0 ? "LONG_BUILD" : "SHORT_BUILD";

  const score = clamp(z * 0.4 + sgn * 0.1 * Math.min(persistence, 4), -1, 1);
  const f = feat(last, score > 0.08 ? "bullish" : score < -0.08 ? "bearish" : "neutral",
    clamp01(Math.abs(z) / 2), enough ? 0.8 : 0.1,
    prov(input, "binance_top_trader_ratio", enough ? 0.85 : 0.1, enough ? input.truth : "UNAVAILABLE"));

  return { feature: f, state, z, persistence, last, enough };
}

/* ============================ Taker flow (§17) ============================ */

function analyzeTaker(input: EngineInput) {
  const s = input.takerSeries;
  const enough = s.length >= 10;
  const last = s[s.length - 1]?.ratio ?? 1;
  const ratios = s.map((x) => x.ratio);
  const imbalance = safeRatio(last - 1, last + 1);
  const percentile = enough ? percentileOf(ratios, last) : 0.5;
  const momentum = enough && ratios.length > 4 ? mean(ratios.slice(-3)) - mean(ratios.slice(-8, -3)) : 0;

  const score = clamp(imbalance * 3 + momentum * 8, -1, 1);
  const f = feat(last, score > 0.08 ? "bullish" : score < -0.08 ? "bearish" : "neutral",
    clamp01(Math.abs(imbalance) * 5), enough ? 0.8 : 0.1,
    prov(input, "binance_taker_ratio", enough ? 0.85 : 0.1, enough ? input.truth : "UNAVAILABLE"));

  return { feature: f, imbalance, percentile, momentum, enough };
}

/* ================ Order book + absorption + spoof risk (§20-§24) ================ */

function analyzeBook(input: EngineInput) {
  const b = input.book;
  const hist = input.bookHistory;
  const has = !!b && b.bids.length > 3 && b.asks.length > 3;
  const imbalance = has ? safeRatio(b.notionalBid - b.notionalAsk, b.notionalBid + b.notionalAsk) : 0;

  const f = feat(imbalance, imbalance > 0.08 ? "bullish" : imbalance < -0.08 ? "bearish" : "neutral",
    clamp01(Math.abs(imbalance) * 2.5), has ? 0.75 : 0.05,
    prov(input, "binance_l2_depth", has ? 0.8 : 0.05, has ? input.truth : "UNAVAILABLE"));

  // Absorción (§23): flujo agresivo vs progreso de precio vs reposición de liquidez.
  // SIEMPRE "EVENTO ESTIMADO", nunca identidad de participante.
  let absorption: { state: AbsorptionState; strength: number; evidence: string[] } =
    { state: "NONE", strength: 0, evidence: [] };
  const W = 3 * 60_000;
  const from = input.now - W;
  let aggBuy = 0; let aggSell = 0;
  let firstPx = 0; let lastPx = 0;
  for (const t of input.futTrades) {
    if (t.ts < from) continue;
    if (!firstPx) firstPx = t.price;
    lastPx = t.price;
    if (t.isBuyerMaker) aggSell += t.price * t.qty; else aggBuy += t.price * t.qty;
  }
  const totalAgg = aggBuy + aggSell;
  if (has && totalAgg > 0 && hist.length >= 3 && firstPx > 0) {
    const pxMove = safeRatio(lastPx - firstPx, firstPx);
    const efficiency = Math.abs(pxMove) / Math.max(1e-9, totalAgg / 1e6); // menor = más absorción
    const bidRefill = (hist[hist.length - 1]?.notionalBid ?? 0) - (hist[0]?.notionalBid ?? 0);
    const askRefill = (hist[hist.length - 1]?.notionalAsk ?? 0) - (hist[0]?.notionalAsk ?? 0);
    const sellHeavy = safeRatio(aggSell, totalAgg) > 0.62;
    const buyHeavy = safeRatio(aggBuy, totalAgg) > 0.62;
    const ev: string[] = [];
    if (sellHeavy && pxMove > -0.0008 && bidRefill >= 0) {
      const strength = clamp01((1 - clamp01(efficiency)) * 0.6 + 0.4 * clamp01(safeRatio(aggSell, 5e6)));
      if (strength > 0.4) {
        ev.push(`Venta agresiva ${Math.round(safeRatio(aggSell, totalAgg) * 100)}% sin progreso bajista`);
        ev.push(bidRefill > 0 ? "bid repuesto durante el ataque" : "bid estable durante el ataque");
        absorption = { state: "BUY_ABSORPTION", strength, evidence: ev };
      }
    } else if (buyHeavy && pxMove < 0.0008 && askRefill >= 0) {
      const strength = clamp01((1 - clamp01(efficiency)) * 0.6 + 0.4 * clamp01(safeRatio(aggBuy, 5e6)));
      if (strength > 0.4) {
        ev.push(`Compra agresiva ${Math.round(safeRatio(aggBuy, totalAgg) * 100)}% sin progreso alcista`);
        ev.push(askRefill > 0 ? "ask repuesto durante el ataque" : "ask estable durante el ataque");
        absorption = { state: "SELL_ABSORPTION", strength, evidence: ev };
      }
    }
  }

  // Spoof risk (§24): rotación de liquidez grande cerca del toque.
  // Nunca "spoof confirmado" — SPOOF_RISK estimado.
  let spoof: { level: SpoofLevel; evidence: string[] } = { level: "LOW", evidence: [] };
  if (hist.length >= 6) {
    const tops = hist.slice(-12).map((x) => Math.max(x.notionalBid, x.notionalAsk));
    const sd = stdev(tops);
    const churn = safeRatio(sd, mean(tops));
    if (churn > 0.35) {
      spoof = {
        level: churn > 0.6 ? "HIGH" : "ELEVATED",
        evidence: [`Volatilidad de liquidez top-of-book ${(churn * 100).toFixed(0)}% (colocación/retiro rápido)`, "Inferencia de order book — no es spoofing confirmado"],
      };
    }
  }

  return { feature: f, imbalance, absorption, spoof, has };
}

/* ============================ Liquidation burst (§27) ============================ */

function analyzeBurst(input: EngineInput) {
  const liqs = input.liqs;
  const W = 5 * 60_000;
  const from = input.now - W;
  let longUsd = 0; let shortUsd = 0; let count = 0;
  for (const l of liqs) {
    if (l.ts < from) continue;
    count++;
    if (l.side === "SELL") longUsd += l.usd; else shortUsd += l.usd;
  }
  const baseFrom = input.now - 60 * 60_000;
  const hourUsd = liqs.filter((l) => l.ts >= baseFrom).reduce((s, l) => s + l.usd, 0);
  const baseline = Math.max(50_000, hourUsd / 12); // media de ventanas de 5 min en 1h
  const current = longUsd + shortUsd;
  const ratio = safeRatio(current, baseline);

  let state: BurstState = "NORMAL";
  if (ratio >= 10) state = "EXTREME_CASCADE";
  else if (ratio >= 6) state = "CASCADE";
  else if (ratio >= 3) state = "BURST";
  else if (ratio >= 1.5) state = "ELEVATED";

  const direction: Dir = longUsd === shortUsd ? "neutral" : longUsd > shortUsd ? "bullish" : "bearish";
  // Semántica §68: longs liquidados => presión vendedora (bajista); shorts liquidados => alcista
  return { state, ratio, direction, longUsd, shortUsd, count, current };
}

/* ============================ Structure + MTF (§11/§12/§38) ============================ */

interface StructureOut {
  rows: MtfRow[];
  alignment: "ALIGNED_BULLISH" | "ALIGNED_BEARISH" | "MIXED" | "SEVERE_CONFLICT";
  contradictionIndex: number;
  trendStrength: number;
  range: boolean;
  swingHigh: number | null;
  swingLow: number | null;
}

function tfDirection(candles: Candle[]): { dir: Dir; strength: number } {
  if (candles.length < 30) return { dir: "neutral", strength: 0 };
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const k = 3;
  const fractal = (arr: number[], cmp: (a: number, b: number) => boolean) => {
    const out: number[] = [];
    for (let i = k; i < arr.length - k; i++) {
      let ok = true;
      for (let j = 1; j <= k; j++) {
        if (!cmp(arr[i], arr[i - j]) || !cmp(arr[i], arr[i + j])) { ok = false; break; }
      }
      if (ok) out.push(arr[i]);
    }
    return out;
  };
  const hh = fractal(highs, (a, b) => a > b);
  const ll = fractal(lows, (a, b) => a < b);
  const hhUp = hh.length >= 2 && hh[hh.length - 1] > hh[hh.length - 2];
  const llUp = ll.length >= 2 && ll[ll.length - 1] > ll[ll.length - 2];
  const ema = (arr: number[], p: number) => {
    const kk = 2 / (p + 1);
    let e = arr[0];
    for (const v of arr) e = v * kk + e * (1 - kk);
    return e;
  };
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const last = closes[closes.length - 1];
  let score = 0;
  if (hhUp) score += 1;
  if (llUp) score += 1;
  if (!hhUp && hh.length >= 2) score -= 1;
  if (!llUp && ll.length >= 2) score -= 1;
  if (last > e20) score += 0.7; else score -= 0.7;
  if (e20 > e50) score += 0.6; else score -= 0.6;
  const strength = clamp01(Math.abs(score) / 3.3);
  return { dir: score > 0.4 ? "bullish" : score < -0.4 ? "bearish" : "neutral", strength };
}

function analyzeStructure(input: EngineInput): StructureOut {
  const tfs: Timeframe[] = ["15m", "1h", "4h", "1D", "1W"];
  const weights: Record<Timeframe, number> = { "15m": 1, "1h": 1.2, "4h": 1.5, "1D": 1.8, "1W": 1.3 };
  const rows: MtfRow[] = [];
  let bullW = 0; let bearW = 0; let totW = 0;
  for (const tf of tfs) {
    const candles = input.klines[tf];
    if (!candles || candles.length < 30) {
      rows.push({ tf, direction: "neutral", strength: 0, quality: clamp01((candles?.length ?? 0) / 60) });
      continue;
    }
    const { dir, strength } = tfDirection(candles);
    rows.push({ tf, direction: dir, strength, quality: clamp01(candles.length / 60) });
    const w = weights[tf] * clamp01(candles.length / 60);
    totW += w;
    if (dir === "bullish") bullW += w * strength;
    if (dir === "bearish") bearW += w * strength;
  }
  const net = totW > 0 ? (bullW - bearW) / totW : 0;
  const participation = totW > 0 ? (bullW + bearW) / totW : 0;
  let alignment: StructureOut["alignment"] = "MIXED";
  if (net > 0.45) alignment = "ALIGNED_BULLISH";
  else if (net < -0.45) alignment = "ALIGNED_BEARISH";
  else if (participation > 0.55) alignment = "SEVERE_CONFLICT";
  // Índice de contradicción (§38): 1 = conflicto total, 0 = armonía total
  const contradictionIndex = totW > 0 ? clamp01(1 - Math.abs(net) / Math.max(0.001, participation)) * participation : 0.5;

  // swings recientes (1h) para target/invalidation
  const h1 = input.klines["1h"] ?? [];
  let swingHigh: number | null = null; let swingLow: number | null = null;
  if (h1.length > 24) {
    const recent = h1.slice(-48);
    swingHigh = Math.max(...recent.map((c) => c.high));
    swingLow = Math.min(...recent.map((c) => c.low));
  }
  // rango en 1h (§12)
  let range = false;
  if (h1.length >= 40) {
    const last40 = h1.slice(-40);
    const hi = Math.max(...last40.map((c) => c.high));
    const lo = Math.min(...last40.map((c) => c.low));
    range = safeRatio(hi - lo, (hi + lo) / 2) < 0.028;
  }
  return { rows, alignment, contradictionIndex, trendStrength: clamp01(Math.abs(net)), range, swingHigh, swingLow };
}

/* ============================ Clústeres estimados (§29/§70) ============================ */

function buildClusters(input: EngineInput): { clusters: Cluster[]; computed: boolean } {
  const p = input.price;
  if (!isFiniteNumber(p) || p <= 0) return { clusters: [], computed: false };
  const oiUsd = (input.oiHistory[input.oiHistory.length - 1]?.oi ?? 0) * p;
  if (oiUsd <= 0) return { clusters: [], computed: false };

  // Bandas de apalancamiento. Sin MMR fijo global (§29): si hay brackets reales
  // de Binance se usan sus tramos; si no, aproximación 1/L claramente estimada.
  const bands = input.brackets.length >= 4
    ? input.brackets.slice(0, 6).map((b) => ({ dist: clamp(b.maintenanceMarginRate, 0.004, 0.2), mmr: b.maintenanceMarginRate }))
    : [10, 25, 50, 100].map((L) => ({ dist: 1 / L, mmr: 0.004 }));
  const shares = [0.16, 0.2, 0.24, 0.18, 0.12, 0.1];

  const clusters: Cluster[] = [];
  bands.forEach((band, i) => {
    const notional = oiUsd * (shares[i] ?? 0.1) * 0.42;
    const above = p * (1 + band.dist);
    const below = p * (1 - band.dist);
    clusters.push({
      price: above, estimatedUsd: notional, side: "short",
      distancePct: band.dist * 100, model: "LIQRADAR", truth: "ESTIMATED", freshnessMs: 0,
    });
    clusters.push({
      price: below, estimatedUsd: notional * 0.92, side: "long",
      distancePct: -band.dist * 100, model: "LIQRADAR", truth: "ESTIMATED", freshnessMs: 0,
    });
  });
  return { clusters: clusters.sort((a, b) => a.price - b.price), computed: true };
}

/* ============================ Régimen (§36) ============================ */

function detectRegime(input: EngineInput, ctx: Ctx): { state: RegimeState; strength: number } {
  const burst = ctx.burst;
  const priceUp = input.changePct > 0.15;
  const priceDown = input.changePct < -0.15;

  if ((burst.state === "CASCADE" || burst.state === "EXTREME_CASCADE") && burst.direction === "bullish" && priceUp)
    return { state: "SHORT_SQUEEZE", strength: clamp01(0.6 + burst.ratio / 20) };
  if ((burst.state === "CASCADE" || burst.state === "EXTREME_CASCADE") && burst.direction === "bearish" && priceDown)
    return { state: "LONG_SQUEEZE", strength: clamp01(0.6 + burst.ratio / 20) };
  if (ctx.oi.regime === "LONG_BUILD" && ctx.oi.feature.strength > 0.4)
    return { state: "LONG_BUILD", strength: ctx.oi.feature.strength };
  if (ctx.oi.regime === "SHORT_BUILD" && ctx.oi.feature.strength > 0.4)
    return { state: "SHORT_BUILD", strength: ctx.oi.feature.strength };
  if (ctx.structure.alignment === "ALIGNED_BULLISH" && ctx.structure.trendStrength > 0.45)
    return { state: "TREND_UP", strength: ctx.structure.trendStrength };
  if (ctx.structure.alignment === "ALIGNED_BEARISH" && ctx.structure.trendStrength > 0.45)
    return { state: "TREND_DOWN", strength: ctx.structure.trendStrength };
  if (ctx.structure.range) {
    const vol = stdev(input.futTrades.slice(-300).map((t) => t.price));
    const tight = safeRatio(vol, input.price) < 0.0008;
    if (tight) return { state: "COMPRESSION", strength: 0.5 };
    return { state: ctx.futFeat.direction === "bullish" ? "ACCUMULATION" : ctx.futFeat.direction === "bearish" ? "DISTRIBUTION" : "NEUTRAL", strength: 0.45 };
  }
  if (burst.state === "BURST" || burst.state === "CASCADE")
    return { state: "EXPANSION", strength: 0.55 };
  return { state: "NEUTRAL", strength: 0.2 };
}

/* ============================ Escenario (§37) ============================ */

function detectScenario(input: EngineInput, ctx: Ctx, regime: RegimeState):
  { state: ScenarioState; strength: number; evidence: string[]; contradiction: string[]; invalidation: string; horizon: string } {
  const ev: string[] = [];
  const co: string[] = [];
  let state: ScenarioState = "NO_TRADE";
  let strength = 0;
  let invalidation = "sin datos de estructura suficientes";
  let horizon = "—";

  const swingTxt = ctx.structure.swingLow && ctx.structure.swingHigh
    ? `swing 1h ${ctx.structure.swingLow.toFixed(0)}–${ctx.structure.swingHigh.toFixed(0)}`
    : "estructura 1h";

  if (regime === "SHORT_SQUEEZE") {
    state = "SHORT_SQUEEZE"; strength = 0.7 + clamp01(ctx.burst.ratio / 15) * 0.3;
    ev.push(`Shorts liquidados ${fmtM(ctx.burst.shortUsd)} en 5 min (ratio ${ctx.burst.ratio.toFixed(1)}×)`);
    ev.push("Cierre forzado de shorts = presión compradora (§68)");
    if (ctx.futFeat.direction === "bullish") ev.push("CVD futuros positivo confirma compras");
    invalidation = "pérdida del último mínimo del impulso de squeeze"; horizon = "15m–1h";
  } else if (regime === "LONG_SQUEEZE") {
    state = "LONG_SQUEEZE"; strength = 0.7 + clamp01(ctx.burst.ratio / 15) * 0.3;
    ev.push(`Longs liquidados ${fmtM(ctx.burst.longUsd)} en 5 min (ratio ${ctx.burst.ratio.toFixed(1)}×)`);
    ev.push("Cierre forzado de longs = presión vendedora (§68)");
    invalidation = "recuperación del último máximo del impulso"; horizon = "15m–1h";
  } else if (ctx.burst.state === "CASCADE" || ctx.burst.state === "EXTREME_CASCADE") {
    state = "LIQUIDATION_CASCADE"; strength = 0.65;
    ev.push(`Cascada ${ctx.burst.direction === "bullish" ? "de shorts" : "de longs"}: ${fmtM(ctx.burst.current)} en 5 min`);
    invalidation = "fin del flujo de liquidaciones (ventana 5 min normalizada)"; horizon = "5m–15m";
  } else if (ctx.structure.alignment === "ALIGNED_BULLISH" && (ctx.oi.regime === "LONG_BUILD" || ctx.oi.regime === "SHORT_UNWIND")) {
    state = "TREND_CONTINUATION"; strength = 0.55 + ctx.structure.trendStrength * 0.3;
    ev.push("Horizontes independientes alineados al alza (§11)");
    ev.push(`OI ${ctx.oi.regime === "LONG_BUILD" ? "en expansión (LONG_BUILD)" : "cayendo con precio arriba (SHORT_UNWIND)"}`);
    invalidation = `cierre 1h bajo último HL (${swingTxt})`; horizon = "1h–4h";
  } else if (ctx.structure.alignment === "ALIGNED_BEARISH" && (ctx.oi.regime === "SHORT_BUILD" || ctx.oi.regime === "LONG_UNWIND")) {
    state = "TREND_CONTINUATION"; strength = 0.55 + ctx.structure.trendStrength * 0.3;
    ev.push("Horizontes independientes alineados a la baja (§11)");
    ev.push(`OI ${ctx.oi.regime === "SHORT_BUILD" ? "en expansión (SHORT_BUILD)" : "cayendo con precio abajo (LONG_UNWIND)"}`);
    invalidation = `cierre 1h sobre último LH (${swingTxt})`; horizon = "1h–4h";
  } else if (ctx.structure.range) {
    state = "MEAN_REVERSION"; strength = 0.45;
    ev.push("Rango 1h confirmado (amplitud < 2,8 %)");
    if (ctx.book.absorption.state !== "NONE") ev.push(`Absorción ${ctx.book.absorption.state === "BUY_ABSORPTION" ? "compradora" : "vendedora"} en el rango`);
    co.push("los extremos del rango pueden romperse sin aviso");
    invalidation = "cierre 1h fuera del rango"; horizon = "15m–1h";
  } else if (ctx.structure.alignment === "SEVERE_CONFLICT") {
    state = "NO_TRADE"; strength = 0.3;
    co.push("conflicto severo entre temporalidades (§38)");
    invalidation = "—"; horizon = "—";
  } else {
    state = "RANGE"; strength = 0.3;
    co.push("sin confluencia dominante");
    invalidation = "—"; horizon = "—";
  }
  return { state, strength, evidence: ev, contradiction: co, invalidation, horizon };
}

const fmtM = (v: number) => `$${(v / 1e6).toFixed(1)}M`;

/* ============================ Bloques + señal (§40-§45/§71) ============================ */

export interface Ctx {
  spotFeat: FeatureResult; futFeat: FeatureResult; alignment: FeatureResult;
  divergences: string[]; hasSpot: boolean; hasFut: boolean;
  spotCvdUsd: number; futCvdUsd: number;
  oi: ReturnType<typeof analyzeOi>;
  funding: ReturnType<typeof analyzeFunding>;
  positioning: ReturnType<typeof analyzePositioning>;
  taker: ReturnType<typeof analyzeTaker>;
  book: ReturnType<typeof analyzeBook>;
  burst: ReturnType<typeof analyzeBurst>;
  structure: StructureOut;
  clusters: Cluster[];
}

const BASE_WEIGHTS: Record<string, number> = {
  PRICE_STRUCTURE: 1.4, OI: 1.2, FUNDING: 0.7, POSITIONING: 0.8, TAKER: 0.9,
  SPOT_CVD: 1.0, FUTURES_CVD: 1.1, ORDER_BOOK: 0.9, ABSORPTION: 0.8,
  LIQUIDATION_FLOW: 1.1, CLUSTERS: 0.6, OPTIONS: 0.4, CROSS_EXCHANGE: 0.5,
};

// Pesos dinámicos por escenario (§44)
const SCENARIO_MULT: Record<string, Partial<Record<string, number>>> = {
  SHORT_SQUEEZE: { LIQUIDATION_FLOW: 1.8, OI: 1.5, FUTURES_CVD: 1.4, TAKER: 1.3, ORDER_BOOK: 1.2, PRICE_STRUCTURE: 0.8 },
  LONG_SQUEEZE: { LIQUIDATION_FLOW: 1.8, OI: 1.5, FUTURES_CVD: 1.4, TAKER: 1.3, ORDER_BOOK: 1.2, PRICE_STRUCTURE: 0.8 },
  LIQUIDATION_CASCADE: { LIQUIDATION_FLOW: 1.7, TAKER: 1.3, FUTURES_CVD: 1.3, CLUSTERS: 1.3 },
  RANGE: { PRICE_STRUCTURE: 1.5, ORDER_BOOK: 1.4, ABSORPTION: 1.5, CLUSTERS: 0.8, LIQUIDATION_FLOW: 0.7 },
  MEAN_REVERSION: { ORDER_BOOK: 1.4, ABSORPTION: 1.4, PRICE_STRUCTURE: 1.3, LIQUIDATION_FLOW: 0.7 },
  TREND_CONTINUATION: { PRICE_STRUCTURE: 1.4, OI: 1.4, SPOT_CVD: 1.2 },
};

function truthFactor(t: DataTruth): number {
  return t === "REAL" ? 1 : t === "ESTIMATED" ? 0.55 : t === "FALLBACK" ? 0.35 : t === "DEMO" ? 0.8 : 0;
}

export function runEngines(input: EngineInput): {
  ctx: Ctx;
  regime: { state: RegimeState; strength: number };
  scenario: ReturnType<typeof detectScenario>;
  signal: SignalResult;
} {
  const spotView = analyzeCvd(input);
  const oi = analyzeOi(input);
  const funding = analyzeFunding(input);
  const positioning = analyzePositioning(input);
  const taker = analyzeTaker(input);
  const book = analyzeBook(input);
  const burst = analyzeBurst(input);
  const structure = analyzeStructure(input);
  const { clusters } = buildClusters(input);

  const ctx: Ctx = {
    spotFeat: spotView.spotFeat, futFeat: spotView.futFeat, alignment: spotView.alignment,
    divergences: spotView.divergences, hasSpot: spotView.hasSpot, hasFut: spotView.hasFut,
    spotCvdUsd: spotView.spotCvdUsd, futCvdUsd: spotView.futCvdUsd,
    oi, funding, positioning, taker, book, burst, structure, clusters,
  };

  const regime = detectRegime(input, ctx);
  const scenario = detectScenario(input, ctx, regime.state);
  const mult = SCENARIO_MULT[scenario.state] ?? {};

  /* --- construir bloques (§43): un voto por bloque, nunca por feature --- */
  const dirScore = (d: Dir, s: number) => (d === "bullish" ? s : d === "bearish" ? -s : 0);

  const blocks: BlockScore[] = [
    {
      block: "PRICE_STRUCTURE", score: dirScore(structure.alignment === "ALIGNED_BULLISH" ? "bullish" : structure.alignment === "ALIGNED_BEARISH" ? "bearish" : "neutral", structure.trendStrength),
      weight: 0, confidence: structure.trendStrength, truth: input.truth,
      evidence: [`MTF: ${structure.alignment.replace(/_/g, " ")}`], against: structure.alignment === "SEVERE_CONFLICT" ? ["conflicto severo entre temporalidades"] : [],
    },
    {
      block: "OI", score: oi.feature.value === 0 ? 0 : clamp(oi.regime === "LONG_BUILD" ? 0.7 : oi.regime === "SHORT_BUILD" ? -0.7 : oi.regime === "SHORT_UNWIND" ? 0.3 : oi.regime === "LONG_UNWIND" ? -0.3 : 0, -1, 1),
      weight: 0, confidence: oi.feature.confidence, truth: oi.feature.provenance.truth,
      evidence: [`OI ${oi.changePct >= 0 ? "+" : ""}${oi.changePct.toFixed(2)}% 15m → ${oi.regime}`], against: [],
    },
    {
      block: "FUNDING", score: clamp(-funding.z * 0.35, -1, 1),
      weight: 0, confidence: funding.enough ? 0.8 : 0.1, truth: funding.feature.provenance.truth,
      evidence: [`funding p${Math.round(funding.percentile * 100)} → ${funding.state}`],
      against: funding.state === "EXTREME_LONGING" ? ["funding extremo long: combustible de long squeeze"] : funding.state === "EXTREME_SHORTING" ? ["funding extremo short: combustible de short squeeze"] : [],
    },
    {
      block: "POSITIONING", score: clamp(positioning.z * 0.4, -1, 1),
      weight: 0, confidence: positioning.enough ? 0.75 : 0.1, truth: positioning.feature.provenance.truth,
      evidence: [`top traders ratio ${positioning.last.toFixed(2)} (z ${positioning.z.toFixed(1)}, persistencia ${positioning.persistence})`], against: [],
    },
    {
      block: "TAKER", score: taker.feature.direction === "neutral" ? 0 : dirScore(taker.feature.direction, clamp01(Math.abs(taker.imbalance) * 5)),
      weight: 0, confidence: taker.enough ? 0.75 : 0.1, truth: taker.feature.provenance.truth,
      evidence: [`taker imbalance ${(taker.imbalance * 100).toFixed(1)}% p${Math.round(taker.percentile * 100)}`], against: [],
    },
    {
      block: "SPOT_CVD", score: dirScore(spotView.spotFeat.direction, spotView.spotFeat.strength),
      weight: 0, confidence: spotView.spotFeat.confidence, truth: spotView.spotFeat.provenance.truth,
      evidence: [`Spot CVD ${fmtM(spotView.spotCvdUsd)} (5m)`], against: [],
    },
    {
      block: "FUTURES_CVD", score: dirScore(spotView.futFeat.direction, spotView.futFeat.strength),
      weight: 0, confidence: spotView.futFeat.confidence, truth: spotView.futFeat.provenance.truth,
      evidence: [`Futures CVD ${fmtM(spotView.futCvdUsd)} (5m)`], against: [],
    },
    {
      block: "ORDER_BOOK", score: clamp(book.imbalance * 1.6, -1, 1),
      weight: 0, confidence: book.has ? 0.7 : 0.05, truth: book.feature.provenance.truth,
      evidence: [`desequilibrio L2 ${(book.imbalance * 100).toFixed(1)}% bid`], against: book.spoof.level === "HIGH" ? ["SPOOF_RISK alto: liquidez poco fiable"] : [],
    },
    {
      block: "ABSORPTION", score: book.absorption.state === "BUY_ABSORPTION" ? book.absorption.strength : book.absorption.state === "SELL_ABSORPTION" ? -book.absorption.strength : 0,
      weight: 0, confidence: book.absorption.state === "NONE" ? 0.1 : 0.6, truth: "ESTIMATED",
      evidence: book.absorption.state === "NONE" ? [] : [`${book.absorption.state} (evento estimado)`, ...book.absorption.evidence], against: [],
    },
    {
      // §68: shorts liquidados => alcista; longs liquidados => bajista
      block: "LIQUIDATION_FLOW", score: burst.direction === "neutral" ? 0 : dirScore(burst.direction, clamp01(0.3 + burst.ratio / 8)),
      weight: 0, confidence: burst.count > 0 ? 0.85 : 0.2, truth: input.truth,
      evidence: [`burst ${burst.state} · longs ${fmtM(burst.longUsd)} / shorts ${fmtM(burst.shortUsd)} (5m)`], against: [],
    },
    {
      block: "CLUSTERS", score: nearestClusterScore(input.price, clusters),
      weight: 0, confidence: clusters.length ? 0.5 : 0.05, truth: "ESTIMATED",
      evidence: clusters.length ? [`clúster estimado más cercano a ${((nearestCluster(input.price, clusters)?.distancePct) ?? 0).toFixed(2)}%`] : [],
      against: ["clústeres propios: estimación, no liquidaciones reales (§70)"],
    },
    {
      block: "OPTIONS", score: input.options?.putCallRatio ? clamp((1 - input.options.putCallRatio) * 0.8, -1, 1) * -1 : 0,
      weight: 0, confidence: input.options?.truth === "REAL" ? 0.5 : 0.05, truth: input.options?.truth ?? "UNAVAILABLE",
      evidence: input.options?.putCallRatio ? [`P/C ratio ${input.options.putCallRatio.toFixed(2)}`] : [], against: [],
    },
    {
      block: "CROSS_EXCHANGE", score: crossScore(input.cross),
      weight: 0, confidence: input.cross.some((c) => c.truth === "REAL") ? 0.6 : 0.05,
      truth: input.cross.some((c) => c.truth === "REAL") ? "REAL" : "UNAVAILABLE",
      evidence: input.cross.filter((c) => c.truth === "REAL").map((c) => `${c.exchange}: OI ${c.oiUsd ? fmtM(c.oiUsd) : "—"} · funding ${c.funding ? (c.funding * 100).toFixed(4) + "%" : "—"}`),
      against: [],
    },
  ];

  // pesos dinámicos
  for (const b of blocks) b.weight = (BASE_WEIGHTS[b.block] ?? 0.5) * (mult[b.block] ?? 1);

  /* --- calidad de datos + entradas críticas (§71) --- */
  const critical: [string, boolean, string][] = [
    ["precio", isFiniteNumber(input.price) && input.now - input.priceTs < 15_000, "precio ausente o con más de 15 s de retraso"],
    ["Open Interest", oi.enough, "serie de OI insuficiente"],
    ["CVD", spotView.hasFut, "flujo de trades futuros insuficiente para CVD"],
    ["liquidaciones", input.healthLive.includes("bn_liq") || burst.count > 0, "stream forceOrder sin conexión"],
  ];
  const noTradeReasons: string[] = [];
  for (const [, ok, reason] of critical) if (!ok) noTradeReasons.push(reason);

  const dataQuality = clamp01(
    (critical.filter(([, ok]) => ok).length / critical.length) * 0.7 +
    (input.healthLive.length / Math.max(1, input.healthLive.length + input.healthDegraded.length + input.healthUnavailable.length)) * 0.3
  );

  /* --- score agregado + confianza calibrada (§42/§45) --- */
  let num = 0; let den = 0;
  for (const b of blocks) {
    const w = b.weight * b.confidence * truthFactor(b.truth);
    num += b.score * w;
    den += w;
  }
  const score = den > 0 ? num / den : 0;

  const contradictions: string[] = [...spotView.divergences, ...scenario.contradiction];
  if (structure.alignment === "SEVERE_CONFLICT") contradictions.push("15m/1h contra 4h/1D/1W en direcciones opuestas");
  if (funding.state === "EXTREME_LONGING" && score > 0) contradictions.push("funding extremo long en contra de la dirección");
  if (funding.state === "EXTREME_SHORTING" && score < 0) contradictions.push("funding extremo short en contra de la dirección");

  let confidence = 0.5 + 0.5 * Math.tanh(score * 2.1);
  confidence *= 1 - 0.45 * structure.contradictionIndex;          // §38
  confidence *= 0.72 + 0.28 * dataQuality;                          // §71
  confidence = clamp01(confidence + input.calibrationOffset);       // §45
  confidence = clamp(confidence, 0.05, 0.97);

  let direction: SignalResult["direction"] = score > 0.12 ? "LONG" : score < -0.12 ? "SHORT" : "NO_TRADE";
  if (noTradeReasons.length > 0) direction = "NO_TRADE";            // §39: dato crítico faltante
  else if (structure.contradictionIndex > 0.72) { direction = "NO_TRADE"; noTradeReasons.push("contradicción entre horizontes demasiado alta"); }
  else if (confidence < 0.62 && direction !== "NO_TRADE") { direction = "NO_TRADE"; noTradeReasons.push(`confianza ${(confidence * 100).toFixed(0)}% bajo umbral 62%`); }
  if (direction === "NO_TRADE" && noTradeReasons.length === 0) noTradeReasons.push("evidencia insuficiente para tomar lado");

  /* --- target / invalidation desde estructura + clústeres (no inventados) --- */
  let target: number | undefined;
  let invalidation: number | undefined;
  const p = input.price;
  if (isFiniteNumber(p) && p > 0 && direction !== "NO_TRADE") {
    if (direction === "LONG") {
      const upside = clusters.filter((c) => c.side === "short" && c.price > p).sort((a, b) => a.price - b.price)[0];
      target = upside?.price ?? (structure.swingHigh && structure.swingHigh > p ? structure.swingHigh : p * 1.01);
      invalidation = structure.swingLow && structure.swingLow < p ? structure.swingLow * 0.999 : p * 0.992;
    } else {
      const downside = clusters.filter((c) => c.side === "long" && c.price < p).sort((a, b) => b.price - a.price)[0];
      target = downside?.price ?? (structure.swingLow && structure.swingLow < p ? structure.swingLow : p * 0.99);
      invalidation = structure.swingHigh && structure.swingHigh > p ? structure.swingHigh * 1.001 : p * 1.008;
    }
  }

  const evidence: string[] = [];
  for (const b of blocks) {
    if (Math.abs(b.score) > 0.15 && b.confidence > 0.3) {
      const aligns = (b.score > 0) === (direction === "LONG");
      if (aligns) evidence.push(...b.evidence);
    }
  }

  const signal: SignalResult = {
    id: uid(), ts: input.now, price: p, direction,
    confidence: direction === "NO_TRADE" ? clamp01(confidence) : confidence,
    regime: regime.state, scenario: scenario.state,
    target, invalidation,
    evidence: evidence.length ? evidence : ["sin evidencia dominante"],
    contradictions, dataQuality, blocks, noTradeReasons, demo: input.demo,
  };

  return { ctx, regime, scenario, signal };
}

function nearestCluster(price: number, clusters: Cluster[]): Cluster | null {
  if (!clusters.length || !isFiniteNumber(price)) return null;
  return clusters.reduce((best, c) =>
    Math.abs(c.distancePct) < Math.abs(best.distancePct) ? c : best, clusters[0]);
}

function nearestClusterScore(price: number, clusters: Cluster[]): number {
  const c = nearestCluster(price, clusters);
  if (!c || !isFiniteNumber(price)) return 0;
  const dist = Math.abs(c.distancePct);
  const proximity = clamp01(1 - dist / 4); // más cerca = más relevante
  // clúster de shorts arriba => combustible alcista; de longs abajo => bajista
  return (c.side === "short" ? 1 : -1) * proximity * 0.8;
}

function crossScore(cross: CrossExchange[]): number {
  const fs = cross.map((c) => c.funding).filter((x): x is number => isFiniteNumber(x));
  if (!fs.length) return 0;
  const avg = mean(fs);
  return clamp(-avg * 400, -0.6, 0.6); // funding medio extremo => inclinación contraria, peso bajo
}
