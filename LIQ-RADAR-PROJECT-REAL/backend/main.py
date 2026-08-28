from __future__ import annotations

import asyncio
import json
import math
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from typing import Any, Deque

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import websockets

load_dotenv()

# =========================
# Configuration
# =========================
SYMBOLS = [s.strip().upper() for s in os.getenv("SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT").split(",") if s.strip()]
DEFAULT_SYMBOL = os.getenv("DEFAULT_SYMBOL", SYMBOLS[0] if SYMBOLS else "BTCUSDT")
MAX_EVENTS = int(os.getenv("BUFFER_MAX_EVENTS", "30000"))

HYBLOCK_API_KEY = os.getenv("HYBLOCK_API_KEY", "")
HYBLOCK_CLIENT_ID = os.getenv("HYBLOCK_CLIENT_ID", "")
HYBLOCK_CLIENT_SECRET = os.getenv("HYBLOCK_CLIENT_SECRET", "")
HYBLOCK_BASE_URL = os.getenv("HYBLOCK_BASE_URL", "https://api.hyblockcapital.com/v2")

# =========================
# Normalized data
# =========================
@dataclass
class Liquidation:
    exchange: str
    symbol: str
    side: str  # position that was liquidated: long / short
    price: float
    qty: float
    usd: float
    ts: int

@dataclass
class Trade:
    exchange: str
    symbol: str
    price: float
    qty: float
    side: str  # aggressor: buy / sell
    ts: int

@dataclass
class MarketState:
    symbol: str
    price: float = 0.0
    price_source: str = ""
    oi_usd: float = 0.0
    oi_source: str = ""
    funding: float = 0.0
    funding_source: str = ""
    cvd_usd: float = 0.0
    cvd_5m_usd: float = 0.0
    liq_long_5m: float = 0.0
    liq_short_5m: float = 0.0
    book_imbalance: float = 0.0
    book_source: str = ""
    updated: int = 0

@dataclass
class SourceState:
    name: str
    status: str = "starting"  # starting / connected / error
    message: str = ""
    last_message: int = 0
    liquidation_count: int = 0
    trade_count: int = 0

# =========================
# Stores
# =========================
liq_events: Deque[Liquidation] = deque(maxlen=MAX_EVENTS)
trade_events: Deque[Trade] = deque(maxlen=MAX_EVENTS * 3)
prices: dict[str, Deque[tuple[int, float]]] = defaultdict(lambda: deque(maxlen=5000))
cvd_points: dict[str, Deque[tuple[int, float]]] = defaultdict(lambda: deque(maxlen=5000))
orderbook: dict[str, dict[str, list[tuple[float, float]]]] = defaultdict(lambda: {"bids": [], "asks": []})
market: dict[str, MarketState] = {s: MarketState(symbol=s) for s in SYMBOLS}
source: dict[str, SourceState] = {k: SourceState(k) for k in ("Binance", "Bybit", "OKX", "Hyblock")}
clients: set[WebSocket] = set()
locks = defaultdict(asyncio.Lock)
_hb_token = {"value": "", "exp": 0}

# =========================
# Helpers
# =========================
def symbol_base(s: str) -> str:
    s = s.upper().replace("-USDT-SWAP", "USDT").replace("-USDT", "USDT")
    for q in ("USDT", "USDC", "USD"):
        if s.endswith(q):
            return s[:-len(q)]
    return s


def now_ms() -> int:
    return int(time.time() * 1000)


def safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


async def broadcast(payload: dict[str, Any]):
    if not clients:
        return
    raw = json.dumps(payload, separators=(",", ":"))
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(raw)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def set_source(name: str, status: str, message: str = ""):
    s = source[name]
    s.status = status
    s.message = message[:240]
    s.last_message = now_ms()

