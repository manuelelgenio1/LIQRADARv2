import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "./format";

/* ------------------------------------------------------------------ types */

export type LiqEvent = {
  id: string;
  symbol: string;
  /** SELL = forced sell -> LONG liquidated · BUY = forced buy -> SHORT liquidated */
  side: "SELL" | "BUY";
  price: number;
  qty: number;
  usd: number;
  time: number;
};

export type ConnStatus = "connecting" | "live" | "sim";

export type SessionStats = {
  longUsd: number;
  shortUsd: number;
  longCount: number;
  shortCount: number;
  maxUsd: number;
  startedAt: number;
};

const WS_MARK = "wss://fstream.binance.com/ws/btcusdt@markPrice@1s";
const WS_LIQ = "wss://fstream.binance.com/ws/!forceOrder@arr";
const REST_24H = "https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT";
const REST_KLINES =
  "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=150";

const SIM_ANCHOR = 97_420;
const SIM_START_CHANGE = 1.86; // % simulated 24h change at session start

let idCounter = 0;
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ev_${Date.now()}_${idCounter++}`;

const randn = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ------------------------------------------------------------------- hook */

export function useMarket() {
  const [price, setPrice] = useState(0);
  const [prevPrice, setPrevPrice] = useState(0);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [high24h, setHigh24h] = useState<number | null>(null);
  const [low24h, setLow24h] = useState<number | null>(null);
  const [volume24h, setVolume24h] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [nextFunding, setNextFunding] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [events, setEvents] = useState<LiqEvent[]>([]);
  const [stats, setStats] = useState<SessionStats>({
    longUsd: 0,
    shortUsd: 0,
    longCount: 0,
    shortCount: 0,
    maxUsd: 0,
    startedAt: Date.now(),
  });
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [paused, setPaused] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  const socketsRef = useRef<WebSocket[]>([]);
  const simTimerRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const liveRef = useRef(false);
  const attemptsRef = useRef(0);
  const burstRef = useRef(0);
  const simPriceRef = useRef(0);
  const simAnchor24Ref = useRef(SIM_ANCHOR / (1 + SIM_START_CHANGE / 100));
  const deadRef = useRef(false);

  pausedRef.current = paused;

  /* ------------------------------------------------------- event intake */

  const ingestEvent = useCallback((ev: LiqEvent) => {
    setStats((s) => ({
      ...s,
      longUsd: s.longUsd + (ev.side === "SELL" ? ev.usd : 0),
      shortUsd: s.shortUsd + (ev.side === "BUY" ? ev.usd : 0),
      longCount: s.longCount + (ev.side === "SELL" ? 1 : 0),
      shortCount: s.shortCount + (ev.side === "BUY" ? 1 : 0),
      maxUsd: Math.max(s.maxUsd, ev.usd),
    }));
    if (!pausedRef.current) {
      setEvents((prev) => [ev, ...prev].slice(0, 60));
    }
  }, []);

  const priceRef = useRef(0);
  const pushPrice = useCallback((p: number) => {
    setPrevPrice(priceRef.current);
    priceRef.current = p;
    setPrice(p);
    setHistory((h) => [...h.slice(-239), p]);
  }, []);

  /* ---------------------------------------------------------- simulator */

  const makeSimEvent = useCallback(
    (p: number, when: number, forceSide?: "SELL" | "BUY"): LiqEvent => {
      const usd = clamp(Math.exp(randn() * 1.15) * 34_000, 700, 3_200_000);
      const side: "SELL" | "BUY" =
        forceSide ?? (Math.random() < 0.54 ? "SELL" : "BUY");
      const off = (side === "SELL" ? -1 : 1) * (0.0004 + Math.random() * 0.0022);
      const price = p * (1 + off);
      return {
        id: uid(),
        symbol: "BTCUSDT",
        side,
        price,
        qty: usd / price,
        usd,
        time: when,
      };
    },
    []
  );

  const startSim = useCallback(() => {
    if (simTimerRef.current !== null) return;
    setStatus("sim");
    socketsRef.current.forEach((s) => {
      try { s.close(); } catch { /* noop */ }
    });
    socketsRef.current = [];

    let p = simPriceRef.current || SIM_ANCHOR * (1 + randn() * 0.004);
    simPriceRef.current = p;

    // pre-roll price history so the sparkline is alive immediately
    if (history.length < 10) {
      const pre: number[] = [];
      let x = p * (1 - randn() * 0.006);
      for (let i = 0; i < 130; i++) {
        x = x * (1 + randn() * 0.00032 + 0.000008);
        pre.push(x);
      }
      pre.push(p);
      setHistory(pre);
    }

    // seed a few past liquidations so the session is not empty
    if (events.length === 0) {
      const seeds: LiqEvent[] = [];
      for (let i = 0; i < 6; i++) {
        seeds.push(makeSimEvent(p, Date.now() - (40_000 + Math.random() * 8 * 60_000)));
      }
      seeds.sort((a, b) => b.time - a.time);
      seeds.forEach(ingestEvent);
    }

    if (fundingRate === null) setFundingRate(0.000082);
    if (nextFunding === null) {
      const h = new Date();
      h.setMinutes(0, 0, 0);
      const next = h.getTime() + 8 * 3_600_000;
      setNextFunding(next > Date.now() ? next : next + 8 * 3_600_000);
    }

    simTimerRef.current = window.setInterval(() => {
      const shock = Math.random() < 0.035 ? randn() * 0.0042 : 0;
      const move = randn() * 0.0003 + shock;
      p = p * (1 + move);
      simPriceRef.current = p;
      pushPrice(p);

      setChange24h((p / simAnchor24Ref.current - 1) * 100);
      setHigh24h((h) => (h === null ? p * 1.021 : Math.max(h, p)));
      setLow24h((l) => (l === null ? p * 0.983 : Math.min(l, p)));

      // liquidation bursts follow violent moves
      if (Math.abs(move) > 0.0016) burstRef.current += 3 + Math.floor(Math.random() * 5);

      // down-moves liquidate longs (SELL), up-moves liquidate shorts (BUY)
      const emit = () => {
        const side: "SELL" | "BUY" =
          Math.random() < 0.5 - move * 60 ? "SELL" : "BUY";
        ingestEvent(makeSimEvent(p, Date.now(), side));
      };

      if (burstRef.current > 0) {
        burstRef.current -= 1;
        emit();
        if (burstRef.current > 0 && Math.random() < 0.6) {
          burstRef.current -= 1;
          setTimeout(() => ingestEvent(makeSimEvent(p * (1 + randn() * 0.0008), Date.now())), 240);
        }
      } else if (Math.random() < 0.26) {
        emit();
      }
    }, 850);
  }, [events.length, fundingRate, history.length, ingestEvent, makeSimEvent, nextFunding, pushPrice]);

  /* -------------------------------------------------------- live streams */

  const connectLive = useCallback(() => {
    if (deadRef.current) return;
    setStatus("connecting");

    let mark: WebSocket;
    let liq: WebSocket;
    try {
      mark = new WebSocket(WS_MARK);
      liq = new WebSocket(WS_LIQ);
    } catch {
      startSim();
      return;
    }
    socketsRef.current = [mark, liq];

    let opened = false;
    const watchdog = window.setTimeout(() => {
      if (!opened && !deadRef.current) startSim();
    }, 6500);

    mark.onopen = () => {
      opened = true;
      liveRef.current = true;
      window.clearTimeout(watchdog);
      if (simTimerRef.current !== null) {
        window.clearInterval(simTimerRef.current);
        simTimerRef.current = null;
      }
      setStatus("live");
    };

    mark.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data as string);
        const p = parseFloat(d.p);
        if (isFinite(p) && p > 0) pushPrice(p);
        if (d.r !== undefined) setFundingRate(parseFloat(d.r));
        if (d.T !== undefined) setNextFunding(parseInt(d.T, 10));
      } catch { /* ignore */ }
    };

    liq.onmessage = (msg) => {
      try {
        const d = JSON.parse(msg.data as string);
        const o = d.o;
        if (!o || o.s !== "BTCUSDT") return;
        const qty = parseFloat(o.q);
        const ap = parseFloat(o.ap) || parseFloat(o.p);
        ingestEvent({
          id: uid(),
          symbol: o.s,
          side: o.S === "BUY" ? "BUY" : "SELL",
          price: ap,
          qty,
          usd: qty * ap,
          time: o.T || Date.now(),
        });
      } catch { /* ignore */ }
    };

    const onFail = () => {
      window.clearTimeout(watchdog);
      if (deadRef.current || liveRef.current) return;
      attemptsRef.current += 1;
      if (attemptsRef.current < 2) {
        window.setTimeout(connectLive, 1400);
      } else {
        startSim();
      }
    };
    mark.onerror = onFail;
    mark.onclose = () => {
      if (!opened) onFail();
    };
    liq.onerror = () => { /* liq stream is optional */ };

    // 24h stats via REST
    fetch(REST_24H)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setChange24h(parseFloat(d.priceChangePercent));
        setHigh24h(parseFloat(d.highPrice));
        setLow24h(parseFloat(d.lowPrice));
        setVolume24h(parseFloat(d.quoteVolume));
      })
      .catch(() => {
        setChange24h((c) => c ?? SIM_START_CHANGE);
        setHigh24h((h) => h ?? simPriceRef.current * 1.019);
        setLow24h((l) => l ?? simPriceRef.current * 0.984);
      });

    // seed the sparkline with the last 150 one-minute closes
    fetch(REST_KLINES)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: unknown[]) => {
        const closes = (rows as (string | number)[][])
          .map((k) => parseFloat(String(k[4])))
          .filter((v) => isFinite(v));
        if (closes.length) setHistory((h) => (h.length > 10 ? h : closes));
      })
      .catch(() => { /* sparkline will grow from the live stream */ });
  }, [ingestEvent, pushPrice, startSim]);

  /* -------------------------------------------------------------- lifecycle */

  useEffect(() => {
    deadRef.current = false;
    connectLive();

    const clock = window.setInterval(() => setNowTs(Date.now()), 1000);
    const vol = window.setInterval(() => {
      // refresh 24h quote volume while live
      if (!liveRef.current) return;
      fetch(REST_24H)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setVolume24h(parseFloat(d.quoteVolume)))
        .catch(() => { /* noop */ });
    }, 90_000);

    return () => {
      deadRef.current = true;
      window.clearInterval(clock);
      window.clearInterval(vol);
      if (simTimerRef.current !== null) window.clearInterval(simTimerRef.current);
      socketsRef.current.forEach((s) => {
        try { s.close(); } catch { /* noop */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reconnect = useCallback(() => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    liveRef.current = false;
    attemptsRef.current = 0;
    connectLive();
  }, [connectLive]);

  const dir = useMemo<"up" | "down" | "flat">(() => {
    if (!prevPrice || price === prevPrice) return "flat";
    return price > prevPrice ? "up" : "down";
  }, [price, prevPrice]);

  return {
    price,
    dir,
    change24h,
    high24h,
    low24h,
    volume24h,
    fundingRate,
    nextFunding,
    history,
    events,
    stats,
    status,
    paused,
    setPaused,
    reconnect,
    nowTs,
  };
}

export type MarketApi = ReturnType<typeof useMarket>;
