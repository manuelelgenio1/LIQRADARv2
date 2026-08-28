import type { LiqEvent } from "../lib/market";
import { fmtClock, fmtCompact, fmtPrice } from "../lib/format";

type Props = { events: LiqEvent[] };

function TapeItem({ ev }: { ev: LiqEvent }) {
  const long = ev.side === "SELL";
  return (
    <span className="inline-flex items-center gap-2 px-4 font-mono text-[11px] tracking-wide text-fog-300">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          long ? "bg-loss-400" : "bg-gain-400"
        }`}
      />
      <span className={long ? "text-loss-400" : "text-gain-400"}>
        {long ? "LONG" : "SHORT"} LIQ
      </span>
      <span className="font-semibold text-fog-100">{fmtCompact(ev.usd)}</span>
      <span className="text-fog-600">@ {fmtPrice(ev.price)}</span>
      <span className="text-fog-600">{fmtClock(ev.time)}</span>
      <span className="pl-3 text-[8px] text-ink-600">◆</span>
    </span>
  );
}

export default function TickerTape({ events }: Props) {
  const items = events.slice(0, 16);
  return (
    <div className="sticky top-0 z-40 border-b border-line bg-ink-950/92 backdrop-blur-sm">
      <div className="relative h-9 overflow-hidden">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 font-mono text-[11px] tracking-[0.18em] text-fog-600">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-short-400" />
            ESCANEANDO LIQUIDACIONES EN BINANCE FUTURES
            <span className="blink-caret text-short-400">▊</span>
          </div>
        ) : (
          <div className="tape-track h-full items-center">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex items-center" aria-hidden={dup === 1}>
                {items.map((ev) => (
                  <TapeItem key={`${dup}-${ev.id}`} ev={ev} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