# =========================
# Real event ingestion
# =========================
async def add_liquidation(x: Liquidation):
    if x.price <= 0 or x.qty <= 0 or x.symbol not in market:
        return
    async with locks[x.symbol]:
        liq_events.append(x)
    source[x.exchange.title()].liquidation_count += 1 if x.exchange.title() in source else 0
    source[x.exchange.title()].last_message = x.ts if x.exchange.title() in source else now_ms()
    await broadcast({"type": "liquidation", "data": asdict(x)})


async def add_trade(x: Trade):
    if x.price <= 0 or x.qty <= 0 or x.symbol not in market:
        return
    usd = x.price * x.qty
    signed = usd if x.side == "buy" else -usd
    async with locks[x.symbol]:
        trade_events.append(x)
        st = market[x.symbol]
        st.cvd_usd += signed
        prices[x.symbol].append((x.ts, x.price))
        cvd_points[x.symbol].append((x.ts, st.cvd_usd))
        st.price = x.price
        st.price_source = x.exchange
        st.updated = x.ts
    key = x.exchange.title()
    if key in source:
        source[key].trade_count += 1
        source[key].last_message = x.ts

# =========================
# Binance
# =========================
async def binance_liquidations():
    url = "wss://fstream.binance.com/ws/!forceOrder@arr"
    backoff = 1
    while True:
        try:
            set_source("Binance", "starting", "Connecting liquidation stream")
            async with websockets.connect(url, ping_interval=20, ping_timeout=10, max_size=8_000_000) as ws:
                set_source("Binance", "connected", "forceOrder stream connected")
                backoff = 1
                async for raw in ws:
                    msg = json.loads(raw)
                    o = msg.get("o", msg)
                    sym = str(o.get("s", "")).upper()
                    if sym not in market:
                        continue
                    side = "long" if str(o.get("S", "")).upper() == "SELL" else "short"
                    price = safe_float(o.get("ap") or o.get("p"))
                    qty = safe_float(o.get("z") or o.get("l") or o.get("q"))
                    ts = int(o.get("T") or msg.get("E") or now_ms())
                    await add_liquidation(Liquidation("binance", sym, side, price, qty, price * qty, ts))
        except Exception as exc:
            set_source("Binance", "error", f"liquidations: {type(exc).__name__}: {exc}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def binance_trades():
    streams = "/".join(f"{s.lower()}@aggTrade" for s in SYMBOLS)
    url = f"wss://fstream.binance.com/stream?streams={streams}"
    backoff = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10, max_size=8_000_000) as ws:
                set_source("Binance", "connected", "trade stream connected")
                backoff = 1
                async for raw in ws:
                    m = json.loads(raw).get("data", {})
                    sym = str(m.get("s", "")).upper()
                    if sym not in market:
                        continue
                    price = safe_float(m.get("p"))
                    qty = safe_float(m.get("q"))
                    side = "sell" if bool(m.get("m")) else "buy"
                    await add_trade(Trade("binance", sym, price, qty, side, int(m.get("T") or now_ms())))
        except Exception as exc:
            set_source("Binance", "error", f"trades: {type(exc).__name__}: {exc}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


async def binance_book():
    streams = "/".join(f"{s.lower()}@depth5@100ms" for s in SYMBOLS)
    url = f"wss://fstream.binance.com/stream?streams={streams}"
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10, max_size=8_000_000) as ws:
                async for raw in ws:
                    m = json.loads(raw).get("data", {})
                    sym = str(m.get("s", "")).upper()
                    if sym not in market:
                        continue
                    bids = [(safe_float(a[0]), safe_float(a[1])) for a in m.get("b", []) if len(a) >= 2]
                    asks = [(safe_float(a[0]), safe_float(a[1])) for a in m.get("a", []) if len(a) >= 2]
                    if not bids or not asks:
                        continue
                    bid_usd = sum(p * q for p, q in bids)
                    ask_usd = sum(p * q for p, q in asks)
                    imbalance = (bid_usd - ask_usd) / max(bid_usd + ask_usd, 1.0)
                    market[sym].book_imbalance = clamp(imbalance, -1, 1)
                    market[sym].book_source = "binance depth5"
                    market[sym].updated = now_ms()
        except Exception as exc:
            set_source("Binance", "error", f"order book: {type(exc).__name__}: {exc}")
            await asyncio.sleep(2)

