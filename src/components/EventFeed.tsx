import type { MarketApi } from "../lib/market";
import { fmtAgo, fmtBtc, fmtClock, fmtCompact, fmtPrice } from "../lib/format";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <circle cx="36" cy="36" r="32" stroke="#24345a" strokeWidth="1.5" />
        <circle cx="36" cy="36" r="20" stroke="#24345a" strokeWidth="1" strokeDasharray="3 5" />
        <g className="radar-sweep">
          <path d="M36 36 L36 4 A32 32 0 0 1 58.6 13.4 Z" fill="#2dd4bf" fillOpacity="0.12" />
          <line x1="36" y1="36" x2="36" y2="4" stroke="#2dd4bf" strokeWidth="1.5" />
        </g>
        <circle cx="36" cy="36" r="2.5" fill="#2dd4bf" />
      </svg>
      <div>
        <p className="font-display text-sm font-semibold tracking-[0.18em] text-fog-300">
          ESCANEANDO ÓRDENES FORZADAS
        </p>
        <p className="mx-auto mt-2 max-w-[300px] font-mono text-[11px] leading-relaxed text-fog-600">
          El stream de Binance muestrea liquidaciones de todos los mercados; las de BTCUSDT
          aparecerán aquí al ejecutarse.
        </p>
      </div>
    </div>
  );
}

export default function EventFeed({ m }: { m: MarketApi }) {
  const { events, paused, setPaused, nowTs } = m;

  return (
    <section className="panel panel-corners flex min-h-0 flex-1 flex-col" aria-label="Cascada de liquidaciones">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.18em] text-fog-100">
            CASCADA EN VIVO
          </h2>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-fog-600">
            ÓRDENES FORZADAS · BTCUSDT
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="border border-line px-2 py-1 font-mono text-[10px] tabular-nums text-fog-500">
            {events.length} en buffer
          </span>
          <button
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "Reanudar feed" : "Pausar feed"}
            title={paused ? "Reanudar feed" : "Pausar feed"}
            className={`border p-1.5 transition-colors ${
              paused
                ? "border-short-400/50 bg-short-400/10 text-short-300"
                : "border-line text-fog-500 hover:border-fog-600 hover:text-fog-100"
            }`}
          >
            {paused ? (
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1 L11 6 L2 11 Z" fill="currentColor" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="2" y="1" width="3" height="10" fill="currentColor" />
                <rect x="7" y="1" width="3" height="10" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {paused && (
        <div className="flex items-center gap-2 border-b border-short-400/30 bg-short-400/8 px-5 py-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-short-400" />
          <span className="font-mono text-[10px] tracking-[0.2em] text-short-300">
            FEED EN PAUSA — las estadísticas siguen contando
          </span>
        </div>
      )}

      <div className="max-h-[520px] min-h-[280px] flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-line/60">
            {events.map((ev, i) => {
              const long = ev.side === "SELL";
              const whale = ev.usd >= 250_000;
              const mega = ev.usd >= 1_000_000;
              return (
                <li
                  key={ev.id}
                  className={`feed-item group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-ink-700/35 ${
                    i === 0 ? "bg-ink-800/60" : ""
                  } ${whale ? "border-l-2 border-l-short-400" : "border-l-2 border-l-transparent"}`}
                >
                  <span className="w-[62px] shrink-0 font-mono text-[10px] tabular-nums text-fog-600">
                    {fmtClock(ev.time)}
                  </span>
                  <span
                    className={`w-[64px] shrink-0 border px-1.5 py-0.5 text-center font-display text-[10px] font-bold tracking-[0.14em] ${
                      long
                        ? "border-loss-400/40 bg-loss-500/10 text-loss-400"
                        : "border-gain-400/40 bg-gain-400/10 text-gain-400"
                    }`}
                  >
                    {long ? "LONG" : "SHORT"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-semibold tabular-nums text-fog-100">
                      {fmtCompact(ev.usd)}
                    </span>
                    <span className="block font-mono text-[10px] tabular-nums text-fog-600">
                      {fmtBtc(ev.qty)} · @ {fmtPrice(ev.price)}
                    </span>
                  </span>
                  {mega && (
                    <span className="shrink-0 border border-short-400/50 bg-short-400/10 px-1.5 py-0.5 font-display text-[9px] font-bold tracking-[0.18em] text-short-300">
                      MEGA
                    </span>
                  )}
                  {!mega && whale && (
                    <span className="shrink-0 border border-short-400/40 px-1.5 py-0.5 font-display text-[9px] font-bold tracking-[0.18em] text-short-300/90">
                      BALLENA
                    </span>
                  )}
                  <span className="w-[74px] shrink-0 text-right font-mono text-[10px] text-fog-600">
                    {fmtAgo(ev.time, nowTs)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
