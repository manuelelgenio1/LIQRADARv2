/* ============================================================
 * LIQRADAR — Store / orquestación (spec §59/§65/§48/§50)
 * - Modo REAL por defecto: cero simulación de mercado (§65).
 * - Modo DEMO: etiquetado, aislado, nunca alimenta métricas REAL.
 * - Ring buffers + CVD incremental + UI throttling (§59).
 * - Journal de señales con outcome posterior (§48) en localStorage
 *   (sustituto documentado de SQLite en este entorno estático).
 * ============================================================ */

import { useEffect, useRef, useState } from "react";
import type {
  AlertItem, Book, Candle, CrossExchange, JournalEntry, LiqEvent, Mode,
  OptionsSummary, Outcome, ReplayFrame, SignalResult, SourceHealth, Timeframe, Trade,
} from "../types";
import { startBinance, startCrossExchange, startOptions, type Callbacks, type StopFn } from "./connectors";
import { runEngines, type EngineInput } from "./engines";
import { isFiniteNumber, safeNumber, uid } from "./safe";

export type EngineOutput = ReturnType<typeof runEngines>;

export interface RadarState {
  mode: Mode;
  now: number;
  startedAt: number;
  price: number;
  priceTs: number;
  tickDir: "up" | "down" | "none";
  changePct: number;
  high24: number;
  low24: number;
  quoteVolume: number;
  fundingRate: number;
  nextFundingTime: number;
  health: SourceHealth[];
  liqs: LiqEvent[];
  engine: EngineOutput | null;
  journal: JournalEntry[];
  alerts: AlertItem[];
  frames: ReplayFrame[];
  cross: CrossExchange[];
  options: OptionsSummary | null;
}

const HEALTH_ORDER: [string, string][] = [
  ["bn_ws", "Binance WebSocket"],
  ["bn_mark", "Precio de marca"],
  ["bn_l2", "Order book L2 (depth)"],
  ["bn_fut_trades", "Futures aggTrade (CVD)"],
  ["bn_spot_trades", "Spot aggTrade (CVD)"],
  ["bn_liq", "Liquidaciones forceOrder"],
  ["bn_oi", "Open Interest"],
  ["bn_funding", "Funding (markPrice)"],
  ["bn_funding_hist", "Funding histórico"],
  ["bn_ticker", "Ticker 24h"],
  ["bn_klines", "Klines MTF"],
  ["bn_ratios", "Ratios posicionamiento"],
  ["bn_brackets", "Leverage brackets"],
  ["okx", "OKX (cross-exchange)"],
  ["bybit", "Bybit (cross-exchange)"],
  ["deribit", "Deribit Opciones"],
  ["coinglass", "CoinGlass"],
];

const HORIZONS: { label: string; ms: number }[] = [
  { label: "+5m", ms: 5 * 60_000 },
  { label: "+15m", ms: 15 * 60_000 },
  { label: "+30m", ms: 30 * 60_000 },
  { label: "+1h", ms: 60 * 60_000 },
  { label: "+4h", ms: 4 * 3_600_000 },
];

const JOURNAL_KEY = "liqradar.journal.v1";

function cap<T>(arr: T[], n: number) { if (arr.length > n) arr.splice(0, arr.length - n); }

function loadJournal(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch { return []; }
}

