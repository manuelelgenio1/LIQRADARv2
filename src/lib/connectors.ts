/* ============================================================
 * LIQRADAR — Connector layer (spec §3/§5/§57)
 * Capa de transporte pura: fetch + WebSocket + normalización.
 * Sin lógica de señal, sin UI. Cada fuente reporta su health
 * (latencia, age, records, reconexiones, estado de secuencia).
 *
 * Nota de arquitectura: en este entorno estático no hay backend,
 * por eso CoinGlass/Hyblock (§5E/§5F, requieren API key que NUNCA
 * debe llegar al frontend — §6/§18) se declaran UNAVAILABLE.
 * ============================================================ */

import type {
  Book, BookLevel, Candle, CrossExchange, LiqEvent, OptionsSummary,
  SourceHealth, Timeframe, Trade,
} from "../types";
import { isFiniteNumber, safeNumber, uid, validateTimestamp } from "./safe";

export interface Callbacks {
  report(id: string, patch: Partial<SourceHealth>): void;
  onMark(m: { mark: number; fundingRate: number; nextFundingTime: number; ts: number }): void;
  onTicker(t: { changePct: number; high: number; low: number; quoteVolume: number }): void;
  onOi(oiBtc: number, ts: number): void;
  onTrade(kind: "spot" | "fut", t: Trade): void;
  onLiq(ev: LiqEvent): void;
  onBook(b: Book): void;
  onKlines(tf: Timeframe, candles: Candle[], fetchedAt: number): void;
  onFundingHistory(rates: number[]): void;
  onRatio(kind: "top" | "taker" | "global", series: { ts: number; ratio: number }[]): void;
  onBrackets(b: { bracket: number; maintenanceMarginRate: number }[]): void;
  onCross(cx: CrossExchange): void;
  onOptions(o: OptionsSummary): void;
}

export type StopFn = () => void;

const FAPI = "https://fapi.binance.com";
const SAPI = "https://api.binance.com";

async function fetchJson(url: string, timeoutMs = 9000): Promise<{ data: any; latencyMs: number }> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { data, latencyMs: Math.round(performance.now() - t0) };
  } finally {
    window.clearTimeout(timer);
  }
}

/* ---------- WebSocket gestionado: backoff + jitter + contador (§57) ---------- */

class ManagedWS {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private closed = false;
  private timer = 0;
  private pingTimer = 0;

  constructor(
    private url: string,
    private onMsg: (msg: any) => void,
    private onState: (connected: boolean, reconnects: number) => void,
    private reconnectsRef: { n: number },
    private ping?: { payload: string; everyMs: number }
  ) {}

  start() { this.connect(); }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.attempts = 0;
      this.onState(true, this.reconnectsRef.n);
      if (this.ping) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          try { this.ws?.send(this.ping!.payload); } catch { /* socket cerrado */ }
        }, this.ping.everyMs);
      }
    };
    this.ws.onmessage = (e) => {
      try { this.onMsg(JSON.parse(e.data)); } catch { /* mensaje no-JSON: ignorar */ }
    };
    this.ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.onState(false, this.reconnectsRef.n);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => { try { this.ws?.close(); } catch { /* noop */ } };
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.attempts += 1;
    this.reconnectsRef.n += 1;
    const backoff = Math.min(20_000, 600 * 2 ** Math.min(this.attempts, 5));
    const jitter = Math.random() * 400;
    this.timer = window.setTimeout(() => this.connect(), backoff + jitter);
  }

  stop() {
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* noop */ }
  }
}

/* ============================================================
 * BINANCE FUTURES + SPOT (§5A/§5B)
 * ============================================================ */