# =========================
# Bybit
# =========================
async def bybit_ws():
    url = "wss://stream.bybit.com/v5/public/linear"
    backoff = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10, max_size=8_000_000) as ws:
                await ws.send(json.dumps({"op": "subscribe", "args": [
                    *[f"allLiquidation.{s}" for s in SYMBOLS],
                    *[f"publicTrade.{s}" for s in SYMBOLS],
                    *[f"tickers.{s}" for s in SYMBOLS],
                ]}))
                set_source("Bybit", "connected", "public linear streams connected")
                backoff = 1
                async for raw in ws:
                    msg = json.loads(raw)
                    topic = str(msg.get("topic", ""))
                    if topic.startswith("allLiquidation."):
                        data = msg.get("data", [])
                        if isinstance(data, dict):
                            data = [data]
                        for d in data or []:
                            sym = str(d.get("s", "")).upper()
                            if sym not in market:
                                continue
                            side = "long" if str(d.get("S", "")).lower() == "buy" else "short"
                            price = safe_float(d.get("p")); qty = safe_float(d.get("v"))
                            await add_liquidation(Liquidation("bybit", sym, side, price, qty, price * qty, int(d.get("T") or msg.get("ts") or now_ms())))
                    elif topic.startswith("publicTrade."):
                        for d in msg.get("data", []) or []:
                            sym = str(d.get("s", "")).upper()
                            if sym not in market:
                                continue
                            await add_trade(Trade("bybit", sym, safe_float(d.get("p")), safe_float(d.get("v")), str(d.get("S", "")).lower(), int(d.get("T") or now_ms())))
                    elif topic.startswith("tickers."):
                        rows = msg.get("data") or []
                        row = rows[0] if isinstance(rows, list) and rows else (rows if isinstance(rows, dict) else {})
                        sym = str(row.get("symbol", "")).upper()
                        if sym in market:
                            px = safe_float(row.get("lastPrice"))
                            if px > 0 and not market[sym].price:
                                market[sym].price = px
                                market[sym].price_source = "bybit"
        except Exception as exc:
            set_source("Bybit", "error", f"websocket: {type(exc).__name__}: {exc}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

# =========================
# OKX
# =========================
async def okx_ws():
    url = "wss://ws.okx.com:8443/ws/v5/public"
    backoff = 1
    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10, max_size=8_000_000) as ws:
                args = []
                for s in SYMBOLS:
                    base = symbol_base(s)
                    args.append({"channel": "trades", "instId": f"{base}-USDT-SWAP"})
                    args.append({"channel": "liquidation-orders", "instType": "SWAP", "instFamily": f"{base}-USDT"})
                await ws.send(json.dumps({"op": "subscribe", "args": args}))
                set_source("OKX", "connected", "public SWAP streams connected")
                backoff = 1
                async for raw in ws:
                    msg = json.loads(raw)
                    channel = msg.get("arg", {}).get("channel")
                    if channel == "trades":
                        for d in msg.get("data", []) or []:
                            s = symbol_base(str(d.get("instId", ""))) + "USDT"
                            if s not in market:
                                continue
                            await add_trade(Trade("okx", s, safe_float(d.get("px")), safe_float(d.get("sz")), str(d.get("side", "")).lower(), int(d.get("ts") or now_ms())))
                    elif channel == "liquidation-orders":
                        for item in msg.get("data", []) or []:
                            inst = str(item.get("instId", ""))
                            s = symbol_base(inst) + "USDT"
                            if s not in market:
                                continue
                            details = item.get("details") or []
                            if isinstance(details, dict):
                                details = [details]
                            for d in details:
                                pos = str(d.get("posSide", "")).lower()
                                if pos not in ("long", "short"):
                                    # In net mode the liquidation record may not include posSide.
                                    close_side = str(d.get("side", item.get("side", ""))).lower()
                                    pos = "long" if close_side == "sell" else "short"
                                px = safe_float(d.get("bkPx") or d.get("px") or d.get("fillPx"))
                                qty = safe_float(d.get("sz") or d.get("pos") or d.get("bkSz"))
                                ts = int(d.get("ts") or item.get("ts") or msg.get("ts") or now_ms())
                                await add_liquidation(Liquidation("okx", s, pos, px, qty, px * qty, ts))
        except Exception as exc:
            set_source("OKX", "error", f"websocket: {type(exc).__name__}: {exc}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

# =========================
# Real REST metrics
# =========================
async def fetch_json(url: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


async def update_metrics(symbol: str):
    # Primary source: Binance USD-M Futures. Fallback: Bybit.
    try:
        oi, fr, ticker = await asyncio.gather(
            fetch_json("https://fapi.binance.com/fapi/v1/openInterest", {"symbol": symbol}),
            fetch_json("https://fapi.binance.com/fapi/v1/premiumIndex", {"symbol": symbol}),
            fetch_json("https://fapi.binance.com/fapi/v1/ticker/price", {"symbol": symbol}),
        )
        px = safe_float(ticker.get("price"))
        oi_contract = safe_float(oi.get("openInterest"))
        oi_usd = oi_contract * px
        st = market[symbol]
        st.price = px if px > 0 else st.price
        st.price_source = "binance REST"
        st.oi_usd = oi_usd if oi_usd > 0 else st.oi_usd
        st.oi_source = "binance REST (OI × price)"
        st.funding = safe_float(fr.get("lastFundingRate"))
        st.funding_source = "binance REST"
        st.updated = now_ms()
        set_source("Binance", "connected", "REST metrics OK")
        return
    except Exception as exc:
        set_source("Binance", "error", f"REST metrics: {type(exc).__name__}: {exc}")

    try:
        data = await fetch_json("https://api.bybit.com/v5/market/tickers", {"category": "linear", "symbol": symbol})
        row = (data.get("result", {}).get("list") or [{}])[0]
        st = market[symbol]
        px = safe_float(row.get("lastPrice")); oi_usd = safe_float(row.get("openInterestValue"))
        if px > 0:
            st.price = px
            st.price_source = "bybit REST"
        if oi_usd > 0:
            st.oi_usd = oi_usd
            st.oi_source = "bybit REST"
        st.funding = safe_float(row.get("fundingRate"))
        st.funding_source = "bybit REST"
        st.updated = now_ms()
        set_source("Bybit", "connected", "REST metrics OK")
    except Exception as exc:
        set_source("Bybit", "error", f"REST metrics: {type(exc).__name__}: {exc}")


async def metrics_loop():
    while True:
        await asyncio.gather(*(update_metrics(s) for s in SYMBOLS), return_exceptions=True)
        await asyncio.sleep(10)

# =========================
# Analytics using observed data only
# =========================
def get_recent(symbol: str, minutes: int) -> list[Liquidation]:
    cutoff = now_ms() - minutes * 60_000
    return [x for x in liq_events if x.symbol == symbol and x.ts >= cutoff]


def liquidation_stats(symbol: str, minutes: int = 5) -> tuple[float, float]:
    recent = get_recent(symbol, minutes)
    return (
        sum(x.usd for x in recent if x.side == "long"),
        sum(x.usd for x in recent if x.side == "short"),
    )


def cvd_delta(symbol: str, minutes: int = 5) -> float:
    cutoff = now_ms() - minutes * 60_000
    vals = [x for x in cvd_points[symbol] if x[0] >= cutoff]
    if not vals:
        return 0.0
    return vals[-1][1] - vals[0][1]


def cluster_liquidations(symbol: str, minutes: int = 60) -> list[dict[str, Any]]:
    evs = get_recent(symbol, minutes)
    if not evs:
        return []
    p = market[symbol].price or evs[-1].price
    bucket = max(p * 0.0015, 1e-8)
    groups: dict[tuple[str, int], list[Liquidation]] = defaultdict(list)
    for x in evs:
        groups[(x.side, int(x.price / bucket))].append(x)
    out = []
    for (side, _), xs in groups.items():
        usd = sum(x.usd for x in xs)
        price = sum(x.price * x.usd for x in xs) / max(usd, 1)
        out.append({"side": side, "price": price, "usd": usd, "count": len(xs), "distancePct": (price / p - 1) * 100})
    return sorted(out, key=lambda x: x["usd"], reverse=True)[:40]


async def hyblock_token() -> str:
    global _hb_token
    if not (HYBLOCK_API_KEY and HYBLOCK_CLIENT_ID and HYBLOCK_CLIENT_SECRET):
        return ""
    if _hb_token["value"] and _hb_token["exp"] > time.time() + 30:
        return _hb_token["value"]
    async with httpx.AsyncClient(timeout=8) as client:
        r = await client.post(
            "https://api.hyblockcapital.com/v2/oauth2/token",
            data={"grant_type": "client_credentials", "client_id": HYBLOCK_CLIENT_ID, "client_secret": HYBLOCK_CLIENT_SECRET},
            headers={"x-api-key": HYBLOCK_API_KEY},
        )
        r.raise_for_status()
        body = r.json()
        _hb_token = {"value": body.get("access_token", ""), "exp": time.time() + int(body.get("expires_in", 300))}
        return _hb_token["value"]


async def fetch_hyblock_liq_levels(symbol: str) -> dict[str, Any]:
    token = await hyblock_token()
    if not token:
        return {"enabled": False, "data": [], "reason": "No Hyblock credentials configured"}
    try:
        base = symbol_base(symbol)
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{HYBLOCK_BASE_URL}/liquidationLevels",
                params={"coin": base, "exchange": "binance_perp_stable", "leverage": "all", "position": "all", "timestamp": int(time.time())},
                headers={"x-api-key": HYBLOCK_API_KEY, "Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            body = r.json()
            set_source("Hyblock", "connected", "liquidation levels OK")
            return {"enabled": True, "data": body.get("data", []), "reason": "provider data"}
    except Exception as exc:
        set_source("Hyblock", "error", f"levels: {type(exc).__name__}: {exc}")
        return {"enabled": True, "data": [], "reason": str(exc)}


def signal(symbol: str) -> dict[str, Any]:
    st = market[symbol]
    price_points = [v for _, v in prices[symbol]]
    long_liq, short_liq = liquidation_stats(symbol, 5)
    delta_cvd = cvd_delta(symbol, 5)
    data_ready = st.price > 0 and len(price_points) >= 20
    components = {"trend": 0.0, "liquidations": 0.0, "funding": 0.0, "cvd": 0.0, "orderbook": st.book_imbalance}
    if not data_ready:
        return {
            "symbol": symbol, "direction": "INSUFFICIENT_DATA", "score": None, "confidence": 0,
            "components": components, "longLiquidated5m": long_liq, "shortLiquidated5m": short_liq,
            "caution": "Esperando datos reales suficientes de los exchanges.", "updated": now_ms(),
        }

    recent_prices = price_points[-20:]
    trend = (recent_prices[-1] / recent_prices[0] - 1) * 1000
    components["trend"] = clamp(trend, -1, 1)
    liq_imb = (short_liq - long_liq) / max(long_liq + short_liq, 1.0) if (long_liq + short_liq) > 0 else 0
    components["liquidations"] = clamp(liq_imb, -1, 1)
    components["funding"] = clamp(-st.funding * 5000, -1, 1)
    components["cvd"] = clamp(math.tanh(delta_cvd / max(abs(st.cvd_usd) * 0.05, 1_000_000)), -1, 1)

    raw = (
        0.30 * components["trend"]
        + 0.25 * components["liquidations"]
        + 0.15 * components["funding"]
        + 0.20 * components["cvd"]
        + 0.10 * components["orderbook"]
    )
    score = clamp(50 + raw * 50, 0, 100)
    direction = "LONG_BIAS" if score >= 58 else "SHORT_BIAS" if score <= 42 else "NEUTRAL"
    evidence = sum(1 for v in components.values() if abs(v) > 0.15)
    confidence = int(clamp(abs(score - 50) * 1.5 + evidence * 4, 0, 90))
    return {
        "symbol": symbol, "direction": direction, "score": round(score, 1), "confidence": confidence,
        "components": {k: round(v, 4) for k, v in components.items()},
        "longLiquidated5m": round(long_liq, 2), "shortLiquidated5m": round(short_liq, 2),
        "caution": "Sesgo probabilístico basado solo en datos observados; no garantiza dirección futura.", "updated": now_ms(),
    }

# =========================
# API
# =========================
app = FastAPI(title="LIQ-RADAR", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
async def health():
    return {
        "ok": True, "time": now_ms(), "symbols": SYMBOLS,
        "liquidations": len(liq_events), "trades": len(trade_events),
        "sources": {k: asdict(v) for k, v in source.items()},
    }


@app.get("/api/overview")
async def overview(symbol: str = Query(DEFAULT_SYMBOL)):
    s = symbol.upper() if symbol.upper() in market else DEFAULT_SYMBOL
    st = market[s]
    long5, short5 = liquidation_stats(s, 5)
    st.liq_long_5m = long5; st.liq_short_5m = short5; st.cvd_5m_usd = cvd_delta(s, 5)
    clusters = cluster_liquidations(s)
    return {
        "symbol": s,
        "market": asdict(st),
        "signal": signal(s),
        "clusters": clusters,
        "future_pools": [],
        "pool_status": {"available": False, "reason": "Sin niveles predictivos ficticios. Configura un proveedor que exponga niveles, como Hyblock, para mostrarlos."},
        "sources": {k: asdict(v) for k, v in source.items()},
    }


@app.get("/api/liquidations")
async def liquidations(symbol: str = Query(DEFAULT_SYMBOL), minutes: int = Query(60, ge=1, le=1440)):
    data = [asdict(x) for x in get_recent(symbol.upper(), minutes)]
    data.sort(key=lambda x: x["ts"], reverse=True)
    return {"symbol": symbol.upper(), "minutes": minutes, "data": data[:5000], "source": "exchange public liquidation streams"}


@app.get("/api/hyblock-levels")
async def hyblock_levels(symbol: str = Query(DEFAULT_SYMBOL)):
    return await fetch_hyblock_liq_levels(symbol.upper())


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept(); clients.add(ws)
    try:
        while True:
            await asyncio.sleep(2)
            data = {}
            for s in SYMBOLS:
                st = market[s]
                long5, short5 = liquidation_stats(s, 5)
                st.liq_long_5m = long5; st.liq_short_5m = short5; st.cvd_5m_usd = cvd_delta(s, 5)
                data[s] = {"market": asdict(st), "signal": signal(s)}
            await ws.send_text(json.dumps({"type": "snapshot", "data": data, "sources": {k: asdict(v) for k, v in source.items()}}, separators=(",", ":")))
    except WebSocketDisconnect:
        clients.discard(ws)
    except Exception:
        clients.discard(ws)


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = [
        asyncio.create_task(binance_liquidations()),
        asyncio.create_task(binance_trades()),
        asyncio.create_task(binance_book()),
        asyncio.create_task(bybit_ws()),
        asyncio.create_task(okx_ws()),
        asyncio.create_task(metrics_loop()),
    ]
    if not (HYBLOCK_API_KEY and HYBLOCK_CLIENT_ID and HYBLOCK_CLIENT_SECRET):
        set_source("Hyblock", "disabled", "No credentials configured")
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app.router.lifespan_context = lifespan
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