export function useRadar() {
  const [mode, setModeState] = useState<Mode>("REAL"); // §65: default REAL
  const [snap, setSnap] = useState<RadarState | null>(null);

  const modeRef = useRef<Mode>("REAL");
  const startedAtRef = useRef(Date.now());

  /* ---------------- ring buffers (refs, §59) ---------------- */
  const priceRef = useRef(0);
  const priceTsRef = useRef(0);
  const tickDirRef = useRef<"up" | "down" | "none">("none");
  const changePctRef = useRef(NaN);
  const high24Ref = useRef(NaN);
  const low24Ref = useRef(NaN);
  const qvRef = useRef(NaN);
  const fundingRef = useRef(NaN);
  const nextFundingRef = useRef(0);
  const spotTradesRef = useRef<Trade[]>([]);
  const futTradesRef = useRef<Trade[]>([]);
  const liqsRef = useRef<LiqEvent[]>([]);
  const bookRef = useRef<Book | null>(null);
  const bookHistRef = useRef<Book[]>([]);
  const oiHistRef = useRef<{ ts: number; oi: number }[]>([]);
  const fundingHistRef = useRef<number[]>([]);
  const klinesRef = useRef<Partial<Record<Timeframe, Candle[]>>>({});
  const topRef = useRef<{ ts: number; ratio: number }[]>([]);
  const takerRef = useRef<{ ts: number; ratio: number }[]>([]);
  const bracketsRef = useRef<{ bracket: number; maintenanceMarginRate: number }[]>([]);
  const crossRef = useRef<CrossExchange[]>([]);
  const optionsRef = useRef<OptionsSummary | null>(null);
  const healthRef = useRef<Record<string, SourceHealth>>({});
  const pricePathRef = useRef<{ ts: number; price: number }[]>([]);
  const engineRef = useRef<EngineOutput | null>(null);
  const journalRef = useRef<JournalEntry[]>(loadJournal());
  const alertsRef = useRef<AlertItem[]>([]);
  const framesRef = useRef<ReplayFrame[]>([]);
  const lastEntryTsRef = useRef(0);
  const lastBumpRef = useRef(0);
  const prevSignalRef = useRef<SignalResult | null>(null);
  const lastPathPushRef = useRef(0);

  /* ---------------- health ---------------- */
  const report = (id: string, patch: Partial<SourceHealth>) => {
    const base = healthRef.current[id] ?? {
      id, label: HEALTH_ORDER.find(([x]) => x === id)?.[1] ?? id,
      status: "UNAVAILABLE" as const, records: 0, reconnects: 0,
    };
    healthRef.current[id] = { ...base, ...patch, id, label: base.label };
  };

  const pushAlert = (type: string, severity: AlertItem["severity"], msg: string) => {
    alertsRef.current.unshift({ id: uid(), ts: Date.now(), type, severity, msg });
    cap(alertsRef.current, 40);
  };

  /* ---------------- callbacks de conectores ---------------- */
  const cb: Callbacks = {
    report,
    onMark: (m) => {
      if (priceRef.current > 0) {
        tickDirRef.current = m.mark > priceRef.current ? "up" : m.mark < priceRef.current ? "down" : tickDirRef.current;
      }
      priceRef.current = m.mark;
      priceTsRef.current = Date.now();
      fundingRef.current = m.fundingRate;
      nextFundingRef.current = m.nextFundingTime;
      bump(350);
    },
    onTicker: (t) => { changePctRef.current = t.changePct; high24Ref.current = t.high; low24Ref.current = t.low; qvRef.current = t.quoteVolume; },
    onOi: (oi) => { oiHistRef.current.push({ ts: Date.now(), oi }); cap(oiHistRef.current, 240); },
    onTrade: (kind, t) => {
      if (kind === "spot") { spotTradesRef.current.push(t); cap(spotTradesRef.current, 6000); }
      else {
        futTradesRef.current.push(t); cap(futTradesRef.current, 6000);
        if (priceRef.current === 0) { priceRef.current = t.price; priceTsRef.current = Date.now(); }
        tickDirRef.current = t.price > priceRef.current ? "up" : t.price < priceRef.current ? "down" : tickDirRef.current;
        priceRef.current = t.price; priceTsRef.current = Date.now();
        bump(400);
      }
    },
    onLiq: (ev) => { liqsRef.current.push(ev); cap(liqsRef.current, 1500); },
    onBook: (b) => {
      bookRef.current = b;
      const h = bookHistRef.current;
      if (!h.length || b.ts - h[h.length - 1].ts > 1500) { h.push(b); cap(h, 120); }
    },
    onKlines: (tf, candles) => { klinesRef.current[tf] = candles; },
    onFundingHistory: (rates) => { fundingHistRef.current = rates; },
    onRatio: (kind, series) => {
      if (kind === "top") topRef.current = series;
      else if (kind === "taker") takerRef.current = series;
    },
    onBrackets: (b) => { bracketsRef.current = b; },
    onCross: (cx) => {
      const arr = crossRef.current.filter((c) => c.exchange !== cx.exchange);
      arr.push(cx);
      crossRef.current = arr;
    },
    onOptions: (o) => { optionsRef.current = o; },
  };

  const bump = (minInterval: number) => {
    const now = Date.now();
    if (now - lastBumpRef.current < minInterval) return;
    lastBumpRef.current = now;
    setSnap(buildSnap());
  };

  /* ---------------- snapshot ---------------- */
  const buildSnap = (): RadarState => {
    const now = Date.now();
    const health: SourceHealth[] = HEALTH_ORDER.map(([id, label]) => {
      const h = healthRef.current[id] ?? { id, label, status: "UNAVAILABLE" as const, records: 0, reconnects: 0 };
      const ageMs = h.lastUpdate ? now - h.lastUpdate : undefined;
      const degradedByAge = h.status === "LIVE" && ageMs !== undefined && ageMs > 45_000;
      return { ...h, label, ageMs, status: degradedByAge ? "DEGRADED" : h.status };
    });
    return {
      mode: modeRef.current, now, startedAt: startedAtRef.current,
      price: priceRef.current, priceTs: priceTsRef.current, tickDir: tickDirRef.current,
      changePct: changePctRef.current, high24: high24Ref.current, low24: low24Ref.current,
      quoteVolume: qvRef.current, fundingRate: fundingRef.current,
      nextFundingTime: nextFundingRef.current,
      health, liqs: [...liqsRef.current].reverse().slice(0, 60),
      engine: engineRef.current,
      journal: [...journalRef.current].reverse(),
      alerts: [...alertsRef.current],
      frames: [...framesRef.current],
      cross: [...crossRef.current],
      options: optionsRef.current,
    };
  };

  /* ---------------- calibración desde el journal (§45) ---------------- */
  const calibrationOffset = (): number => {
    const resolved = journalRef.current.filter((e) => !e.demo && e.outcomes["+15m"]);
    if (resolved.length < 10) return 0;
    let predicted = 0; let actual = 0;
    for (const e of resolved) {
      const o = e.outcomes["+15m"];
      if (!o || o.noData || o.ambiguous) continue;
      predicted += e.confidence;
      actual += o.hitTarget && !o.hitInvalidation ? 1 : 0;
    }
    if (predicted === 0) return 0;
    const diff = actual / resolved.length - predicted / resolved.length;
    return Math.max(-0.05, Math.min(0.05, diff * 0.5));
  };

  /* ---------------- journal + outcomes (§48) ---------------- */
  const processJournal = (signal: SignalResult, now: number) => {
    // nueva entrada: cambio de dirección o refresco cada 5 min
    if (signal.direction !== "NO_TRADE") {
      const last = lastEntryTsRef.current;
      const prev = prevSignalRef.current;
      const dirChanged = !prev || prev.direction !== signal.direction;
      if (dirChanged || now - last > 5 * 60_000) {
        if (now - last > 90_000 || dirChanged) {
          journalRef.current.push({
            id: uid(), ts: now, price: signal.price, direction: signal.direction,
            confidence: signal.confidence, regime: signal.regime, scenario: signal.scenario,
            target: signal.target, invalidation: signal.invalidation,
            demo: modeRef.current === "DEMO", outcomes: {},
          });
          cap(journalRef.current, 300);
          lastEntryTsRef.current = now;
        }
      }
    }
    prevSignalRef.current = signal;

    // outcomes por horizonte usando el path de precios observado
    const path = pricePathRef.current;
    for (const e of journalRef.current) {
      for (const hz of HORIZONS) {
        if (e.outcomes[hz.label] || e.direction === "NO_TRADE") continue;
        if (now < e.ts + hz.ms) continue;
        let firstT = Infinity; let firstI = Infinity;
        let lastKnown: number | undefined;
        let reached = false;
        for (const p of path) {
          if (p.ts < e.ts) continue;
          if (p.ts > e.ts + hz.ms) break;
          reached = p.ts >= e.ts + hz.ms - 5_000;
          lastKnown = p.price;
          if (e.direction === "LONG") {
            if (e.target !== undefined && p.price >= e.target) firstT = Math.min(firstT, p.ts);
            if (e.invalidation !== undefined && p.price <= e.invalidation) firstI = Math.min(firstI, p.ts);
          } else if (e.direction === "SHORT") {
            if (e.target !== undefined && p.price <= e.target) firstT = Math.min(firstT, p.ts);
            if (e.invalidation !== undefined && p.price >= e.invalidation) firstI = Math.min(firstI, p.ts);
          }
        }
        if (!reached || lastKnown === undefined) continue; // aún sin datos del horizonte
        const o: Outcome = {
          hitTarget: firstT !== Infinity,
          hitInvalidation: firstI !== Infinity,
          ambiguous: firstT !== Infinity && firstI !== Infinity && Math.abs(firstT - firstI) < 3_000,
          noData: false,
          priceAt: lastKnown,
        };
        if (o.ambiguous) { o.hitTarget = false; o.hitInvalidation = false; }
        e.outcomes[hz.label] = o;
      }
    }
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journalRef.current.slice(-300))); } catch { /* almacenamiento lleno */ }
  };

  /* ---------------- alertas (§51) ---------------- */
  const processAlerts = (out: EngineOutput) => {
    const prev = engineRef.current;
    const sig = out.signal;
    if (!prev || prev.regime.state !== out.regime.state) {
      if (out.regime.state === "SHORT_SQUEEZE") pushAlert("SHORT_SQUEEZE", "critical", "SHORT SQUEEZE iniciado: shorts forzados a cerrar = presión compradora");
      if (out.regime.state === "LONG_SQUEEZE") pushAlert("LONG_SQUEEZE", "critical", "LONG SQUEEZE iniciado: longs forzados a cerrar = presión vendedora");
    }
    if (prev && prev.ctx.burst.state !== out.ctx.burst.state &&
      (out.ctx.burst.state === "CASCADE" || out.ctx.burst.state === "EXTREME_CASCADE")) {
      pushAlert("LIQ_CASCADE", "critical", `LIQUIDATION CASCADE ${out.ctx.burst.direction === "bullish" ? "de shorts" : "de longs"} (${out.ctx.burst.ratio.toFixed(1)}× línea base)`);
    }
    if (prev && prev.ctx.book.absorption.state !== out.ctx.book.absorption.state && out.ctx.book.absorption.state !== "NONE") {
      pushAlert("ABSORPTION", "warn", `${out.ctx.book.absorption.state === "BUY_ABSORPTION" ? "BUY ABSORPTION" : "SELL ABSORPTION"} (evento estimado)`);
    }
    if (prev && prev.ctx.book.spoof.level !== out.ctx.book.spoof.level && out.ctx.book.spoof.level === "HIGH") {
      pushAlert("SPOOF_RISK", "warn", "SPOOF_RISK HIGH: liquidez top-of-book inestable (inferencia, no confirmado)");
    }
    if (prev && prev.signal.direction !== "NO_TRADE" && sig.direction === "NO_TRADE") {
      pushAlert("NO_TRADE", "info", `NO TRADE: ${sig.noTradeReasons[0] ?? "evidencia insuficiente"}`);
    }
  };

  const processSourceAlerts = () => {
    for (const [id] of HEALTH_ORDER) {
      const h = healthRef.current[id];
      if (!h) continue;
      const key = `__prev_${id}` as const;
      const prev = (healthRef as any)[key] as string | undefined;
      if (prev && prev !== "UNAVAILABLE" && h.status === "UNAVAILABLE") {
        pushAlert("SOURCE_LOST", "warn", `DATA SOURCE LOST: ${h.label}`);
      }
      (healthRef as any)[key] = h.status;
    }
  };

  /* ---------------- pasada de motor (throttled, §59) ---------------- */
  const enginePass = () => {
    const now = Date.now();
    // path de precios para outcomes
    if (isFiniteNumber(priceRef.current) && priceRef.current > 0 && now - lastPathPushRef.current > 4_000) {
      pricePathRef.current.push({ ts: now, price: priceRef.current });
      cap(pricePathRef.current, 4_000);
      lastPathPushRef.current = now;
    }
    const truth = modeRef.current === "REAL" ? "REAL" as const : "DEMO" as const;
    const input: EngineInput = {
      now, demo: modeRef.current === "DEMO", truth,
      price: priceRef.current, priceTs: priceTsRef.current,
      changePct: safeNumber(changePctRef.current, 0),
      spotTrades: spotTradesRef.current, futTrades: futTradesRef.current,
      liqs: liqsRef.current, book: bookRef.current, bookHistory: bookHistRef.current,
      oiHistory: oiHistRef.current,
      fundingRate: safeNumber(fundingRef.current, 0),
      fundingHistory: fundingHistRef.current,
      nextFundingTime: nextFundingRef.current,
      topSeries: topRef.current, takerSeries: takerRef.current,
      klines: klinesRef.current, brackets: bracketsRef.current,
      cross: crossRef.current, options: optionsRef.current,
      healthLive: HEALTH_ORDER.filter(([id]) => healthRef.current[id]?.status === "LIVE").map(([id]) => id),
      healthDegraded: HEALTH_ORDER.filter(([id]) => healthRef.current[id]?.status === "DEGRADED").map(([id]) => id),
      healthUnavailable: HEALTH_ORDER.filter(([id]) => !healthRef.current[id] || healthRef.current[id].status === "UNAVAILABLE").map(([id]) => id),
      calibrationOffset: calibrationOffset(),
    };
    try {
      const out = runEngines(input);
      processAlerts(out);
      engineRef.current = out;
      processJournal(out.signal, now);
      // frame de replay (§50): solo datos observados en esta sesión
      framesRef.current.push({
        ts: now, price: input.price,
        futCvd: out.ctx.futFeat.value, spotCvd: out.ctx.spotFeat.value,
        oi: input.oiHistory[input.oiHistory.length - 1]?.oi ?? 0,
        liqUsd: out.ctx.burst.current,
      });
      cap(framesRef.current, 1800);
    } catch (err) {
      pushAlert("ENGINE_ERROR", "critical", `Error en motor: ${String(err instanceof Error ? err.message : err)}`);
    }
    processSourceAlerts();
    setSnap(buildSnap());
  };

  /* ---------------- simulador DEMO (§65: etiquetado y aislado) ---------------- */
  const startDemo = (cbs: Callbacks): StopFn => {
    let p = 97_400;
    let drift = 0.0004;
    let oi = 82_000;
    let tick = 0;
    const tfMs: Record<Timeframe, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1D": 86_400_000, "1W": 604_800_000 };
    const klines: Partial<Record<Timeframe, Candle[]>> = {};
    (Object.keys(tfMs) as Timeframe[]).forEach((tf) => {
      const arr: Candle[] = [];
      let kp = p * (0.97 + Math.random() * 0.02);
      const vol = 0.0035 * Math.sqrt(tfMs[tf] / 3_600_000);
      for (let i = 140; i > 0; i--) {
        const o = kp;
        kp *= 1 + (Math.random() - 0.48) * vol;
        const hi = Math.max(o, kp) * (1 + Math.random() * vol * 0.4);
        const lo = Math.min(o, kp) * (1 - Math.random() * vol * 0.4);
        arr.push({ ts: Date.now() - i * tfMs[tf], open: o, high: hi, low: lo, close: kp, volume: 100 + Math.random() * 900 });
      }
      klines[tf] = arr;
    });
    const gauss = () => Math.random() + Math.random() + Math.random() - 1.5;
    const markAll = () => {
      for (const [id] of HEALTH_ORDER) {
        if (id === "coinglass") continue; // §5E: sigue requiriendo backend + key también en DEMO
        cbs.report(id, { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: (healthRef.current[id]?.records ?? 0) + 1, note: "SIMULADO", error: undefined });
      }
    };
    const iv = window.setInterval(() => {
      tick += 1;
      if (tick % 40 === 0) drift = (Math.random() - 0.5) * 0.0016;
      p *= 1 + drift + gauss() * 0.00055;
      const now = Date.now();
      const buyBias = drift > 0 ? 0.62 : 0.38;
      const nFut = 2 + Math.floor(Math.random() * 6);
      for (let i = 0; i < nFut; i++) {
        cbs.onTrade("fut", { ts: now, price: p * (1 + gauss() * 0.00015), qty: 0.01 + Math.random() * Math.random() * 2.5, isBuyerMaker: Math.random() > buyBias });
      }
      const nSpot = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < nSpot; i++) {
        cbs.onTrade("spot", { ts: now, price: p * (1 + gauss() * 0.00015), qty: 0.01 + Math.random() * Math.random() * 1.6, isBuyerMaker: Math.random() > buyBias + 0.04 });
      }
      // liquidaciones: ráfagas ocasionales contra el lado perdedor
      if (Math.random() < (Math.abs(drift) > 0.0007 ? 0.5 : 0.14)) {
        const burstN = Math.random() < 0.15 ? 6 + Math.floor(Math.random() * 12) : 1;
        const shortLiq = drift > 0; // precio sube => shorts liquidados (orden BUY)
        for (let i = 0; i < burstN; i++) {
          const qty = 0.05 + Math.random() * Math.random() * 8;
          cbs.onLiq({ id: uid(), ts: now - Math.floor(Math.random() * 4000), price: p * (1 + gauss() * 0.0002), qty, usd: qty * p, side: shortLiq ? "BUY" : "SELL", symbol: "BTCUSDT", truth: "DEMO" });
        }
      }
      if (tick % 5 === 0) { oi *= 1 + drift * 0.6 + gauss() * 0.0012; cbs.onOi(oi, now); }
      cbs.onMark({ mark: p, fundingRate: 0.0001 + gauss() * 0.00002, nextFundingTime: Math.ceil(now / 28_800_000) * 28_800_000, ts: now });
      cbs.onTicker({ changePct: drift * 100 * 60, high: p * 1.012, low: p * 0.988, quoteVolume: 28_000_000_000 });
      (Object.keys(tfMs) as Timeframe[]).forEach((tf) => {
        const arr = klines[tf]!;
        const lastK = arr[arr.length - 1];
        if (now - lastK.ts >= tfMs[tf]) {
          arr.push({ ts: lastK.ts + tfMs[tf], open: lastK.close, high: Math.max(lastK.close, p), low: Math.min(lastK.close, p), close: p, volume: 50 });
          if (arr.length > 140) arr.shift();
        } else {
          lastK.close = p; lastK.high = Math.max(lastK.high, p); lastK.low = Math.min(lastK.low, p); lastK.volume += Math.random() * 8;
        }
        cbs.onKlines(tf, [...arr], now);
      });
      // book sintético con muros que rotan
      const mkLevels = (dir: 1 | -1) => Array.from({ length: 20 }, (_, i) => ({
        price: Math.round(p + dir * (i + 1) * (60 + Math.random() * 60)),
        qty: (i === 7 && Math.random() < 0.5 ? 30 : 1) * (0.4 + Math.random() * 3.2),
      }));
      const bids = mkLevels(-1); const asks = mkLevels(1);
      const notional = (lv: { price: number; qty: number }[]) => lv.reduce((s, l) => s + l.price * l.qty, 0);
      cbs.onBook({ bids, asks, ts: now, lastUpdateId: tick, notionalBid: notional(bids), notionalAsk: notional(asks) });
      if (tick % 10 === 0) {
        const pushSeries = (kind: "top" | "taker", base: number) => {
          const cur = kind === "top" ? topRef.current : takerRef.current;
          const next = { ts: now, ratio: Math.max(0.4, (cur[cur.length - 1]?.ratio ?? base) + gauss() * 0.05 + drift * 40) };
          const arr = [...cur, next].slice(-48);
          cbs.onRatio(kind, arr);
        };
        pushSeries("top", 1.3); pushSeries("taker", 1.0);
        cbs.onFundingHistory(Array.from({ length: 60 }, () => 0.0001 + gauss() * 0.00006));
        cbs.onBrackets([0.004, 0.005, 0.0065, 0.01, 0.0125, 0.015].map((mmr, i) => ({ bracket: (i + 1) * 50_000, maintenanceMarginRate: mmr })));
      }
      if (tick % 7 === 0) {
        cbs.onCross({ exchange: "OKX", truth: "DEMO", price: p * 1.0001, oiUsd: oi * p * 0.28, funding: 0.00012, fetchedAt: now });
        cbs.onCross({ exchange: "Bybit", truth: "DEMO", price: p * 0.9999, oiUsd: oi * p * 0.22, funding: 0.00009, fetchedAt: now });
      }
      if (tick % 20 === 0) {
        cbs.onOptions({ truth: "DEMO", source: "sim", fetchedAt: now, totalOi: 9_500_000_000 * (1 + gauss() * 0.01), putCallRatio: 0.82 + gauss() * 0.03, atmIv: 54 + gauss() * 2, maxPain: Math.round(p / 2500) * 2500, expiries: 6 });
      }
      markAll();
    }, 650);
    markAll();
    return () => window.clearInterval(iv);
  };

  /* ---------------- arranque por modo ---------------- */
  useEffect(() => {
    modeRef.current = mode;
    startedAtRef.current = Date.now();
    // reset de buffers al cambiar de modo (§65: nunca mezclar)
    priceRef.current = 0; priceTsRef.current = 0; tickDirRef.current = "none";
    changePctRef.current = NaN; high24Ref.current = NaN; low24Ref.current = NaN; qvRef.current = NaN;
    fundingRef.current = NaN; nextFundingRef.current = 0;
    spotTradesRef.current = []; futTradesRef.current = []; liqsRef.current = [];
    bookRef.current = null; bookHistRef.current = []; oiHistRef.current = [];
    fundingHistRef.current = []; klinesRef.current = {}; topRef.current = []; takerRef.current = [];
    bracketsRef.current = []; crossRef.current = []; optionsRef.current = null;
    pricePathRef.current = []; engineRef.current = null; framesRef.current = [];
    prevSignalRef.current = null; lastEntryTsRef.current = 0;
    for (const [id, label] of HEALTH_ORDER) {
      healthRef.current[id] = { id, label, status: "UNAVAILABLE", records: 0, reconnects: 0, note: mode === "DEMO" ? "SIMULADO" : "conectando…" };
    }
    alertsRef.current = [];
    pushAlert("MODE", "info", mode === "REAL"
      ? "Modo REAL: solo datos de mercado reales. Sin datos => NO TRADE."
      : "Modo DEMO: datos simulados y etiquetados. No alimenta el journal REAL (§65).");
    setSnap(buildSnap());

    const stops: StopFn[] = [];
    if (mode === "REAL") {
      stops.push(startBinance(cb), startCrossExchange(cb), startOptions(cb));
    } else {
      stops.push(startDemo(cb));
    }
    const engineIv = window.setInterval(enginePass, 2_000);
    return () => { stops.forEach((s) => s()); window.clearInterval(engineIv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const setMode = (m: Mode) => setModeState(m);

  return { state: snap, setMode };
}