export function startBinance(cb: Callbacks): StopFn {
  const stops: StopFn[] = [];
  const intervals: number[] = [];
  let cancelled = false;

  const markRec = { n: 0 };
  const futRec = { n: 0 };
  const spotRec = { n: 0 };
  const liqRec = { n: 0 };
  const l2Rec = { n: 0 };
  const markRe = { n: 0 };
  const futRe = { n: 0 };
  const spotRe = { n: 0 };
  const liqRe = { n: 0 };
  const l2Re = { n: 0 };

  /* ---------- L2: snapshot REST + diff-depth WS + secuencia (§20) ---------- */
  let bids = new Map<number, number>();
  let asks = new Map<number, number>();
  let lastId = 0;
  let firstApplied = false;
  let pendingDiffs: any[] = [];
  let snapshotting = false;
  let lastEmit = 0;

  const emitBook = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 400) return;
    lastEmit = now;
    const top = (m: Map<number, number>, dir: 1 | -1): BookLevel[] =>
      [...m.entries()]
        .filter(([, q]) => q > 0)
        .sort((a, b) => (a[0] - b[0]) * dir)
        .slice(0, 20)
        .map(([price, qty]) => ({ price, qty }));
    const b = top(bids, -1);
    const a = top(asks, 1);
    const notional = (lv: BookLevel[]) => lv.reduce((s, l) => s + l.price * l.qty, 0);
    cb.onBook({
      bids: b, asks: a, ts: now, lastUpdateId: lastId,
      notionalBid: notional(b), notionalAsk: notional(a),
    });
    cb.report("bn_l2", { status: "LIVE", lastUpdate: now, ageMs: 0, records: l2Rec.n, reconnects: l2Re.n, seq: firstApplied ? "OK" : "SYNC" });
  };

  const applyDiff = (m: any) => {
    const U = safeNumber(m.U, -1);
    const u = safeNumber(m.u, -1);
    if (u <= lastId) return; // obsoleto
    if (!firstApplied) {
      if (!(U <= lastId + 1 && u >= lastId + 1)) { void snapshot(); return; }
      firstApplied = true;
    } else if (U > lastId + 1) {
      cb.report("bn_l2", { seq: "GAP→RESYNC" });
      void snapshot();
      return;
    }
    const apply = (side: Map<number, number>, levels: any[]) => {
      for (const [ps, qs] of levels) {
        const p = parseFloat(ps); const q = parseFloat(qs);
        if (!isFiniteNumber(p) || !isFiniteNumber(q)) continue;
        if (q === 0) side.delete(p); else side.set(p, q);
      }
    };
    apply(bids, m.b ?? []);
    apply(asks, m.a ?? []);
    lastId = u;
    l2Rec.n += 1;
    emitBook();
  };

  async function snapshot() {
    if (snapshotting || cancelled) return;
    snapshotting = true;
    try {
      const { data, latencyMs } = await fetchJson(`${FAPI}/fapi/v1/depth?symbol=BTCUSDT&limit=500`);
      bids = new Map((data.bids ?? []).map((x: string[]) => [parseFloat(x[0]), parseFloat(x[1])]));
      asks = new Map((data.asks ?? []).map((x: string[]) => [parseFloat(x[0]), parseFloat(x[1])]));
      lastId = safeNumber(data.lastUpdateId, 0);
      firstApplied = false;
      const buffered = pendingDiffs; pendingDiffs = [];
      for (const m of buffered) applyDiff(m);
      emitBook(true);
      cb.report("bn_l2", { status: "LIVE", latencyMs, error: undefined, reconnects: l2Re.n, seq: "OK" });
    } catch (err) {
      cb.report("bn_l2", { status: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
    } finally {
      snapshotting = false;
    }
  }

  /* ---------- WS combinado futures: aggTrade + depth + forceOrder + markPrice ---------- */
  const futWs = new ManagedWS(
    "wss://fstream.binance.com/stream?streams=btcusdt@aggTrade/btcusdt@depth@100ms/!forceOrder@arr/btcusdt@markPrice@1s",
    (msg) => {
      const stream: string = msg.stream ?? "";
      const d = msg.data;
      if (!d || typeof d !== "object") return;
      if (stream.includes("aggTrade")) {
        const price = parseFloat(d.p); const qty = parseFloat(d.q);
        if (!isFiniteNumber(price) || price <= 0 || !isFiniteNumber(qty) || qty < 0) return;
        futRec.n += 1;
        cb.onTrade("fut", { ts: safeNumber(d.T, Date.now()), price, qty, isBuyerMaker: d.m === true });
        cb.report("bn_fut_trades", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: futRec.n, reconnects: futRe.n });
      } else if (stream.includes("depth")) {
        if (snapshotting || !firstApplied && lastId === 0 && pendingDiffs.length < 400) {
          if (lastId === 0 && !snapshotting) { pendingDiffs.push(d); return; }
          if (lastId === 0) { pendingDiffs.push(d); return; }
        }
        if (lastId === 0) { pendingDiffs.push(d); void snapshot(); return; }
        applyDiff(d);
      } else if (stream.includes("forceOrder")) {
        const o = d.o;
        if (!o || o.s !== "BTCUSDT") return; // el stream es global: filtrar símbolo
        const price = parseFloat(o.p); const qty = parseFloat(o.q);
        if (!isFiniteNumber(price) || price <= 0 || !isFiniteNumber(qty) || qty <= 0) return;
        if (!validateTimestamp(safeNumber(o.T, NaN))) return;
        liqRec.n += 1;
        cb.onLiq({
          id: uid(), ts: o.T, price, qty, usd: price * qty,
          side: o.S === "BUY" ? "BUY" : "SELL", symbol: "BTCUSDT", truth: "REAL",
        });
        cb.report("bn_liq", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: liqRec.n, reconnects: liqRe.n, error: undefined });
      } else if (stream.includes("markPrice")) {
        const mark = parseFloat(d.p); const fr = parseFloat(d.r);
        if (!isFiniteNumber(mark) || mark <= 0) return;
        markRec.n += 1;
        cb.onMark({ mark, fundingRate: isFiniteNumber(fr) ? fr : 0, nextFundingTime: safeNumber(d.T, 0), ts: safeNumber(d.E, Date.now()) });
        cb.report("bn_mark", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: markRec.n, reconnects: markRe.n, error: undefined });
        cb.report("bn_funding", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: markRec.n });
      }
    },
    (connected) => cb.report("bn_ws", { status: connected ? "LIVE" : "DEGRADED", error: connected ? undefined : "reconectando…" }),
    futRe
  );
  // Los substreams comparten el socket; mapeamos health por stream vía records.
  const futStateWs = futWs; void futStateWs;

  /* ---------- WS spot: aggTrade real para Spot CVD (§5B/§14) ---------- */
  const spotWs = new ManagedWS(
    "wss://stream.binance.com:9443/ws/btcusdt@aggTrade",
    (d) => {
      const price = parseFloat(d.p); const qty = parseFloat(d.q);
      if (!isFiniteNumber(price) || price <= 0 || !isFiniteNumber(qty) || qty < 0) return;
      spotRec.n += 1;
      cb.onTrade("spot", { ts: safeNumber(d.T, Date.now()), price, qty, isBuyerMaker: d.m === true });
      cb.report("bn_spot_trades", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: spotRec.n, reconnects: spotRe.n, error: undefined });
    },
    (connected) => {
      if (!connected) cb.report("bn_spot_trades", { status: "DEGRADED", error: "reconectando…" });
    },
    spotRe
  );

  /* ---------- REST periódico ---------- */
  const poll = async (id: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) {
      cb.report(id, { status: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
    }
  };

  const tickerOnce = () => poll("bn_ticker", async () => {
    const { data, latencyMs } = await fetchJson(`${FAPI}/fapi/v1/ticker/24hr?symbol=BTCUSDT`);
    const changePct = parseFloat(data.priceChangePercent);
    if (!isFiniteNumber(changePct)) throw new Error("ticker inválido");
    cb.onTicker({
      changePct, high: parseFloat(data.highPrice), low: parseFloat(data.lowPrice),
      quoteVolume: parseFloat(data.quoteVolume),
    });
    cb.report("bn_ticker", { status: "LIVE", latencyMs, lastUpdate: Date.now(), ageMs: 0 });
  });

  const oiOnce = () => poll("bn_oi", async () => {
    const { data, latencyMs } = await fetchJson(`${FAPI}/fapi/v1/openInterest?symbol=BTCUSDT`);
    const oi = parseFloat(data.openInterest);
    if (!isFiniteNumber(oi) || oi <= 0) throw new Error("OI inválido");
    cb.onOi(oi, Date.now());
    cb.report("bn_oi", { status: "LIVE", latencyMs, lastUpdate: Date.now(), ageMs: 0 });
  });

  const klinesOnce = () => poll("bn_klines", async () => {
    const map: [Timeframe, string][] = [["15m", "15m"], ["1h", "1h"], ["4h", "4h"], ["1D", "1d"], ["1W", "1w"]];
    let ok = 0;
    for (const [tf, iv] of map) {
      try {
        const { data } = await fetchJson(`${FAPI}/fapi/v1/klines?symbol=BTCUSDT&interval=${iv}&limit=140`, 12000);
        const candles: Candle[] = (data ?? []).map((k: any[]) => ({
          ts: safeNumber(k[0]), open: parseFloat(k[1]), high: parseFloat(k[2]),
          low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
        })).filter((c: Candle) => c.close > 0 && validateTimestamp(c.ts));
        if (candles.length > 20) { cb.onKlines(tf, candles, Date.now()); ok += 1; }
      } catch { /* una temporalidad fallida no tumba el resto */ }
    }
    if (ok === 0) throw new Error("sin klines");
    cb.report("bn_klines", { status: ok === 5 ? "LIVE" : "DEGRADED", lastUpdate: Date.now(), ageMs: 0, note: `${ok}/5 temporalidades` });
  });

  const fundingHistOnce = () => poll("bn_funding_hist", async () => {
    const { data, latencyMs } = await fetchJson(`${FAPI}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=120`);
    const rates = (data ?? []).map((x: any) => parseFloat(x.fundingRate)).filter((x: number) => isFiniteNumber(x));
    if (!rates.length) throw new Error("funding vacío");
    cb.onFundingHistory(rates);
    cb.report("bn_funding_hist", { status: "LIVE", latencyMs, lastUpdate: Date.now(), ageMs: 0 });
  });

  const ratiosOnce = () => poll("bn_ratios", async () => {
    const top = await fetchJson(`${FAPI}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=5m&limit=48`);
    const taker = await fetchJson(`${FAPI}/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=5m&limit=48`);
    const global = await fetchJson(`${FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=48`);
    const parse = (d: any[], key: string) => (d ?? [])
      .map((x: any) => ({ ts: safeNumber(x.timestamp), ratio: parseFloat(x[key]) }))
      .filter((x) => isFiniteNumber(x.ratio) && x.ratio > 0);
    const t = parse(top.data, "longShortRatio");
    const k = parse(taker.data, "buySellRatio");
    const g = parse(global.data, "longShortRatio");
    if (!t.length && !k.length) throw new Error("ratios vacíos");
    if (t.length) cb.onRatio("top", t);
    if (k.length) cb.onRatio("taker", k);
    if (g.length) cb.onRatio("global", g);
    cb.report("bn_ratios", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, note: "top trader + taker + global L/S" });
  });

  const bracketsOnce = () => poll("bn_brackets", async () => {
    const { data } = await fetchJson(`${FAPI}/fapi/v1/leverageBracket?symbol=BTCUSDT`);
    const br = (data?.[0]?.brackets ?? []).map((b: any) => ({
      bracket: safeNumber(b.bracket), maintenanceMarginRate: parseFloat(b.maintenanceMarginRate),
    })).filter((b: any) => isFiniteNumber(b.maintenanceMarginRate));
    if (!br.length) throw new Error("brackets vacíos");
    cb.onBrackets(br);
    cb.report("bn_brackets", { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, note: `${br.length} tramos MMR` });
  });

  void tickerOnce(); void oiOnce(); void klinesOnce(); void fundingHistOnce(); void ratiosOnce(); void bracketsOnce();
  void snapshot();
  futWs.start(); spotWs.start();

  intervals.push(window.setInterval(tickerOnce, 15_000));
  intervals.push(window.setInterval(oiOnce, 30_000));
  intervals.push(window.setInterval(klinesOnce, 90_000));
  intervals.push(window.setInterval(fundingHistOnce, 5 * 60_000));
  intervals.push(window.setInterval(ratiosOnce, 5 * 60_000));

  // CoinGlass / Hyblock: solo backend + API key (§5E/§5F/§6)
  cb.report("coinglass", {
    status: "UNAVAILABLE", records: 0, reconnects: 0,
    note: "Requiere backend + COINGLASS_API_KEY (§6). El radar funciona sin esta fuente.",
  });

  return () => {
    cancelled = true;
    intervals.forEach((i) => window.clearInterval(i));
    futWs.stop(); spotWs.stop();
  };
}

