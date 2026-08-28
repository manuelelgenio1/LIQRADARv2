/* ============================================================
 * LIQRADAR — Paneles (§9/§41/§52/§66/§70)
 * Cada panel muestra su badge de verdad (REAL / ESTIMATED /
 * PARTIAL / UNAVAILABLE / DEMO) y nunca presenta una estimación
 * como observación.
 * ============================================================ */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  AlertItem, Cluster, DataTruth, FeatureResult, JournalEntry, Outcome,
  ReplayFrame, SignalResult, SourceHealth,
} from "../types";
import type { EngineOutput, RadarState } from "../lib/store";
import {
  clamp01, formatAge, formatClock, formatCountdown, formatNumber,
  formatPercent, formatPercentRaw, formatPrice, formatUsd,
} from "../lib/safe";

/* ------------------------------ helpers ------------------------------ */

const TRUTH_STYLE: Record<DataTruth, string> = {
  REAL: "border-phos-400/50 bg-phos-400/10 text-phos-300",
  ESTIMATED: "border-amberx-400/50 bg-amberx-400/10 text-amberx-300",
  PARTIAL: "border-info-400/50 bg-info-400/10 text-info-300",
  UNAVAILABLE: "border-line bg-ink-800 text-fog-600",
  FALLBACK: "border-line bg-ink-800 text-fog-500",
  DEMO: "border-amberx-400/70 bg-amberx-400/15 text-amberx-300",
};

export function TruthBadge({ truth, label }: { truth: DataTruth; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.22em] ${TRUTH_STYLE[truth]}`}>
      {label ?? truth}
    </span>
  );
}

function Panel({
  title, truth, right, children, className,
}: { title: string; truth?: DataTruth; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel corner-frame pt-5 ${className ?? ""}`}>
      <span className="panel-tag">{title}</span>
      {(truth || right) && (
        <div className="mb-3 flex items-center justify-end gap-2 px-5">{right}{truth && <TruthBadge truth={truth} />}</div>
      )}
      {children}
    </section>
  );
}

function Bar({ pct, tone, className }: { pct: number; tone: "phos" | "amber" | "danger" | "info" | "fog"; className?: string }) {
  const bg = { phos: "bg-phos-400", amber: "bg-amberx-400", danger: "bg-danger-400", info: "bg-info-400", fog: "bg-fog-600" }[tone];
  return (
    <div className={`h-1 w-full bg-ink-700 ${className ?? ""}`}>
      <div className={`liq-bar h-full ${bg}`} style={{ width: `${Math.round(clamp01(pct) * 100)}%` }} />
    </div>
  );
}

function Arrow({ dir, size = 10 }: { dir: "up" | "down" | "flat"; size?: number }) {
  if (dir === "flat") return <span className="inline-block h-[2px] bg-fog-600" style={{ width: size }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={`inline-block ${dir === "up" ? "text-phos-400" : "text-danger-400"}`}>
      <path d={dir === "up" ? "M5 0 L10 9 L0 9 Z" : "M5 10 L0 1 L10 1 Z"} fill="currentColor" />
    </svg>
  );
}

function useRevealRef() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("reveal");
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { el.classList.add("is-in"); io.disconnect(); } }),
      { threshold: 0.06 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRevealRef();
  return <div ref={ref} className={className}>{children}</div>;
}

const fmtRegime = (s: string) => s.replace(/_/g, " ");

/* ------------------------------ 1 · SIGNAL (§40/§41) ------------------------------ */

