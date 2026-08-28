/* ============================================================
 * LIQRADAR — Terminal de liquidaciones (reestructurado)
 *
 * La idea ya no es "un dashboard de paneles iguales" sino un
 * instrumento causal de una sola pantalla:
 *
 *   PRESIÓN (qué empuja)  →  RADAR (dónde está el combustible y
 *   qué se está quemando)  →  QUEMAS (el efecto observado)
 *
 * El radar circular es el centro: arcos = clústeres estimados,
 * blips = liquidaciones observadas, núcleo = precio + veredicto.
 * ============================================================ */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useRadar } from "./lib/store";
import type { EngineOutput } from "./lib/store";
import type { JournalEntry, LiqEvent, Mode, SourceHealth } from "./types";
import {
  formatClock, formatCountdown, formatPercent, formatPercentRaw,
  formatPrice, formatUsd,
} from "./lib/safe";
import Radar from "./components/Radar";
import { Bar, BipolarBar, Chip, Panel, Reveal, Row, TruthBadge } from "./components/ui";

/* ------------------------------ Error Boundary ------------------------------ */

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("LIQRADAR:", error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
          <div className="panel corner-frame w-full max-w-xl p-8">
            <p className="font-display text-lg font-bold tracking-[0.2em] text-danger-300">RADAR DETENIDO</p>
            <p className="mt-3 font-mono text-xs text-fog-300">{this.state.error.message}</p>
            <button onClick={() => window.location.reload()} className="mt-5 border border-phos-400/50 bg-phos-400/10 px-4 py-2 font-display text-[10px] font-bold tracking-[0.2em] text-phos-300 hover:bg-phos-400/20">
              REINICIAR
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------ utilidades ------------------------------ */

const dirTone = (d: string): "phos" | "danger" | "fog" =>
  d === "LONG" ? "phos" : d === "SHORT" ? "danger" : "fog";

const STATUS_STYLE: Record<SourceHealth["status"], string> = {
  LIVE: "border-phos-400/50 text-phos-300",
  DEGRADED: "border-amberx-400/50 text-amberx-300",
  UNAVAILABLE: "border-line text-fog-600",
};

/* ------------------------------ header ------------------------------ */

function Header({
  mode, setMode, price, tickDir, changePct, fundingRate, nextFundingTime, now, liveCount, total,
}: {
  mode: Mode; setMode: (m: Mode) => void; price: number; tickDir: "up" | "down" | "none";
  changePct: number; fundingRate: number; nextFundingTime: number; now: number; liveCount: number; total: number;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-950/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          <RadarGlyph />
          <div>
            <p className="font-display text-lg font-extrabold leading-none tracking-[0.26em] text-fog-100">
              LIQ<span className="text-phos-400">RADAR</span>
            </p>
            <p className="mt-0.5 font-mono text-[8px] tracking-[0.3em] text-fog-600">RADAR DE LIQUIDACIONES · BTC</p>
          </div>
        </div>

        <div className="flex items-baseline gap-3">
          <span key={`${price}-${tickDir}`} className={`font-mono text-2xl font-bold tabular-nums text-fog-100 md:text-3xl ${tickDir === "up" ? "tick-up" : tickDir === "down" ? "tick-down" : ""}`}>
            {price > 0 ? formatPrice(price, 0) : "—"}
          </span>
          <span className={`font-mono text-xs font-semibold tabular-nums ${changePct >= 0 ? "text-phos-300" : "text-danger-300"}`}>
            {formatPercent(changePct)}
          </span>
        </div>

        <div className="hidden items-center gap-4 lg:flex">
          <div>
            <p className="font-mono text-[8px] tracking-[0.24em] text-fog-600">FUNDING</p>
            <p className="font-mono text-xs font-semibold tabular-nums text-fog-100">
              {formatPercent(fundingRate * 100, 4)} <span className="text-info-300">{formatCountdown(nextFundingTime - now)}</span>
            </p>
          </div>
          <div>
            <p className="font-mono text-[8px] tracking-[0.24em] text-fog-600">FUENTES</p>
            <p className={`font-mono text-xs font-semibold tabular-nums ${liveCount > 0 ? "text-phos-300" : "text-danger-300"}`}>{liveCount}/{total}</p>
          </div>
        </div>

        <div className="ml-auto grid grid-flow-col border border-line bg-ink-900 p-0.5">
          {(["REAL", "DEMO"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3.5 py-1.5 font-display text-[10px] font-bold tracking-[0.22em] transition-all ${
                mode === m
                  ? m === "REAL" ? "bg-phos-400/15 text-phos-300 shadow-[inset_0_0_0_1px_rgba(61,245,165,0.5)]"
                    : "demo-stripes bg-amberx-400/15 text-amberx-300 shadow-[inset_0_0_0_1px_rgba(255,176,32,0.5)]"
                  : "text-fog-600 hover:text-fog-300"}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function RadarGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="21" stroke="#3df5a5" strokeWidth="1.6" opacity="0.9" />
      <circle cx="24" cy="24" r="13" stroke="#3df5a5" strokeWidth="1" strokeDasharray="3 5" opacity="0.6" />
      <g className="radar-rotor">
        <path d="M24 24 L24 3 A21 21 0 0 1 38.8 9.2 Z" fill="#3df5a5" fillOpacity="0.14" />
        <line x1="24" y1="24" x2="24" y2="3" stroke="#3df5a5" strokeWidth="1.8" />
      </g>
      <circle cx="31" cy="17" r="2" fill="#ffb020" />
      <circle cx="17" cy="30" r="1.6" fill="#ff4d6d" />
      <circle cx="24" cy="24" r="2.2" fill="#3df5a5" />
    </svg>
  );
}

/* ------------------------------ evidencia: presión ------------------------------ */

function PressurePanel({ out }: { out: EngineOutput }) {
  const c = out.ctx;
  return (
    <Panel title="PRESIÓN · QUÉ EMPUJA" truth={c.hasFut ? "REAL" : "UNAVAILABLE"}>
      <div className="px-5 pb-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[9px] tracking-[0.18em] text-fog-600">CVD FUTUROS (5m)</span>
          <span className={`font-mono text-sm font-bold tabular-nums ${c.futCvdUsd >= 0 ? "text-phos-300" : "text-danger-300"}`}>{formatUsd(c.futCvdUsd)}</span>
        </div>
        <BipolarBar value={c.futFeat.value} />

        <div className="mt-3 mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[9px] tracking-[0.18em] text-fog-600">CVD SPOT (5m)</span>
          <span className={`font-mono text-sm font-bold tabular-nums ${c.spotCvdUsd >= 0 ? "text-phos-300" : "text-danger-300"}`}>{formatUsd(c.spotCvdUsd)}</span>
        </div>
        <BipolarBar value={c.spotFeat.value} />

        <div className="mt-4">
          <Row label="TAKER BUY/SELL" value={c.taker.feature.value.toFixed(2)} tone={c.taker.imbalance >= 0 ? "phos" : "danger"} />
          <Row label="DESEQUILIBRIO L2" value={formatPercentRaw(c.book.imbalance * 100, 1)} tone={c.book.imbalance >= 0 ? "phos" : "danger"} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip tone={c.book.absorption.state === "BUY_ABSORPTION" ? "phos" : c.book.absorption.state === "SELL_ABSORPTION" ? "danger" : "fog"}>
            {c.book.absorption.state.replace(/_/g, " ")}
          </Chip>
          <Chip tone={c.book.spoof.level === "HIGH" ? "danger" : c.book.spoof.level === "ELEVATED" ? "amber" : "fog"}>
            SPOOF {c.book.spoof.level}
          </Chip>
          <TruthBadge truth="ESTIMATED" />
        </div>

        {c.divergences.length > 0 && (
          <p className="mt-3 border border-amberx-400/30 bg-amberx-400/5 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-amberx-300">
            ⚠ {c.divergences[0]}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ evidencia: apalancamiento ------------------------------ */

function LeveragePanel({ out, fundingRate }: { out: EngineOutput; fundingRate: number }) {
  const c = out.ctx;
  return (
    <Panel title="APALANCAMIENTO · QUIÉN ESTÁ SUBIDO" truth={c.oi.enough ? "REAL" : "UNAVAILABLE"}>
      <div className="px-5 pb-4">
        <div className="mb-2 flex items-center justify-between">
          <Chip tone={c.oi.regime.includes("LONG") ? "phos" : c.oi.regime.includes("SHORT") ? "danger" : "fog"}>
            OI {c.oi.regime.replace(/_/g, " ")}
          </Chip>
          <span className={`font-mono text-sm font-bold tabular-nums ${c.oi.changePct >= 0 ? "text-phos-300" : "text-danger-300"}`}>
            {formatPercent(c.oi.changePct)}
          </span>
        </div>
        <Bar pct={Math.abs(c.oi.changePct) / 5} tone={c.oi.changePct >= 0 ? "phos" : "danger"} />

        <div className="mt-3">
          <Row label="FUNDING" value={formatPercent(fundingRate * 100, 4)} tone={fundingRate >= 0 ? "phos" : "danger"} />
          <Row label="FUNDING PERCENTIL" value={`p${Math.round(c.funding.percentile * 100)}`} sub={c.funding.state.replace(/_/g, " ")} tone={c.funding.state.includes("EXTREME") ? "amber" : "fog"} />
          <Row label="TOP TRADERS" value={c.positioning.last.toFixed(2)} sub={`z ${c.positioning.z.toFixed(1)} · ${c.positioning.state.replace(/_/g, " ")}`} tone={c.positioning.z >= 0 ? "phos" : "danger"} />
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ veredicto ------------------------------ */

function Verdict({ out }: { out: EngineOutput }) {
  const s = out.signal;
  const tone = dirTone(s.direction);
  return (
    <div className="panel corner-frame px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Chip tone={tone}>{s.direction.replace(/_/g, " ")}</Chip>
          <span className="font-mono text-[10px] tracking-[0.18em] text-fog-600">
            RÉGIMEN <span className="text-fog-300">{s.regime.replace(/_/g, " ")}</span>
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.18em] text-fog-600 sm:inline">
            ESCENARIO <span className="text-fog-300">{s.scenario.replace(/_/g, " ")}</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {s.target !== undefined && (
            <span className="font-mono text-[10px] text-fog-600">OBJETIVO <span className="text-phos-300">{formatPrice(s.target, 0)}</span></span>
          )}
          {s.invalidation !== undefined && (
            <span className="font-mono text-[10px] text-fog-600">INVALIDA <span className="text-danger-300">{formatPrice(s.invalidation, 0)}</span></span>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[9px] tracking-[0.2em] text-fog-600">CONFIANZA CALIBRADA</span>
          <span className="font-mono text-sm font-bold tabular-nums text-fog-100">{Math.round(s.confidence * 100)}%</span>
        </div>
        <div className="mt-1"><Bar pct={s.confidence} tone={tone} /></div>
      </div>

      {s.noTradeReasons.length > 0 && s.direction === "NO_TRADE" && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.noTradeReasons.slice(0, 3).map((r) => (
            <span key={r} className="border border-line bg-ink-800 px-2 py-1 font-mono text-[9px] text-fog-500">{r}</span>
          ))}
        </div>
      )}

      {s.contradictions.length > 0 && (
        <p className="mt-3 border border-amberx-400/30 bg-amberx-400/5 px-2 py-1.5 font-mono text-[9px] leading-relaxed text-amberx-300">
          ⚠ {s.contradictions[0]}
        </p>
      )}
    </div>
  );
}

/* ------------------------------ combustible ------------------------------ */

function FuelLadder({ out, price }: { out: EngineOutput; price: number }) {
  const clusters = out.ctx.clusters;
  if (!clusters.length || !price) return null;
  const above = clusters.filter((c) => c.price > price).sort((a, b) => a.price - b.price).slice(0, 4);
  const below = clusters.filter((c) => c.price < price).sort((a, b) => b.price - a.price).slice(0, 4);
  const maxUsd = Math.max(1, ...clusters.map((c) => c.estimatedUsd));
  const Item = ({ c, side }: { c: (typeof clusters)[number]; side: "up" | "down" }) => (
    <div className="flex items-center gap-2 border-b border-line/40 py-1 last:border-b-0">
      <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-fog-500">{formatPercentRaw(c.distancePct, 1)}</span>
      <span className="w-20 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-fog-100">{formatPrice(c.price, 0)}</span>
      <div className="h-1 flex-1 bg-ink-700">
        <div className={`liq-bar h-full ${side === "up" ? "bg-phos-400" : "bg-danger-400"}`} style={{ width: `${Math.round((c.estimatedUsd / maxUsd) * 100)}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-fog-500">{formatUsd(c.estimatedUsd)}</span>
    </div>
  );
  return (
    <Panel title="COMBUSTIBLE · DÓNDE QUEMA" truth="ESTIMATED">
      <div className="px-5 pb-4">
        <p className="mb-1 font-mono text-[9px] tracking-[0.2em] text-phos-300">▲ ARRIBA (shorts liquidables)</p>
        {above.map((c) => <Item key={`u${c.price}`} c={c} side="up" />)}
        <p className="mt-3 mb-1 font-mono text-[9px] tracking-[0.2em] text-danger-300">▼ ABAJO (longs liquidables)</p>
        {below.map((c) => <Item key={`d${c.price}`} c={c} side="down" />)}
        <p className="mt-3 font-mono text-[8px] leading-relaxed text-fog-600">
          Liquidez de liquidación estimada — no son liquidaciones reales (§70).
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------ quemas en vivo ------------------------------ */

function BurnsPanel({ out, liqs }: { out: EngineOutput; liqs: LiqEvent[] }) {
  const b = out.ctx.burst;
  return (
    <Panel title="QUEMAS EN VIVO" truth={liqs.length ? "REAL" : "UNAVAILABLE"}
      right={<Chip tone={b.state === "NORMAL" ? "fog" : b.state === "ELEVATED" ? "amber" : "danger"}>{b.state.replace(/_/g, " ")} {b.ratio.toFixed(1)}×</Chip>}>
      <div className="px-5 pb-2">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div className="border border-line bg-ink-900 px-2 py-1.5">
            <p className="font-mono text-[8px] tracking-[0.18em] text-fog-600">LONGS QUEMADOS 5m</p>
            <p className="font-mono text-xs font-bold tabular-nums text-danger-300">{formatUsd(b.longUsd)}</p>
          </div>
          <div className="border border-line bg-ink-900 px-2 py-1.5">
            <p className="font-mono text-[8px] tracking-[0.18em] text-fog-600">SHORTS QUEMADOS 5m</p>
            <p className="font-mono text-xs font-bold tabular-nums text-phos-300">{formatUsd(b.shortUsd)}</p>
          </div>
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {liqs.length === 0 ? (
          <p className="px-5 pb-5 pt-2 text-center font-mono text-[10px] tracking-[0.18em] text-fog-600">
            ESCANEANDO ÓRDENES FORZADAS<span className="blink-caret ml-1 text-phos-400">▊</span>
          </p>
        ) : (
          <ul className="divide-y divide-line/40">
            {liqs.slice(0, 16).map((l, i) => {
              const long = l.side === "SELL";
              return (
                <li key={l.id} className={`feed-item flex items-center gap-2 px-5 py-1.5 ${i === 0 ? "bg-ink-800/60" : ""}`}>
                  <span className={`w-12 shrink-0 font-display text-[9px] font-bold tracking-[0.14em] ${long ? "text-danger-300" : "text-phos-300"}`}>
                    {long ? "LONG" : "SHORT"}
                  </span>
                  <span className="min-w-0 flex-1 font-mono text-[11px] font-semibold tabular-nums text-fog-100">{formatUsd(l.usd)}</span>
                  <span className="font-mono text-[9px] tabular-nums text-fog-600">@{formatPrice(l.price, 0)}</span>
                  <span className="w-12 shrink-0 text-right font-mono text-[8px] uppercase text-fog-600">{l.exchange ?? "BN"}</span>
                  <span className="w-14 shrink-0 text-right font-mono text-[9px] tabular-nums text-fog-600">{formatClock(l.ts)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ registro ------------------------------ */

function LogPanel({ journal }: { journal: JournalEntry[] }) {
  const rows = journal.slice(0, 6);
  return (
    <Panel title="REGISTRO · QUÉ DIJO Y QUÉ PASÓ" truth={rows.length ? "REAL" : "UNAVAILABLE"}>
      <div className="px-5 pb-4">
        {rows.length === 0 ? (
          <p className="py-2 text-center font-mono text-[10px] tracking-[0.18em] text-fog-600">SIN SEÑALES AÚN</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((e) => {
              const o = e.outcomes["+15m"];
              const verdict = !o ? "…" : o.ambiguous ? "AMB" : o.hitTarget ? "HIT" : o.hitInvalidation ? "MISS" : "OPEN";
              const vTone = verdict === "HIT" ? "text-phos-300" : verdict === "MISS" ? "text-danger-300" : verdict === "AMB" ? "text-amberx-300" : "text-fog-600";
              return (
                <li key={e.id} className="flex items-center gap-2 border-b border-line/40 py-1 last:border-b-0">
                  <span className="w-14 shrink-0 font-mono text-[9px] tabular-nums text-fog-600">{formatClock(e.ts)}</span>
                  <span className={`w-14 shrink-0 font-display text-[9px] font-bold tracking-[0.12em] ${e.direction === "LONG" ? "text-phos-300" : e.direction === "SHORT" ? "text-danger-300" : "text-fog-500"}`}>
                    {e.direction.replace(/_/g, " ")}
                  </span>
                  <span className="flex-1 font-mono text-[9px] tabular-nums text-fog-500">{Math.round(e.confidence * 100)}%</span>
                  {e.demo && <Chip tone="amber">DEMO</Chip>}
                  <span className={`w-10 shrink-0 text-right font-mono text-[10px] font-bold ${vTone}`}>{verdict}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ salud de fuentes ------------------------------ */

function HealthStrip({ health }: { health: SourceHealth[] }) {
  return (
    <div className="panel px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-display text-[9px] font-bold tracking-[0.24em] text-fog-500">DATA HEALTH</span>
        <span className="font-mono text-[9px] text-fog-600">{health.filter((h) => h.status === "LIVE").length} LIVE</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {health.map((h) => (
          <span key={h.id} title={`${h.label} · ${h.status}${h.ageMs !== undefined ? ` · ${Math.round(h.ageMs / 1000)}s` : ""}`}
            className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[8px] tracking-[0.1em] ${STATUS_STYLE[h.status]}`}>
            <i className={`inline-block h-1.5 w-1.5 rounded-full ${h.status === "LIVE" ? "bg-phos-400 pulse-dot" : h.status === "DEGRADED" ? "bg-amberx-400" : "bg-fog-600"}`} />
            {h.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ terminal ------------------------------ */

function Terminal() {
  const { state, setMode } = useRadar();

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink-950">
        <RadarGlyph />
        <p className="font-mono text-xs tracking-[0.3em] text-fog-500">INICIANDO RADAR<span className="blink-caret ml-1 text-phos-400">▊</span></p>
      </div>
    );
  }

  const demo = state.mode === "DEMO";
  const out = state.engine;
  const liveCount = state.health.filter((h) => h.status === "LIVE").length;
  const noData = !out && state.now - state.startedAt >= 8000 && liveCount === 0;

  return (
    <div className="min-h-screen">
      <div className="grid-overlay pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
      <div className="scanlines pointer-events-none fixed inset-0 z-50" aria-hidden="true" />
      <div className="sweep-band pointer-events-none fixed inset-0 z-0" aria-hidden="true" />

      <div className="relative z-10">
        <Header mode={state.mode} setMode={setMode} price={state.price} tickDir={state.tickDir}
          changePct={state.changePct} fundingRate={state.fundingRate} nextFundingTime={state.nextFundingTime}
          now={state.now} liveCount={liveCount} total={state.health.length} />

        {demo && (
          <div className="demo-stripes border-b border-amberx-400/40 bg-amberx-400/10">
            <p className="mx-auto max-w-[1600px] px-4 py-1.5 text-center font-display text-[10px] font-bold tracking-[0.26em] text-amberx-300">
              MODO DEMO — DATOS SIMULADOS Y ETIQUETADOS · NO ALIMENTA EL REGISTRO REAL
            </p>
          </div>
        )}

        <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 md:px-6">
          {noData && (
            <div className="panel corner-frame border-danger-400/40 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-display text-sm font-bold tracking-[0.2em] text-danger-300">SIN CONEXIÓN CON LOS EXCHANGES</p>
                  <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-fog-500">
                    Modo REAL: sin datos reales no hay señal — el radar emite <span className="text-amberx-300">NO TRADE</span>.
                    Si tu red bloquea Binance/OKX/Bybit, activa <span className="text-amberx-300">DEMO</span> para ver el instrumento completo.
                  </p>
                </div>
                <button onClick={() => setMode("DEMO")} className="demo-stripes border border-amberx-400/60 bg-amberx-400/10 px-5 py-2.5 font-display text-[11px] font-bold tracking-[0.22em] text-amberx-300 hover:bg-amberx-400/20">
                  ACTIVAR DEMO
                </button>
              </div>
            </div>
          )}

          {!out && !noData && (
            <div className="flex items-center justify-center gap-3 py-16 font-mono text-[11px] tracking-[0.24em] text-fog-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-phos-400" />
              CONECTANDO FUENTES Y CALENTANDO EL MOTOR
            </div>
          )}

          {out && (
            <>
              <div className="grid grid-cols-12 gap-4">
                {/* columna izquierda: causas */}
                <div className="col-span-12 space-y-4 lg:col-span-3">
                  <Reveal><PressurePanel out={out} /></Reveal>
                  <Reveal delay={80}><LeveragePanel out={out} fundingRate={state.fundingRate} /></Reveal>
                </div>

                {/* centro: el radar */}
                <div className="col-span-12 space-y-4 lg:col-span-6">
                  <Reveal>
                    <div className="panel corner-frame px-4 py-5">
                      <Radar price={state.price} clusters={out.ctx.clusters} liqs={state.liqs} signal={out.signal} now={state.now} />
                    </div>
                  </Reveal>
                  <Reveal delay={80}><Verdict out={out} /></Reveal>
                </div>

                {/* columna derecha: efectos */}
                <div className="col-span-12 space-y-4 lg:col-span-3">
                  <Reveal><BurnsPanel out={out} liqs={state.liqs} /></Reveal>
                  <Reveal delay={80}><LogPanel journal={state.journal} /></Reveal>
                </div>
              </div>

              <Reveal><FuelLadder out={out} price={state.price} /></Reveal>
            </>
          )}

          <Reveal><HealthStrip health={state.health} /></Reveal>

          <footer className="border-t border-line pb-8 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[9px] leading-relaxed text-fog-600">
                LIQRADAR es un radar de evidencia, no un oráculo: no adivina el precio. Sin dato crítico ⇒ NO TRADE.
                Los clústeres son estimaciones y nunca se presentan como liquidaciones reales.
              </p>
              <div className="flex items-center gap-2">
                <TruthBadge truth="REAL" /><TruthBadge truth="ESTIMATED" /><TruthBadge truth="PARTIAL" /><TruthBadge truth="UNAVAILABLE" /><TruthBadge truth="DEMO" />
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Terminal />
    </ErrorBoundary>
  );
}