/* ============================================================
 * CROSS-EXCHANGE (§5C/§5D): OKX + Bybit, datos públicos
 * ============================================================ */

export function startCrossExchange(cb: Callbacks): StopFn {
  let cancelled = false;

  const okxOnce = async () => {
    try {
      const t0 = performance.now();
      const [tk, oi, fr] = await Promise.all([
        fetchJson("https://www.okx.com/api/v5/public/ticker?instId=BTC-USDT-SWAP"),
        fetchJson("https://www.okx.com/api/v5/public/open-interest?instId=BTC-USDT-SWAP"),
        fetchJson("https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP"),
      ]);
      const price = parseFloat(tk.data?.data?.[0]?.last);
      const oiCcy = parseFloat(oi.data?.data?.[0]?.oiCcy);
      const funding = parseFloat(fr.data?.data?.[0]?.fundingRate);
      cb.onCross({
        exchange: "OKX", truth: "REAL",
        price: isFiniteNumber(price) ? price : undefined,
        oiUsd: isFiniteNumber(oiCcy) && isFiniteNumber(price) ? oiCcy * price : undefined,
        funding: isFiniteNumber(funding) ? funding : undefined,
        fetchedAt: Date.now(),
      });
      cb.report("okx", { status: "LIVE", latencyMs: Math.round(performance.now() - t0), lastUpdate: Date.now(), ageMs: 0, records: 1 });
    } catch (err) {
      cb.onCross({ exchange: "OKX", truth: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
      cb.report("okx", { status: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
    }
  };

  const bybitOnce = async () => {
    try {
      const t0 = performance.now();
      const { data } = await fetchJson("https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT");
      const row = data?.result?.list?.[0];
      const price = parseFloat(row?.lastPrice);
      const oiValue = parseFloat(row?.openInterestValue);
      const funding = parseFloat(row?.fundingRate);
      if (!isFiniteNumber(price)) throw new Error("respuesta inválida");
      cb.onCross({
        exchange: "Bybit", truth: "REAL", price,
        oiUsd: isFiniteNumber(oiValue) ? oiValue : undefined,
        funding: isFiniteNumber(funding) ? funding : undefined,
        fetchedAt: Date.now(),
      });
      cb.report("bybit", { status: "LIVE", latencyMs: Math.round(performance.now() - t0), lastUpdate: Date.now(), ageMs: 0, records: 1 });
    } catch (err) {
      cb.onCross({ exchange: "Bybit", truth: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
      cb.report("bybit", { status: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
    }
  };

  void okxOnce(); void bybitOnce();
  const iv = window.setInterval(() => { if (!cancelled) { void okxOnce(); void bybitOnce(); } }, 30_000);

  return () => { cancelled = true; window.clearInterval(iv); };
}

/* ============================================================
 * OPCIONES (§33): Deribit público. Cobertura incompleta => PARTIAL/UNAVAILABLE.
 * ============================================================ */

export function startOptions(cb: Callbacks): StopFn {
  let cancelled = false;

  const once = async () => {
    try {
      const t0 = performance.now();
      const { data } = await fetchJson("https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option", 12000);
      const rows: any[] = data?.result ?? [];
      if (!rows.length) throw new Error("sin datos de opciones");
      let callOi = 0; let putOi = 0;
      const byStrike = new Map<number, { call: number; put: number }>();
      const expiries = new Set<string>();
      // §33: instrumentos por vencimiento para term structure y skew
      const byExpiry = new Map<string, { strike: number; iv: number; isPut: boolean }[]>();
      for (const r of rows) {
        const name: string = r.instrument_name ?? "";
        const oiBtc = safeNumber(r.open_interest);
        const strike = safeNumber(r.strike_price);
        const expiry = name.split("-")[1] ?? "";
        expiries.add(expiry);
        const isPut = name.includes("-P-");
        if (isPut) putOi += oiBtc; else callOi += oiBtc;
        const cur = byStrike.get(strike) ?? { call: 0, put: 0 };
        if (isPut) cur.put += oiBtc; else cur.call += oiBtc;
        byStrike.set(strike, cur);
        const iv = safeNumber(r.mark_iv, NaN);
        if (isFiniteNumber(iv) && isFiniteNumber(strike) && strike > 0) {
          const arr = byExpiry.get(expiry) ?? [];
          arr.push({ strike, iv: iv * 100, isPut });
          byExpiry.set(expiry, arr);
        }
      }
      // Max Pain (DERIVED, §66): strike que minimiza el pago agregado
      let maxPain: number | undefined; let minCost = Infinity;
      const strikes = [...byStrike.keys()].filter((s) => s > 0);
      for (const k of strikes) {
        let cost = 0;
        for (const [s, v] of byStrike) {
          if (s > k) cost += (s - k) * v.call;
          if (s < k) cost += (k - s) * v.put;
        }
        if (cost < minCost) { minCost = cost; maxPain = k; }
      }
      // DVOL ≈ ATM IV
      let dvol: number | undefined;
      try {
        const dv = await fetchJson("https://www.deribit.com/api/v2/public/ticker?instrument_name=DVOL");
        dvol = dv.data?.result?.last;
      } catch { /* opcional */ }

      const lastBtc = safeNumber(rows[0].mark_price, 0);
      const totalOi = (callOi + putOi) * (lastBtc || 1);

      // §33: term structure — IV ATM por vencimiento (REAL observado)
      const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const expiryTs = (exp: string): number => {
        // formato típico: "27SEP25" (DDMMMYY)
        const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(exp);
        if (!m) return Infinity;
        return Date.UTC(2000 + Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1]));
      };
      const termStructure = [...byExpiry.entries()]
        .map(([expiry, insts]) => {
          if (!insts.length || lastBtc <= 0) return null;
          // ATM = strike más cercano al precio
          const atm = insts.reduce((a, b) =>
            Math.abs(a.strike - lastBtc) < Math.abs(b.strike - lastBtc) ? a : b);
          return { expiry, iv: atm.iv, ts: expiryTs(expiry) };
        })
        .filter((x): x is { expiry: string; iv: number; ts: number } => x !== null && isFiniteNumber(x.iv))
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 8)
        .map(({ expiry, iv }) => ({ expiry, iv }));

      // §33: skew 25Δ aproximado (DERIVADO): put ~-2,5 % vs call ~+2,5 % del vencimiento más cercano
      let skew25: number | undefined;
      const front = [...byExpiry.entries()].sort((a, b) => expiryTs(a[0]) - expiryTs(b[0]))[0]?.[1];
      if (front && lastBtc > 0) {
        const putSide = front.filter((x) => x.isPut && x.strike <= lastBtc * 0.99)
          .sort((a, b) => Math.abs(a.strike - lastBtc * 0.975) - Math.abs(b.strike - lastBtc * 0.975))[0];
        const callSide = front.filter((x) => !x.isPut && x.strike >= lastBtc * 1.01)
          .sort((a, b) => Math.abs(a.strike - lastBtc * 1.025) - Math.abs(b.strike - lastBtc * 1.025))[0];
        if (putSide && callSide) skew25 = putSide.iv - callSide.iv;
      }

      cb.onOptions({
        truth: "REAL", source: "deribit", fetchedAt: Date.now(),
        totalOi, putCallRatio: safeRatioGuard(putOi, callOi), atmIv: isFiniteNumber(dvol) ? dvol : undefined,
        maxPain, expiries: expiries.size,
        termStructure: termStructure.length ? termStructure : undefined,
        skew25,
      });
      cb.report("deribit", {
        status: "LIVE", latencyMs: Math.round(performance.now() - t0),
        lastUpdate: Date.now(), ageMs: 0, records: rows.length,
        note: `${expiries.size} expiries · OI por strike`,
      });
    } catch (err) {
      cb.onOptions({ truth: "UNAVAILABLE", source: "deribit", fetchedAt: Date.now(), error: String(err instanceof Error ? err.message : err) });
      cb.report("deribit", { status: "UNAVAILABLE", error: String(err instanceof Error ? err.message : err) });
    }
  };

  const safeRatioGuard = (a: number, b: number) => (b > 0 && isFiniteNumber(a / b) ? a / b : undefined);

  void once();
  const iv = window.setInterval(() => { if (!cancelled) void once(); }, 60_000);
  return () => { cancelled = true; window.clearInterval(iv); };
}

/* ============================================================
 * LIQUIDACIONES MULTI-EXCHANGE: OKX + Bybit + Aggr.trade
 * (fuentes valoradas por el usuario; todas públicas, sin API key)
 * ============================================================ */

/** OKX v5 — canal liquidation-orders (SWAP). Solo BTC-USDT-SWAP, solo "filled".
 *  sz viene en contratos; 1 contrato BTC-USDT-SWAP = 0.01 BTC (ctVal oficial). */
export function startOkxLiq(cb: Callbacks): StopFn {
  const rec = { n: 0 };
  const id = "okx_liq";
  const ws = new ManagedWS(
    "wss://ws.okx.com:8443/ws/v5/public",
    (msg) => {
      if (msg?.event === "subscribe") {
        cb.report(id, { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, seq: "suscrito", error: undefined });
        return;
      }
      const rows: any[] = Array.isArray(msg?.data) ? msg.data : [];
      for (const r of rows) {
        if (r?.instId !== "BTC-USDT-SWAP" || r?.state !== "filled") continue;
        const px = safeNumber(r.px);
        const sz = safeNumber(r.sz);
        if (!isFiniteNumber(px) || px <= 0 || !isFiniteNumber(sz) || sz <= 0) continue;
        const qty = sz * 0.01; // ctVal BTC-USDT-SWAP
        cb.onLiq({
          id: uid(), ts: validateTimestamp(r.ts) ? Number(r.ts) : Date.now(),
          price: px, qty, usd: px * qty,
          side: String(r.side).toLowerCase() === "sell" ? "SELL" : "BUY",
          symbol: "BTCUSDT", truth: "REAL", exchange: "OKX",
        });
        rec.n += 1;
        cb.report(id, { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: rec.n, seq: "filled", error: undefined });
      }
    },
    (connected, reconnects) => {
      if (connected) {
        try { /* ManagedWS no expone send: el suscribe se envía vía onopen ping+mensaje */ } catch { /* noop */ }
      }
      cb.report(id, { status: connected ? "LIVE" : "UNAVAILABLE", reconnects, lastUpdate: connected ? Date.now() : undefined });
    },
    { n: 0 },
    { payload: "ping", everyMs: 20_000 } // OKX requiere ping textual
  );
  // la suscripción debe enviarse tras abrir el socket: ManagedWS abre al start(),
  // así que reintentamos el subscribe hasta que el servidor confirme.
  const sub = window.setInterval(() => {
    try {
      (ws as any).ws?.send(JSON.stringify({ op: "subscribe", args: [{ channel: "liquidation-orders", instType: "SWAP" }] }));
    } catch { /* aún no abierto */ }
  }, 1_500);
  ws.start();
  cb.report(id, { status: "UNAVAILABLE", note: "conectando…" });
  return () => { window.clearInterval(sub); ws.stop(); };
}

/** Bybit v5 — topic liquidation.BTCUSDT (lineal). size en BTC. */
export function startBybitLiq(cb: Callbacks): StopFn {
  const rec = { n: 0 };
  const id = "bybit_liq";
  const ws = new ManagedWS(
    "wss://stream.bybit.com/v5/public/linear",
    (msg) => {
      if (msg?.topic !== "liquidation.BTCUSDT") return;
      const d = msg?.data;
      const price = safeNumber(d?.price);
      const size = safeNumber(d?.size);
      if (!isFiniteNumber(price) || price <= 0 || !isFiniteNumber(size) || size <= 0) return;
      cb.onLiq({
        id: uid(), ts: validateTimestamp(d?.updatedTime) ? Number(d.updatedTime) : Date.now(),
        price, qty: size, usd: price * size,
        side: String(d?.side) === "Sell" ? "SELL" : "BUY",
        symbol: "BTCUSDT", truth: "REAL", exchange: "BYBIT",
      });
      rec.n += 1;
      cb.report(id, { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: rec.n, error: undefined });
    },
    (connected, reconnects) => {
      cb.report(id, { status: connected ? "LIVE" : "UNAVAILABLE", reconnects, lastUpdate: connected ? Date.now() : undefined });
    },
    { n: 0 },
    { payload: JSON.stringify({ op: "ping" }), everyMs: 20_000 }
  );
  const sub = window.setInterval(() => {
    try { (ws as any).ws?.send(JSON.stringify({ op: "subscribe", args: ["liquidation.BTCUSDT"] })); } catch { /* aún no abierto */ }
  }, 1_500);
  ws.start();
  cb.report(id, { status: "UNAVAILABLE", note: "conectando…" });
  return () => { window.clearInterval(sub); ws.stop(); };
}

/** Aggr.trade — agregador público de liquidaciones multi-exchange (WS). */
export function startAggr(cb: Callbacks): StopFn {
  const rec = { n: 0 };
  const id = "aggr_liq";
  const ws = new ManagedWS(
    "wss://api.aggr.trade/stream",
    (msg) => {
      if (msg?.type !== "liquidation" || msg?.symbol !== "BTCUSDT") return;
      const price = safeNumber(msg.price);
      const qty = safeNumber(msg.qty);
      if (!isFiniteNumber(price) || price <= 0 || !isFiniteNumber(qty) || qty <= 0) return;
      cb.onLiq({
        id: uid(), ts: validateTimestamp(msg.time) ? Number(msg.time) : Date.now(),
        price, qty, usd: price * qty,
        side: String(msg.side).toLowerCase() === "sell" ? "SELL" : "BUY",
        symbol: "BTCUSDT", truth: "REAL",
        exchange: String(msg.exchange ?? "AGGR").toUpperCase(),
      });
      rec.n += 1;
      cb.report(id, { status: "LIVE", lastUpdate: Date.now(), ageMs: 0, records: rec.n, error: undefined });
    },
    (connected, reconnects) => {
      cb.report(id, { status: connected ? "LIVE" : "UNAVAILABLE", reconnects, lastUpdate: connected ? Date.now() : undefined });
    },
    { n: 0 }
  );
  ws.start();
  cb.report(id, { status: "UNAVAILABLE", note: "conectando…" });
  return () => ws.stop();
}

/* ============================================================
 * CONTEXTO ADICIONAL (REST, sin API key, CORS habilitado)
 * ============================================================ */

const FNG_LABELS: Record<string, string> = {
  "Extreme Fear": "Miedo extremo", Fear: "Miedo", Neutral: "Neutral",
  Greed: "Codicia", "Extreme Greed": "Codicia extrema",
};

/** Fear & Greed Index (alternative.me) — sentimiento minorista REAL. */
export async function fetchSentiment(): Promise<{ value: number; label: string } | null> {
  try {
    const { data } = await fetchJson("https://api.alternative.me/fng/?limit=1", 8000);
    const row = data?.data?.[0];
    const value = safeNumber(Number(row?.value), NaN);
    if (!isFiniteNumber(value)) return null;
    return { value, label: FNG_LABELS[String(row?.value_classification)] ?? String(row?.value_classification ?? "—") };
  } catch { return null; }
}

/** CoinCap — precio BTC de respaldo (FALLBACK, nunca se mezcla con REAL como si fuera Binance). */
export async function fetchCoincapPrice(): Promise<number | null> {
  try {
    const { data } = await fetchJson("https://api.coincap.io/v2/assets/bitcoin", 8000);
    const p = safeNumber(Number(data?.data?.priceUsd), NaN);
    return isFiniteNumber(p) && p > 0 ? p : null;
  } catch { return null; }
}
