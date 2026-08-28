import type { MarketApi } from "../lib/market";
import { fmtCompact, fmtCountdown, fmtPct, fmtPrice } from "../lib/format";

function RadarMark() {
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden="true">
      <circle cx="23" cy="23" r="21" stroke="#fbbf24" strokeOpacity="0.5" strokeWidth="1.5" />
      <circle cx="23" cy="23" r="13" stroke="#2dd4bf" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx="23" cy="23" r="5.5" stroke="#fbbf24" strokeOpacity="0.3" strokeWidth="1" />
      <g className="radar-sweep">
        <path d="M23 23 L23 2 A21 21 0 0 1 37.8 8.2 Z" fill="#fbbf24" fillOpacity="0.16" />
        <line x1="23" y1="23" x2="23" y2="2" stroke="#fbbf24" strokeWidth="1.6" />
      </g>
      <circle cx="31" cy="15" r="2" fill="#2dd4bf">
        <animate attributeName="opacity" values="1;0.15;1" dur="2.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="15" cy="30" r="1.6" fill="#fb7185">
        <animate attributeName="opacity" values="0.2;1;0.2" dur="1.7s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function StatusBadge({
  status,
  reconnect,
}: {
  status: MarketApi["status"];
  reconnect: () => void;
}) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 border border-gain-400/30 bg-gain-400/8 px-3 py-1.5">
        <span className="ping-ring inline-block h-2 w-2 rounded-full bg-gain-400 text-gain-400" />
        <span className="font-display text-[11px] font-semibold tracking-[0.22em] text-gain-400">
          EN VIVO
        </span>
      </div>
    );
  }
  if (status === "sim") {
    return (
      <button
        onClick={reconnect}
        title="Reintentar conexión con Binance"
        className="group flex items-center gap-2 border border-short-400/40 bg-short-400/8 px-3 py-1.5 transition-colors hover:bg-short-400/15"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-short-400" />
        <span className="font-display text-[11px] font-semibold tracking-[0.22em] text-short-300">
          SIMULADO
        </span>
        <span className="font-mono text-[10px] text-fog-600 transition-colors group-hover:text-fog-300">
          ⟳ reintentar
        </span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 border border-line px-3 py-1.5">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-fog-500" />
      <span className="font-display text-[11px] font-semibold tracking-[0.22em] text-fog-500">
        CONECTANDO
      </span>
    </div>
  );
}

export default function Header({ m }: { m: MarketApi }) {
  const { price, dir, change24h, high24h, low24h, volume24h, fundingRate, nextFunding, status, reconnect, nowTs } = m;
  const up = (change24h ?? 0) >= 0;

  return (
    <header className="relative z-10">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 py-6 md:py-8">
        {/* brand */}
        <div className="flex items-center gap-4">
          <RadarMark />
          <div>
            <h1 className="font-display text-2xl font-bold leading-none tracking-[0.14em] text-fog-100">
              LIQ<span className="text-short-400">RADAR</span>
            </h1>
            <p className="mt-1.5 font-mono text-[10px] tracking-[0.28em] text-fog-600">
              TERMINAL DE LIQUIDACIONES · BTCUSDT PERP
            </p>
          </div>
        </div>

        {/* price */}
        <div className="order-last w-full md:order-none md:w-auto">
          <p className="font-mono text-[10px] tracking-[0.28em] text-fog-600">PRECIO DE MARCA</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span
              key={`${price}-${dir}`}
              className={`font-mono text-5xl font-bold tabular-nums tracking-tight text-fog-100 md:text-6xl ${
                dir === "up" ? "tick-up" : dir === "down" ? "tick-down" : ""
              }`}
            >
              {price ? fmtPrice(price) : "——.———,—"}
              <span className="ml-2 text-xl font-medium text-fog-600 md:text-2xl">$</span>
            </span>
            {change24h !== null && (
              <span
                className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-sm font-semibold tabular-nums ${
                  up
                    ? "border-gain-400/30 bg-gain-400/8 text-gain-400"
                    : "border-loss-400/30 bg-loss-400/8 text-loss-400"
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d={up ? "M5 1 L9 8 L1 8 Z" : "M5 9 L1 2 L9 2 Z"}
                    fill="currentColor"
                  />
                </svg>
                {fmtPct(change24h)} 24h
              </span>
            )}
          </div>
        </div>

        {/* market data + status */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-xs tabular-nums">
            <span className="text-[10px] tracking-[0.22em] text-fog-600">MÁX 24H</span>
            <span className="text-right text-fog-300">{high24h ? fmtPrice(high24h) : "—"}</span>
            <span className="text-[10px] tracking-[0.22em] text-fog-600">MÍN 24H</span>
            <span className="text-right text-fog-300">{low24h ? fmtPrice(low24h) : "—"}</span>
            <span className="text-[10px] tracking-[0.22em] text-fog-600">VOL 24H</span>
            <span className="text-right text-fog-300">{volume24h ? fmtCompact(volume24h) : "—"}</span>
          </div>
          <div className="font-mono text-xs tabular-nums">
            <p className="text-[10px] tracking-[0.22em] text-fog-600">FUNDING · 8H</p>
            <p
              className={`mt-1 text-lg font-semibold ${
                (fundingRate ?? 0) >= 0 ? "text-long-300" : "text-loss-400"
              }`}
            >
              {fundingRate !== null ? fmtPct(fundingRate * 100, 4) : "—"}
            </p>
            {nextFunding !== null && (
              <p className="mt-0.5 text-[11px] text-fog-500">
                en <span className="text-fog-100">{fmtCountdown(nextFunding - nowTs)}</span>
              </p>
            )}
          </div>
          <StatusBadge status={status} reconnect={reconnect} />
        </div>
      </div>
    </header>
  );
}