export function SignalPanel({ signal, demo }: { signal: SignalResult | null; demo: boolean }) {
  const dir = signal?.direction ?? "NO_TRADE";
  const conf = signal ? Math.round(signal.confidence * 100) : 0;
  const color = dir === "LONG" ? "text-phos-300" : dir === "SHORT" ? "text-danger-300" : "text-amberx-300";
  const glow = dir === "LONG" ? "phos" : dir === "SHORT" ? "phos-red" : "phos-amber";

  return (
    <Panel title="SEÑAL CALIBRADA" truth={demo ? "DEMO" : signal ? "ESTIMATED" : "UNAVAILABLE"} className="h-full">
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className={`font-display text-4xl font-extrabold tracking-wide md:text-5xl ${color} ${glow}`}>
              {dir === "LONG" ? "LONG ▲" : dir === "SHORT" ? "SHORT ▼" : "NO TRADE"}
            </p>
            <p className="mt-1 font-mono text-[11px] tracking-[0.14em] text-fog-500">
              {signal ? `${fmtRegime(signal.regime)} · ${fmtRegime(signal.scenario)}` : "esperando motor…"}
            </p>
          </div>
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-[210deg]">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#14233d" strokeWidth="9" pathLength={100} strokeDasharray="66.6 100" strokeLinecap="round" />
              <circle
                cx="50" cy="50" r="42" fill="none" strokeWidth="9" pathLength={100} strokeLinecap="round"
                stroke={dir === "LONG" ? "#3df5a5" : dir === "SHORT" ? "#ff4d6d" : "#ffb020"}
                strokeDasharray={`${(signal?.confidence ?? 0) * 66.6} 100`} className="arc-anim"
              />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-mono text-xl font-bold tabular-nums ${color}`}>{conf}%</span>
              <span className="font-mono text-[8px] tracking-[0.2em] text-fog-600">CONF.</span>
            </span>
          </div>
        </div>

        {signal && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line">
              <div className="bg-ink-900 px-4 py-2.5">
                <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">TARGET</p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-phos-300">{formatPrice(signal.target)} $</p>
              </div>
              <div className="bg-ink-900 px-4 py-2.5">
                <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">INVALIDACIÓN</p>
                <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-danger-300">{formatPrice(signal.invalidation)} $</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="font-display text-[10px] font-bold tracking-[0.24em] text-phos-400">EVIDENCIA A FAVOR</p>
                <ul className="mt-1.5 space-y-1">
                  {signal.evidence.slice(0, 6).map((e, i) => (
                    <li key={i} className="flex gap-2 font-mono text-[11px] leading-snug text-fog-300">
                      <span className="text-phos-400">+</span>{e}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-display text-[10px] font-bold tracking-[0.24em] text-amberx-400">EN CONTRA / RIESGO</p>
                <ul className="mt-1.5 space-y-1">
                  {(signal.contradictions.length ? signal.contradictions : ["sin contradicciones detectadas"]).slice(0, 5).map((e, i) => (
                    <li key={i} className="flex gap-2 font-mono text-[11px] leading-snug text-fog-300">
                      <span className="text-amberx-400">−</span>{e}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {dir === "NO_TRADE" && (
              <div className="mt-4 border border-amberx-400/40 bg-amberx-400/8 px-3 py-2.5">
                <p className="font-display text-[10px] font-bold tracking-[0.22em] text-amberx-300">POR QUÉ NO TRADE (§39)</p>
                <ul className="mt-1 space-y-0.5">
                  {signal.noTradeReasons.map((r, i) => (
                    <li key={i} className="font-mono text-[11px] text-fog-300">· {r}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">CALIDAD DE DATOS</p>
                <p className="font-mono text-[11px] font-semibold tabular-nums text-fog-300">{Math.round(signal.dataQuality * 100)}%</p>
              </div>
              <Bar pct={signal.dataQuality} tone={signal.dataQuality > 0.7 ? "phos" : signal.dataQuality > 0.4 ? "amber" : "danger"} className="mt-1" />
            </div>

            <div className="mt-4 border-t border-line pt-3">
              <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">BLOQUES DE EVIDENCIA (§43 · peso dinámico)</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 xl:grid-cols-3">
                {signal.blocks.filter((b) => b.confidence > 0.05).map((b) => (
                  <div key={b.block} className="flex items-center gap-2" title={b.evidence.join(" · ")}>
                    <span className="w-24 shrink-0 truncate font-mono text-[9px] text-fog-500">{b.block.replace(/_/g, " ")}</span>
                    <div className="relative h-1 min-w-0 flex-1 bg-ink-700">
                      <div className="absolute left-1/2 top-[-2px] h-[8px] w-px bg-fog-600/60" />
                      <div
                        className={`absolute top-0 h-full ${b.score >= 0 ? "left-1/2 bg-phos-400" : "right-1/2 bg-danger-400"}`}
                        style={{ width: `${Math.round(Math.abs(b.score) * 50)}%` }}
                      />
                    </div>
                    <TruthBadge truth={b.truth} />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ 2 · DATA HEALTH (§9) ------------------------------ */

export function HealthPanel({ health }: { health: SourceHealth[] }) {
  const live = health.filter((h) => h.status === "LIVE").length;
  const deg = health.filter((h) => h.status === "DEGRADED").length;
  const un = health.length - live - deg;
  const dot = (s: SourceHealth["status"]) =>
    s === "LIVE" ? "bg-phos-400 pulse-dot" : s === "DEGRADED" ? "bg-amberx-400 pulse-dot" : "bg-fog-600";
  return (
    <Panel
      title="DATA HEALTH"
      className="h-full"
      right={
        <span className="font-mono text-[10px] tabular-nums text-fog-500">
          <span className="text-phos-300">{live} LIVE</span> · <span className="text-amberx-300">{deg} DEG</span> · <span className="text-fog-600">{un} OFF</span>
        </span>
      }
    >
      <div className="max-h-[300px] overflow-y-auto px-2 pb-3">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left font-mono text-[8px] tracking-[0.2em] text-fog-600">
              <th className="px-3 py-1 font-medium">FUENTE</th>
              <th className="px-2 py-1 font-medium">LAT</th>
              <th className="px-2 py-1 font-medium">AGE</th>
              <th className="px-2 py-1 font-medium">REC</th>
              <th className="hidden px-2 py-1 font-medium sm:table-cell">SEQ</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.id} className="group border-t border-line/60 transition-colors hover:bg-ink-700/40">
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot(h.status)}`} />
                    <span className="truncate font-mono text-[11px] text-fog-300">{h.label}</span>
                  </span>
                  {(h.error || h.note) && (
                    <span className={`ml-3.5 block max-w-[220px] truncate font-mono text-[9px] ${h.error ? "text-danger-300" : "text-fog-600"}`}>
                      {h.error ?? h.note}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-[10px] tabular-nums text-fog-500">{h.latencyMs !== undefined ? `${h.latencyMs}ms` : "—"}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] tabular-nums text-fog-500">{h.ageMs !== undefined ? formatAge(h.ageMs) : "—"}</td>
                <td className="px-2 py-1.5 font-mono text-[10px] tabular-nums text-fog-500">{h.records > 9999 ? `${(h.records / 1000).toFixed(0)}k` : h.records}</td>
                <td className="hidden px-2 py-1.5 font-mono text-[10px] text-fog-500 sm:table-cell">
                  {h.seq ?? (h.reconnects > 0 ? `re×${h.reconnects}` : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------ 3 · RÉGIMEN (§36) ------------------------------ */

export function RegimePanel({ out }: { out: EngineOutput }) {
  const r = out.regime;
  const bullish = ["TREND_UP", "LONG_BUILD", "SHORT_SQUEEZE", "ACCUMULATION", "EXPANSION"].includes(r.state);
  const bearish = ["TREND_DOWN", "SHORT_BUILD", "LONG_SQUEEZE", "DISTRIBUTION"].includes(r.state);
  const color = r.state === "NEUTRAL" || r.state === "COMPRESSION" ? "text-amberx-300" : bullish ? "text-phos-300" : "text-danger-300";
  return (
    <Panel title="RÉGIMEN DE MERCADO" className="h-full" truth="ESTIMATED">
      <div className="px-5 pb-5">
        <p className={`font-display text-2xl font-extrabold tracking-wide md:text-3xl ${color}`}>{fmtRegime(r.state)}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.18em] text-fog-600">FUERZA {Math.round(r.strength * 100)}</span>
          <Bar pct={r.strength} tone={bullish ? "phos" : bearish ? "danger" : "amber"} className="flex-1" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line">
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">OI RÉGIMEN (§13)</p>
            <p className="mt-0.5 font-mono text-xs font-bold text-fog-100">{fmtRegime(out.ctx.oi.regime)}</p>
            <p className="font-mono text-[10px] tabular-nums text-fog-600">ΔOI 15m {formatPercent(out.ctx.oi.changePct)}</p>
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">FUNDING (§18)</p>
            <p className={`mt-0.5 font-mono text-xs font-bold ${out.ctx.funding.state.includes("EXTREME") ? "text-amberx-300" : "text-fog-100"}`}>
              {fmtRegime(out.ctx.funding.state)}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-fog-600">percentil {Math.round(out.ctx.funding.percentile * 100)}</p>
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">BURST (§27)</p>
            <p className={`mt-0.5 font-mono text-xs font-bold ${out.ctx.burst.state === "NORMAL" ? "text-fog-100" : "text-danger-300"}`}>
              {fmtRegime(out.ctx.burst.state)}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-fog-600">{formatNumber(out.ctx.burst.ratio, 1)}× línea base</p>
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">ESCENARIO (§37)</p>
            <p className="mt-0.5 font-mono text-xs font-bold text-fog-100">{fmtRegime(out.scenario.state)}</p>
            <p className="font-mono text-[10px] text-fog-600">horizonte {out.scenario.horizon}</p>
          </div>
        </div>
        {out.scenario.invalidation !== "—" && (
          <p className="mt-3 font-mono text-[10px] text-fog-500">
            <span className="text-amberx-400">Invalidación:</span> {out.scenario.invalidation}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ 4 · ORDER FLOW (§14-§24) ------------------------------ */

function CvdRow({ label, usd, f, has, truth }: { label: string; usd: number; f: FeatureResult; has: boolean; truth: DataTruth }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 font-mono text-[10px] tracking-[0.14em] text-fog-500">{label}</span>
      <div className="relative h-2 min-w-0 flex-1 bg-ink-700">
        <div className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-fog-600/50" />
        {has && (
          <div
            className={`absolute top-0 h-full ${usd >= 0 ? "left-1/2 bg-phos-400" : "right-1/2 bg-danger-400"} bar-anim`}
            style={{ width: `${Math.round(clamp01(f.strength) * 50)}%` }}
          />
        )}
      </div>
      <span className={`w-20 shrink-0 text-right font-mono text-xs font-bold tabular-nums ${!has ? "text-fog-600" : usd >= 0 ? "text-phos-300" : "text-danger-300"}`}>
        {has ? formatUsd(usd) : "—"}
      </span>
      <TruthBadge truth={truth} />
    </div>
  );
}

export function OrderFlowPanel({ out }: { out: EngineOutput }) {
  const { ctx } = out;
  return (
    <Panel title="ORDER FLOW" className="h-full">
      <div className="space-y-3 px-5 pb-5">
        <CvdRow label="SPOT CVD" usd={ctx.spotCvdUsd} f={ctx.spotFeat} has={ctx.hasSpot} truth={ctx.spotFeat.provenance.truth} />
        <CvdRow label="FUTURES CVD" usd={ctx.futCvdUsd} f={ctx.futFeat} has={ctx.hasFut} truth={ctx.futFeat.provenance.truth} />
        {ctx.divergences.map((d, i) => (
          <p key={i} className="border border-amberx-400/40 bg-amberx-400/8 px-3 py-1.5 font-mono text-[10px] text-amberx-300">⚠ {d}</p>
        ))}

        {ctx.book.absorption.state !== "NONE" && (
          <div className="flex items-center gap-2 border border-info-400/40 bg-info-400/8 px-3 py-2">
            <TruthBadge truth="ESTIMATED" label="EVENTO ESTIMADO" />
            <span className="font-mono text-[11px] text-info-300">
              {ctx.book.absorption.state === "BUY_ABSORPTION" ? "BUY ABSORPTION" : "SELL ABSORPTION"} · fuerza {Math.round(ctx.book.absorption.strength * 100)}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-px border border-line bg-line">
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">TAKER IMBALANCE (§17)</p>
            <p className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${ctx.taker.imbalance >= 0 ? "text-phos-300" : "text-danger-300"}`}>
              {ctx.taker.enough ? formatPercent(ctx.taker.imbalance * 100, 1) : "—"}
            </p>
            <TruthBadge truth={ctx.taker.feature.provenance.truth} />
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">DESEQUILIBRIO L2 (§20)</p>
            <p className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${ctx.book.imbalance >= 0 ? "text-phos-300" : "text-danger-300"}`}>
              {ctx.book.has ? formatPercent(ctx.book.imbalance * 100, 1) : "—"}
            </p>
            <TruthBadge truth={ctx.book.feature.provenance.truth} />
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">TOP TRADERS (§19)</p>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-fog-100">
              {ctx.positioning.enough ? formatNumber(ctx.positioning.last, 2) : "—"}
              <span className="ml-1 text-[10px] text-fog-600">z {formatNumber(ctx.positioning.z, 1)}</span>
            </p>
            <TruthBadge truth={ctx.positioning.feature.provenance.truth} />
          </div>
          <div className="bg-ink-900 px-3 py-2.5">
            <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">SPOOF_RISK (§24)</p>
            <p className={`mt-0.5 font-mono text-sm font-bold ${ctx.book.spoof.level === "HIGH" ? "text-danger-300" : ctx.book.spoof.level === "ELEVATED" ? "text-amberx-300" : "text-fog-100"}`}>
              {ctx.book.spoof.level}
            </p>
            <TruthBadge truth="ESTIMATED" />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ 5 · LIQUIDACIONES (§26/§27) ------------------------------ */

export function LiquidationsPanel({ out, liqs, demo }: { out: EngineOutput; liqs: RadarState["liqs"]; demo: boolean }) {
  const b = out.ctx.burst;
  const stateColor = b.state === "NORMAL" ? "text-fog-300" : b.state === "ELEVATED" ? "text-amberx-300" : "text-danger-300";
  const total = Math.max(1, b.longUsd + b.shortUsd);
  return (
    <Panel title="LIQUIDACIONES OBSERVADAS" truth={demo ? "DEMO" : "REAL"} className="h-full" right={<span className="font-mono text-[9px] text-fog-600">forceOrder · BTCUSDT</span>}>
      <div className="px-5 pb-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={`font-display text-xl font-extrabold tracking-wide ${stateColor}`}>{fmtRegime(b.state)}</p>
            <p className="font-mono text-[10px] tabular-nums text-fog-600">{formatNumber(b.ratio, 1)}× la línea base de 1 h · ventana 5 m</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-bold tabular-nums text-danger-300">{formatUsd(b.longUsd)}</p>
            <p className="font-mono text-[9px] tracking-[0.18em] text-fog-600">LONGS LIQ.</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-bold tabular-nums text-phos-300">{formatUsd(b.shortUsd)}</p>
            <p className="font-mono text-[9px] tracking-[0.18em] text-fog-600">SHORTS LIQ.</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex h-2 w-full overflow-hidden bg-ink-700">
            <div className="liq-bar h-full bg-danger-400" style={{ width: `${Math.round((b.longUsd / total) * 100)}%` }} />
            <div className="liq-bar h-full bg-phos-400" style={{ width: `${Math.round((b.shortUsd / total) * 100)}%` }} />
          </div>
          <p className="mt-1 font-mono text-[9px] text-fog-600">
            Semántica §68: shorts liquidados → presión compradora · longs liquidados → presión vendedora
          </p>
        </div>

        <ul className="mt-3 max-h-44 divide-y divide-line/50 overflow-y-auto">
          {liqs.slice(0, 14).map((l) => (
            <li key={l.id} className="feed-item flex items-center gap-2 py-1.5 font-mono text-[11px] tabular-nums">
              <span className="w-14 shrink-0 text-fog-600">{formatClock(l.ts)}</span>
              <span className={`w-14 shrink-0 font-bold ${l.side === "SELL" ? "text-danger-300" : "text-phos-300"}`}>
                {l.side === "SELL" ? "LONG" : "SHORT"}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-fog-100">{formatUsd(l.usd)}</span>
              <span className="text-fog-600">@ {formatPrice(l.price)}</span>
            </li>
          ))}
          {liqs.length === 0 && (
            <li className="py-4 text-center font-mono text-[10px] tracking-[0.18em] text-fog-600">
              SIN LIQUIDACIONES EN EL STREAM TODAVÍA<span className="blink-caret ml-1 text-phos-400">▊</span>
            </li>
          )}
        </ul>
        <p className="mt-2 border-t border-line pt-2 font-mono text-[9px] leading-relaxed text-fog-600">
          Muestra del stream oficial: sin cobertura garantizada no se afirma «todos los liquidados» (§26).
          Agregación cross-exchange vía CoinGlass: no configurada (requiere backend + key).
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------ 6 · MAPA DE LIQUIDEZ (§29/§70) ------------------------------ */

export function LiquidityPanel({ out, price }: { out: EngineOutput; price: number }) {
  const clusters = out.ctx.clusters;
  const above = clusters.filter((c) => c.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
  const below = clusters.filter((c) => c.price < price).sort((a, b) => b.price - a.price).slice(0, 3);
  const maxUsd = Math.max(1, ...clusters.map((c) => c.estimatedUsd));

  const row = (c: Cluster) => {
    const up = c.price > price;
    return (
      <li key={`${c.side}-${c.price.toFixed(0)}`} className="group border-t border-line/60 px-5 py-2 transition-colors hover:bg-ink-700/40">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-sm font-bold tabular-nums ${up ? "text-amberx-300" : "text-danger-300"}`}>
            {formatPrice(c.price, 0)} $
          </span>
          <span className="font-mono text-[10px] tabular-nums text-fog-500">{formatPercentRaw(c.distancePct, 2)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-fog-500">Liquidez de liquidación estimada: <span className="font-semibold text-fog-300">{formatUsd(c.estimatedUsd)}</span></span>
          <TruthBadge truth="ESTIMATED" />
        </div>
        <div className="mt-1 h-1 w-full bg-ink-700">
          <div className={`liq-bar h-full ${up ? "bg-amberx-400" : "bg-danger-400"}`} style={{ width: `${Math.round((c.estimatedUsd / maxUsd) * 100)}%` }} />
        </div>
        <p className="mt-1 font-mono text-[9px] text-fog-600">
          liquidación de <span className={up ? "text-amberx-300" : "text-danger-300"}>{c.side === "short" ? "SHORTS" : "LONGS"}</span>
          {" · modelo "}{c.model} · externo — · convergencia —
        </p>
      </li>
    );
  };

  return (
    <Panel title="MAPA DE LIQUIDEZ" truth="ESTIMATED" className="h-full">
      <div className="flex items-center justify-between border-y border-line bg-ink-800/80 px-5 py-2">
        <span className="font-mono text-[9px] tracking-[0.22em] text-fog-600">SHORTS LIQ ↑</span>
        <span className="font-mono text-base font-bold tabular-nums text-fog-100">{formatPrice(price, 0)} $</span>
        <span className="font-mono text-[9px] tracking-[0.22em] text-fog-600">↓ LONGS LIQ</span>
      </div>
      <ul>{above.map(row)}</ul>
      <div className="mx-5 border-t border-dashed border-fog-600/40" />
      <ul>{below.map(row)}</ul>
      <p className="px-5 py-3 font-mono text-[9px] leading-relaxed text-fog-600">
        Modelo propio LIQRADAR (§29): precio + OI + tramos reales de apalancamiento (sin MMR fijo).
        Convergerá con CoinGlass/Hyblock cuando exista backend (§31). Nunca son «liquidaciones reales futuras».
      </p>
    </Panel>
  );
}

/* ------------------------------ 7 · MTF (§11/§38) ------------------------------ */

export function MtfPanel({ out }: { out: EngineOutput }) {
  const s = out.ctx.structure;
  const verdict = s.alignment === "ALIGNED_BULLISH" ? { t: "ARMONÍA ALCISTA", c: "text-phos-300" }
    : s.alignment === "ALIGNED_BEARISH" ? { t: "ARMONÍA BAJISTA", c: "text-danger-300" }
    : s.alignment === "SEVERE_CONFLICT" ? { t: "CONFLICTO SEVERO", c: "text-danger-300" }
    : { t: "MIXTO", c: "text-amberx-300" };
  const semantics: Record<string, string> = { "15m": "ejecución", "1h": "setup", "4h": "estructura", "1D": "régimen", "1W": "contexto" };
  return (
    <Panel title="CONFLUENCIA MTF" className="h-full" truth="REAL">
      <div className="px-5 pb-5">
        <table className="w-full">
          <thead>
            <tr className="text-left font-mono text-[8px] tracking-[0.2em] text-fog-600">
              <th className="py-1 font-medium">TF</th><th className="font-medium">DIRECCIÓN</th><th className="font-medium">FUERZA</th><th className="font-medium">CALIDAD</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.tf} className="border-t border-line/60">
                <td className="py-1.5 font-mono text-xs font-bold text-fog-100">{r.tf}<span className="ml-1.5 text-[9px] font-normal text-fog-600">{semantics[r.tf]}</span></td>
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <Arrow dir={r.direction === "bullish" ? "up" : r.direction === "bearish" ? "down" : "flat"} />
                    <span className={`font-mono text-[10px] ${r.direction === "neutral" ? "text-fog-600" : r.direction === "bullish" ? "text-phos-300" : "text-danger-300"}`}>
                      {r.direction === "neutral" ? "—" : r.direction === "bullish" ? "ALCISTA" : "BAJISTA"}
                    </span>
                  </span>
                </td>
                <td className="py-1.5 pr-3"><Bar pct={r.strength} tone={r.direction === "bearish" ? "danger" : "phos"} /></td>
                <td className="py-1.5 font-mono text-[10px] tabular-nums text-fog-500">{Math.round(r.quality * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className={`font-display text-xs font-bold tracking-[0.18em] ${verdict.c}`}>{verdict.t}</span>
          <span className="font-mono text-[10px] tabular-nums text-fog-500">contradicción {Math.round(s.contradictionIndex * 100)}%</span>
        </div>
        <Bar pct={s.contradictionIndex} tone={s.contradictionIndex > 0.6 ? "danger" : s.contradictionIndex > 0.35 ? "amber" : "phos"} className="mt-1" />
      </div>
    </Panel>
  );
}

/* ------------------------------ 8 · FUNDING + CROSS (§18/§32) ------------------------------ */

export function CrossPanel({ state }: { state: RadarState }) {
  return (
    <Panel title="FUNDING + CROSS-EXCHANGE" className="h-full" truth={state.engine ? state.engine.ctx.funding.feature.provenance.truth : "UNAVAILABLE"}>
      <div className="px-5 pb-5">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="font-mono text-2xl font-bold tabular-nums text-fog-100">{formatPercentRaw(state.fundingRate * 100, 4)}</p>
            <p className="font-mono text-[9px] tracking-[0.2em] text-fog-600">FUNDING BINANCE · 8H</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-bold tabular-nums text-info-300">{formatCountdown(state.nextFundingTime - state.now)}</p>
            <p className="font-mono text-[9px] tracking-[0.2em] text-fog-600">PRÓXIMO PAGO</p>
          </div>
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <table className="w-full">
            <thead>
              <tr className="text-left font-mono text-[8px] tracking-[0.2em] text-fog-600">
                <th className="py-1 font-medium">EXCHANGE</th><th className="font-medium">OI</th><th className="font-medium">FUNDING</th><th className="font-medium">ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {(["OKX", "Bybit"] as const).map((ex) => {
                const data = state.cross.find((c) => c.exchange === ex);
                return (
                  <tr key={ex} className="border-t border-line/60">
                    <td className="py-1.5 font-mono text-xs font-bold text-fog-100">{ex}</td>
                    <td className="py-1.5 font-mono text-[11px] tabular-nums text-fog-300">{data?.oiUsd !== undefined ? formatUsd(data.oiUsd) : "—"}</td>
                    <td className="py-1.5 font-mono text-[11px] tabular-nums text-fog-300">{data?.funding !== undefined ? formatPercentRaw(data.funding * 100, 4) : "—"}</td>
                    <td className="py-1.5"><TruthBadge truth={data?.truth ?? "UNAVAILABLE"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[9px] leading-relaxed text-fog-600">
          Funding no es «positivo = bajista»: se usa percentil histórico + contexto OI + bursts (§18).
          Basis/premium no vota por separado para no duplicar peso (§32/§72).
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------ 9 · OPCIONES (§33) ------------------------------ */

export function OptionsPanel({ state }: { state: RadarState }) {
  const o = state.options;
  return (
    <Panel title="OPCIONES" className="h-full" truth={o?.truth ?? "UNAVAILABLE"}>
      <div className="px-5 pb-5">
        {!o || o.truth === "UNAVAILABLE" ? (
          <div className="flex h-28 flex-col items-center justify-center gap-1 text-center">
            <p className="font-display text-sm font-bold tracking-[0.2em] text-fog-500">UNAVAILABLE</p>
            <p className="max-w-[260px] font-mono text-[10px] leading-relaxed text-fog-600">
              {o?.error ?? "Fuente de opciones sin respuesta. El radar sigue operando sin este bloque (§71)."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px border border-line bg-line">
            <div className="bg-ink-900 px-3 py-2.5">
              <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">OI TOTAL</p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-fog-100">{formatUsd(o.totalOi)}</p>
            </div>
            <div className="bg-ink-900 px-3 py-2.5">
              <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">PUT / CALL</p>
              <p className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${(o.putCallRatio ?? 1) > 1 ? "text-danger-300" : "text-phos-300"}`}>
                {formatNumber(o.putCallRatio, 2)}
              </p>
            </div>
            <div className="bg-ink-900 px-3 py-2.5">
              <p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">ATM IV (DVOL)</p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-fog-100">{o.atmIv !== undefined ? formatNumber(o.atmIv, 1) : "—"}</p>
            </div>
            <div className="bg-ink-900 px-3 py-2.5">
              <p className="flex items-center gap-1 font-mono text-[8px] tracking-[0.2em] text-fog-600">MAX PAIN <TruthBadge truth="ESTIMATED" label="DERIVED" /></p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-fog-100">{formatPrice(o.maxPain, 0)} $</p>
            </div>
          </div>
        )}
        {o && o.truth !== "UNAVAILABLE" && (
          <p className="mt-3 font-mono text-[9px] text-fog-600">
            {o.expiries ?? "—"} expiries · fuente {o.source} · cobertura {o.truth === "REAL" ? "observada" : "simulada (DEMO)"}
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ 10 · JOURNAL (§48/§49) ------------------------------ */

export function JournalPanel({ journal }: { journal: JournalEntry[] }) {
  const real = journal.filter((j) => !j.demo);
  const withSig = real.filter((j) => j.direction !== "NO_TRADE");
  const resolved = real.filter((j) => j.outcomes["+15m"] && !j.outcomes["+15m"]?.noData);
  const hits = resolved.filter((j) => j.outcomes["+15m"]?.hitTarget && !j.outcomes["+15m"]?.hitInvalidation);

  const buckets = useMemo(() => {
    const defs = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]] as const;
    return defs.map(([lo, hi]) => {
      const rs = resolved.filter((j) => j.confidence >= lo && j.confidence < hi);
      const hitN = rs.filter((j) => j.outcomes["+15m"]?.hitTarget && !j.outcomes["+15m"]?.hitInvalidation).length;
      return {
        label: `${Math.round(lo * 100)}–${Math.round(Math.min(hi, 1) * 100)}`,
        n: rs.length,
        predicted: rs.length ? rs.reduce((s, j) => s + j.confidence, 0) / rs.length : 0,
        actual: rs.length ? hitN / rs.length : 0,
      };
    });
  }, [resolved]);

  const outChip = (o?: Outcome) => {
    if (!o) return <span className="text-fog-600">·</span>;
    if (o.ambiguous) return <span className="text-amberx-300" title="target e invalidación en la misma muestra (§46)">~</span>;
    if (o.hitTarget && !o.hitInvalidation) return <span className="text-phos-300">✓</span>;
    if (o.hitInvalidation) return <span className="text-danger-300">✗</span>;
    return <span className="text-fog-500">○</span>;
  };

  return (
    <Panel title="JOURNAL · PREDICCIÓN VS REALIDAD" className="h-full" truth="REAL" right={<span className="font-mono text-[9px] text-fog-600">outcomes +5m/+15m/+30m/+1h/+4h</span>}>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-4 gap-px border border-line bg-line text-center">
          <div className="bg-ink-900 py-2.5"><p className="font-mono text-lg font-bold tabular-nums text-fog-100">{real.length}</p><p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">SEÑALES REAL</p></div>
          <div className="bg-ink-900 py-2.5"><p className="font-mono text-lg font-bold tabular-nums text-phos-300">{withSig.filter((j) => j.direction === "LONG").length}</p><p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">LONG</p></div>
          <div className="bg-ink-900 py-2.5"><p className="font-mono text-lg font-bold tabular-nums text-danger-300">{withSig.filter((j) => j.direction === "SHORT").length}</p><p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">SHORT</p></div>
          <div className="bg-ink-900 py-2.5"><p className="font-mono text-lg font-bold tabular-nums text-amberx-300">{resolved.length ? Math.round((hits.length / resolved.length) * 100) : 0}%</p><p className="font-mono text-[8px] tracking-[0.2em] text-fog-600">HIT +15M</p></div>
        </div>

        <div className="mt-4">
          <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">DIAGRAMA DE CALIBRACIÓN (§45) — previsto vs real a +15m</p>
          <div className="mt-2 space-y-1.5">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-[9px] tabular-nums text-fog-500">{b.label}</span>
                <div className="relative h-2 min-w-0 flex-1 bg-ink-700">
                  <div className="absolute left-0 top-0 h-full bg-fog-600/50" style={{ width: `${Math.round(b.predicted * 100)}%` }} />
                  <div className="absolute left-0 top-0 h-full bg-phos-400/80" style={{ width: `${Math.round(b.actual * 100)}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-[9px] tabular-nums text-fog-500">n={b.n}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 font-mono text-[8px] text-fog-600">gris = confianza media prevista · verde = tasa de acierto real (solo entradas REAL)</p>
        </div>

        <div className="mt-4 max-h-52 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left font-mono text-[8px] tracking-[0.2em] text-fog-600">
                <th className="py-1 font-medium">HORA</th><th className="font-medium">DIR</th><th className="font-medium">CONF</th>
                <th className="font-medium">RÉGIMEN</th><th className="font-medium">+5M</th><th className="font-medium">+15M</th><th className="font-medium">+1H</th>
              </tr>
            </thead>
            <tbody>
              {journal.slice(0, 18).map((j) => (
                <tr key={j.id} className={`border-t border-line/60 ${j.demo ? "opacity-60" : ""}`}>
                  <td className="py-1.5 font-mono text-[10px] tabular-nums text-fog-500">{formatClock(j.ts)}{j.demo && <span className="ml-1 text-amberx-300">DEMO</span>}</td>
                  <td className={`py-1.5 font-mono text-[10px] font-bold ${j.direction === "LONG" ? "text-phos-300" : j.direction === "SHORT" ? "text-danger-300" : "text-amberx-300"}`}>
                    {j.direction === "NO_TRADE" ? "NT" : j.direction}
                  </td>
                  <td className="py-1.5 font-mono text-[10px] tabular-nums text-fog-300">{Math.round(j.confidence * 100)}%</td>
                  <td className="py-1.5 font-mono text-[9px] text-fog-500">{fmtRegime(j.regime)}</td>
                  <td className="py-1.5 font-mono text-[11px]">{outChip(j.outcomes["+5m"])}</td>
                  <td className="py-1.5 font-mono text-[11px]">{outChip(j.outcomes["+15m"])}</td>
                  <td className="py-1.5 font-mono text-[11px]">{outChip(j.outcomes["+1h"])}</td>
                </tr>
              ))}
              {journal.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center font-mono text-[10px] tracking-[0.18em] text-fog-600">SIN SEÑALES REGISTRADAS AÚN</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[8px] text-fog-600">
          ✓ target · ✗ invalidación · ~ ambigua (§46) · ○ sin toque · entradas DEMO excluidas de métricas (§65)
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------ 11 · REPLAY (§50) ------------------------------ */

export function ReplayPanel({ frames }: { frames: ReplayFrame[] }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [idx, setIdx] = useState(0);
  const clamped = Math.min(idx, Math.max(0, frames.length - 1));

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const iv = window.setInterval(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 2000 / speed);
    return () => window.clearInterval(iv);
  }, [playing, speed, frames.length]);

  const view = useMemo(() => frames.slice(0, Math.max(2, clamped + 1)), [frames, clamped]);
  const W = 640; const H = 170;
  const model = useMemo(() => {
    if (view.length < 2) return null;
    const prices = view.map((f) => f.price).filter((p) => p > 0);
    if (prices.length < 2) return null;
    const min = Math.min(...prices); const max = Math.max(...prices);
    const span = Math.max(1e-9, max - min);
    const pts = view.map((f, i) => [
      (i / (view.length - 1)) * W,
      8 + (1 - (f.price - min) / span) * (H - 34),
    ] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const cMax = Math.max(0.001, ...view.map((f) => Math.abs(f.futCvd)));
    const cvdLine = view.map((f, i) => {
      const x = (i / (view.length - 1)) * W;
      const y = H - 8 - ((f.futCvd / cMax + 1) / 2) * 20;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return { line, cvdLine, last: pts[pts.length - 1], liqs: view.map((f, i) => ({ x: (i / (view.length - 1)) * W, on: f.liqUsd > 0 })).filter((p) => p.on) };
  }, [view]);

  const cur = view.length ? view[view.length - 1] : null;
  const cvdTone = cur && cur.futCvd >= 0 ? "text-phos-300" : "text-danger-300";

  return (
    <Panel title="REPLAY DE SESIÓN" className="h-full" truth="REAL" right={<span className="font-mono text-[9px] text-fog-600">solo datos capturados en vivo</span>}>
      <div className="px-5 pb-5">
        {frames.length < 2 ? (
          <div className="flex h-32 items-center justify-center font-mono text-[10px] tracking-[0.2em] text-fog-600">
            CAPTURANDO SESIÓN<span className="blink-caret ml-1 text-phos-400">▊</span>
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-40 w-full border border-line bg-ink-900/60" preserveAspectRatio="none">
              {model && (
                <>
                  <path d={model.cvdLine} fill="none" stroke="#ffb020" strokeWidth="1.2" opacity="0.85" />
                  <path d={model.line} fill="none" stroke="#3df5a5" strokeWidth="1.8" />
                  {model.liqs.map((l, i) => (
                    <circle key={i} cx={l.x} cy={H - 30} r="2.5" fill="#ff4d6d" opacity="0.9" />
                  ))}
                  <circle cx={model.last[0]} cy={model.last[1]} r="3.5" fill="#3df5a5">
                    <animate attributeName="r" values="3.5;5.5;3.5" dur="1.4s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
            </svg>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                onClick={() => { if (clamped >= frames.length - 1) setIdx(0); setPlaying(!playing); }}
                className="border border-phos-400/50 bg-phos-400/10 px-3 py-1.5 font-display text-[10px] font-bold tracking-[0.2em] text-phos-300 transition-colors hover:bg-phos-400/20"
              >
                {playing ? "❚❚ PAUSA" : "► PLAY"}
              </button>
              <div className="flex gap-1">
                {[0.5, 1, 2, 5, 10].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`border px-2 py-1.5 font-mono text-[10px] tabular-nums transition-colors ${speed === s ? "border-phos-400/60 bg-phos-400/15 text-phos-300" : "border-line text-fog-600 hover:text-fog-300"}`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
              <input
                type="range" min={0} max={Math.max(0, frames.length - 1)} value={clamped}
                onChange={(e) => { setPlaying(false); setIdx(parseInt(e.target.value, 10)); }}
                className="min-w-0 flex-1 accent-[#3df5a5]" aria-label="posición del replay"
              />
            </div>
            {cur && (
              <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] tabular-nums text-fog-500 sm:grid-cols-5">
                <span>{formatClock(cur.ts)}</span>
                <span className="text-fog-100">{formatPrice(cur.price)} $</span>
                <span className={cvdTone}>fCVD {formatNumber(cur.futCvd * 100, 2)}%</span>
                <span>OI {formatNumber(cur.oi, 0)} ₿</span>
                <span className={cur.liqUsd > 0 ? "text-danger-300" : ""}>liq {formatUsd(cur.liqUsd)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------------ 12 · ALERTAS (§51) ------------------------------ */

export function AlertsPanel({ alerts }: { alerts: AlertItem[] }) {
  const sevStyle = (s: AlertItem["severity"]) =>
    s === "critical" ? "border-danger-400/60 text-danger-300" : s === "warn" ? "border-amberx-400/60 text-amberx-300" : "border-line text-fog-300";
  return (
    <Panel title="ALERTAS DEL MOTOR" className="h-full">
      <ul className="max-h-40 space-y-1 overflow-y-auto px-5 pb-4">
        {alerts.slice(0, 14).map((a) => (
          <li key={a.id} className={`alert-in flex items-start gap-2 border-l-2 py-1 pl-2 ${sevStyle(a.severity)}`}>
            <span className="shrink-0 font-mono text-[9px] tabular-nums text-fog-600">{formatClock(a.ts)}</span>
            <span className="min-w-0 font-mono text-[10px] leading-snug">{a.msg}</span>
          </li>
        ))}
        {alerts.length === 0 && (
          <li className="py-3 text-center font-mono text-[10px] tracking-[0.2em] text-fog-600">SIN EVENTOS</li>
        )}
      </ul>
    </Panel>
  );
}
