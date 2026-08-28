import { useMemo } from "react";
import type { Ladder, LadderLevel } from "../lib/heatmap";
import { fmtCompact, fmtPct, fmtPrice } from "../lib/format";

export type Marker = { price: number; side: "long" | "short" } | null;

type RowDatum =
  | { kind: "level"; level: LadderLevel }
  | { kind: "marker"; price: number };

function LevelRow({ level, side, refPrice }: { level: LadderLevel; side: "above" | "below"; refPrice: number }) {
  const isAbove = side === "above";
  const width = 6 + level.intensity * 94;
  const dist = ((level.price - refPrice) / refPrice) * 100;
  const fill = isAbove
    ? "linear-gradient(90deg, rgba(245,158,11,0.10), rgba(251,191,36,0.55) 60%, rgba(252,211,77,0.9))"
    : "linear-gradient(90deg, rgba(20,184,166,0.10), rgba(45,212,191,0.55) 60%, rgba(94,234,212,0.9))";
  const tagColor = isAbove ? "text-short-300" : "text-long-300";

  return (
    <div
      className="group grid h-[27px] grid-cols-[92px_1fr_70px] items-center gap-2 px-2 transition-colors duration-200 hover:bg-ink-700/35"
      title={`≈ ${fmtCompact(level.estUsd)} · a ${fmtPct(dist)} del precio de marca`}
    >
      <span
        className={`text-right font-mono text-[11px] tabular-nums transition-colors ${
          isAbove ? "text-short-300/85" : "text-long-300/85"
        } group-hover:text-fog-100`}
      >
        {fmtPrice(level.price)}
      </span>
      <span className="relative block h-[13px] border border-line/50 bg-ink-900/70">
        <span
          className="liq-bar bar-anim absolute inset-y-0 left-0"
          style={{ width: `${width}%`, background: fill, boxShadow: `0 0 ${8 + level.intensity * 10}px ${isAbove ? "rgba(251,191,36,0.20)" : "rgba(45,212,191,0.20)"}` }}
        />
        {level.tags.length > 0 && (
          <span className={`absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[9px] font-semibold tracking-wider ${tagColor}`}>
            {level.tags.join(" · ")}
          </span>
        )}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-fog-600 transition-colors group-hover:text-fog-300">
        {fmtCompact(level.estUsd)}
      </span>
    </div>
  );
}

function MarkerRow({ price, refPrice }: { price: number; refPrice: number }) {
  const dist = ((price - refPrice) / refPrice) * 100;
  return (
    <div
      className="grid h-[27px] grid-cols-[92px_1fr_70px] items-center gap-2 border border-dashed border-loss-400/60 bg-loss-500/8 px-2"
      title={`Tu liquidación estimada · a ${fmtPct(dist)} del precio de marca`}
    >
      <span className="text-right font-mono text-[11px] font-bold tabular-nums text-loss-400">
        {fmtPrice(price)}
      </span>
      <span className="flex items-center gap-2">
        <span className="h-[3px] flex-1" style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(251,113,133,0.8) 0 6px, transparent 6px 11px)" }} />
        <span className="font-display text-[9px] font-bold tracking-[0.2em] text-loss-400">TU LIQ</span>
      </span>
      <span className="font-mono text-[10px] font-semibold tabular-nums text-loss-400">{fmtPct(dist)}</span>
    </div>
  );
}

export default function LiquidationMap({
  price,
  ladder,
  marker,
}: {
  price: number;
  ladder: Ladder;
  marker: Marker;
}) {
  const aboveRows = useMemo<RowDatum[]>(() => {
    const rows: RowDatum[] = ladder.above.map((level) => ({ kind: "level", level }));
    if (marker && price && marker.price > price) {
      const idx = rows.findIndex((r) => r.kind === "level" && r.level.price > marker.price);
      rows.splice(idx === -1 ? rows.length : idx, 0, { kind: "marker", price: marker.price });
    }
    return rows.reverse(); // far -> near, reading top-down into the pin
  }, [ladder, marker, price]);

  const belowRows = useMemo<RowDatum[]>(() => {
    const rows: RowDatum[] = ladder.below.map((level) => ({ kind: "level", level }));
    if (marker && price && marker.price < price) {
      const idx = rows.findIndex((r) => r.kind === "level" && r.level.price < marker.price);
      rows.splice(idx === -1 ? rows.length : idx, 0, { kind: "marker", price: marker.price });
    }
    return rows; // near -> far, reading away from the pin
  }, [ladder, marker, price]);

  const renderRow = (row: RowDatum, side: "above" | "below", key: string) =>
    row.kind === "marker" ? (
      <MarkerRow key={key} price={row.price} refPrice={price} />
    ) : (
      <LevelRow key={key} level={row.level} side={side} refPrice={price} />
    );

  return (
    <section className="panel panel-corners flex h-full flex-col" aria-label="Mapa de liquidaciones">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.18em] text-fog-100">
            MAPA DE LIQUIDACIONES
          </h2>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-fog-600">
            NIVELES ESTIMADOS · CUBOS DE 60 USDT · ±5 %
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-[10px] tracking-wider">
          <span className="flex items-center gap-1.5 text-short-300">
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 0 L8 7 L0 7 Z" fill="currentColor" /></svg>
            LIQ. SHORTS · al subir
          </span>
          <span className="flex items-center gap-1.5 text-long-300">
            <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 8 L0 1 L8 1 Z" fill="currentColor" /></svg>
            LIQ. LONGS · al bajar
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto py-3">
        {/* shorts (above) */}
        <div className="space-y-[3px]">
          {aboveRows.map((row, i) =>
            renderRow(row, "above", row.kind === "marker" ? "marker" : `a-${row.level.price}-${i}`)
          )}
        </div>

        {/* price pin */}
        <div className="relative my-3 flex items-center gap-3 px-3">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-short-400/60 to-fog-500/50" />
          <div className="flex items-center gap-3 border border-fog-500/30 bg-ink-800/90 px-4 py-2 shadow-[0_0_30px_rgba(148,170,205,0.12)]">
            <span className="ping-ring inline-block h-2 w-2 rounded-full bg-fog-100 text-fog-300" />
            <div className="text-center">
              <p className="font-mono text-[8px] tracking-[0.3em] text-fog-600">PRECIO DE MARCA</p>
              <p className="font-mono text-xl font-bold leading-tight tabular-nums text-fog-100">
                {price ? fmtPrice(price) : "—"}
              </p>
            </div>
            <span className="ping-ring inline-block h-2 w-2 rounded-full bg-fog-100 text-fog-300" />
          </div>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent via-long-400/60 to-fog-500/50" />
        </div>

        {/* longs (below) */}
        <div className="space-y-[3px]">
          {belowRows.map((row, i) =>
            renderRow(row, "below", row.kind === "marker" ? "marker" : `b-${row.level.price}-${i}`)
          )}
        </div>
      </div>

      <footer className="border-t border-line px-5 py-2.5">
        <p className="font-mono text-[10px] leading-relaxed text-fog-600">
          Intensidad = concentración estimada de posiciones apalancadas. Las bandas{" "}
          <span className="text-short-300">10×–100×</span> se recalculan sobre el precio de marca;{" "}
          <span className="text-fog-300">redondo</span> = imán de números redondos,{" "}
          <span className="text-fog-300">ejecutada</span> = liquidación reciente en la zona.
        </p>
      </footer>
    </section>
  );
}
