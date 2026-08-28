/* ============================================================
 * LIQRADAR — Contexto de mercado en vivo
 * BriefingPanel: narrativa generada SOLO con datos presentes,
 *   cada línea con su fuente y su badge de verdad (§66/§80).
 * SourcesPanel: las fuentes valoradas por el usuario, con su
 *   estado de integración y enlace cuando existe API pública.
 * ============================================================ */

import type { ReactNode } from "react";
import type { BriefingLine, DataTruth, Sentiment, SourceCard } from "../types";
import { clamp01, formatUsd } from "../lib/safe";
import { TruthBadge } from "./panels";

function Panel({ title, truth, right, children, className }: {
  title: string; truth?: DataTruth; right?: ReactNode; children: ReactNode; className?: string;
}) {
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

/* ------------------------------ BRIEFING ------------------------------ */

function sentimentTone(v: number): { text: string; bar: string } {
  if (v <= 25) return { text: "text-danger-300", bar: "bg-danger-400" };
  if (v <= 45) return { text: "text-amberx-300", bar: "bg-amberx-400" };
  if (v <= 55) return { text: "text-fog-300", bar: "bg-fog-500" };
  if (v <= 75) return { text: "text-phos-300", bar: "bg-phos-400" };
  return { text: "text-amberx-300", bar: "bg-amberx-400" };
}

export function BriefingPanel({ briefing, sentiment, basis, liqAgg, demo }: {
  briefing: BriefingLine[];
  sentiment: Sentiment | null;
  basis: { exchange: string; bps: number }[];
  liqAgg: { exchange: string; usd: number; count: number }[];
  demo: boolean;
}) {
  const tone = sentiment ? sentimentTone(sentiment.value) : null;
  const maxLiq = Math.max(1, ...liqAgg.map((a) => a.usd));

  return (
    <Panel title="QUÉ ESTÁ PASANDO EN EL MERCADO" truth={demo ? "DEMO" : undefined} className="h-full">
      <div className="grid gap-0 lg:grid-cols-[1fr_290px]">
        {/* narrativa */}
        <div className="min-h-[190px] border-b border-line px-5 pb-4 lg:border-b-0 lg:border-r">
          {briefing.length === 0 ? (
            <div className="flex h-full min-h-[190px] flex-col items-center justify-center gap-2">
              <p className="font-mono text-[11px] tracking-[0.22em] text-fog-500">
                RECOPILANDO EVIDENCIA<span className="blink-caret ml-1 text-phos-400">▊</span>
              </p>
              <p className="max-w-[420px] text-center font-mono text-[10px] leading-relaxed text-fog-600">
                El briefing se escribe línea a línea con datos reales cuando llegan.
                Sin dato no hay línea — el radar nunca rellena con invenciones (§80).
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {briefing.map((line, i) => (
                <li key={`${i}-${line.text.slice(0, 24)}`} className="feed-item group flex items-start gap-3 border-l-2 border-transparent py-1 pl-1 transition-all duration-200 hover:border-phos-400/50 hover:bg-ink-800/40">
                  <span className={`mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    line.truth === "ESTIMATED" ? "bg-amberx-400" : line.truth === "FALLBACK" ? "bg-info-400" : demo ? "bg-amberx-400" : "bg-phos-400"
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px] leading-snug text-fog-100">{line.text}</p>
                    <p className="mt-0.5 flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-fog-600">
                      {line.source.toUpperCase()} <TruthBadge truth={line.truth} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* columna de contexto */}
        <div className="flex flex-col divide-y divide-line">
          {/* sentimiento */}
          <div className="px-5 py-3.5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] tracking-[0.24em] text-fog-600">SENTIMIENTO MINORISTA</p>
              {sentiment && <TruthBadge truth={sentiment.truth} />}
            </div>
            {sentiment && tone ? (
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-3xl font-bold tabular-nums ${tone.text}`}>{sentiment.value}</span>
                  <span className={`font-display text-[11px] font-semibold tracking-[0.14em] ${tone.text}`}>{sentiment.label.toUpperCase()}</span>
                </div>
                <div className="mt-2 h-1.5 w-full bg-ink-700">
                  <div className={`ratio-fill h-full ${tone.bar}`} style={{ width: `${Math.round(clamp01(sentiment.value / 100) * 100)}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[8px] text-fog-600">
                  <span>MIEDO EXTREMO</span><span>CODICIA EXTREMA</span>
                </div>
              </div>
            ) : (
              <p className="mt-3 font-mono text-[10px] text-fog-600">Fear & Greed sin respuesta — UNAVAILABLE</p>
            )}
          </div>

          {/* basis */}
          <div className="px-5 py-3.5">
            <p className="font-mono text-[9px] tracking-[0.24em] text-fog-600">BASIS PERP VS BINANCE</p>
            {basis.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {basis.map((b) => (
                  <span key={b.exchange} className={`border px-2 py-1 font-mono text-[11px] font-semibold tabular-nums transition-transform duration-200 hover:scale-105 ${
                    b.bps >= 0 ? "border-phos-400/40 bg-phos-400/8 text-phos-300" : "border-danger-400/40 bg-danger-400/8 text-danger-300"
                  }`}>
                    {b.exchange} {b.bps >= 0 ? "+" : ""}{b.bps.toFixed(1)} bps
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 font-mono text-[10px] text-fog-600">esperando precios cross-exchange…</p>
            )}
          </div>

          {/* liquidaciones por exchange */}
          <div className="flex-1 px-5 py-3.5">
            <p className="font-mono text-[9px] tracking-[0.24em] text-fog-600">LIQUIDACIONES 5 MIN / EXCHANGE</p>
            {liqAgg.length ? (
              <ul className="mt-2 space-y-1.5">
                {liqAgg.map((a) => (
                  <li key={a.exchange} className="group">
                    <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
                      <span className="text-fog-300 transition-colors group-hover:text-fog-100">{a.exchange}</span>
                      <span className="text-fog-500">{formatUsd(a.usd)} · {a.count} órdenes</span>
                    </div>
                    <div className="mt-0.5 h-1 w-full bg-ink-700">
                      <div className="liq-bar h-full bg-amberx-400" style={{ width: `${Math.round(clamp01(a.usd / maxLiq) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 font-mono text-[10px] text-fog-600">sin liquidaciones en la ventana — mercado tranquilo</p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------ FUENTES ------------------------------ */

const KIND_STYLE: Record<SourceCard["kind"], string> = {
  INTEGRADO: "border-phos-400/50 bg-phos-400/10 text-phos-300",
  DERIVADO: "border-info-400/50 bg-info-400/10 text-info-300",
  CUBIERTO: "border-fog-500/40 bg-ink-800 text-fog-300",
  EXTERNA: "border-amberx-400/50 bg-amberx-400/10 text-amberx-300",
};

export function SourcesPanel({ sources }: { sources: SourceCard[] }) {
  return (
    <Panel title="FUENTES DEL RADAR — VALORADAS POR EL USUARIO">
      <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {sources.map((s) => (
          <div key={s.name} className="group relative flex flex-col gap-2 bg-ink-900/95 p-4 transition-colors duration-200 hover:bg-ink-800">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-[12px] font-bold tracking-[0.12em] text-fog-100">
                {s.name.toUpperCase()}
              </p>
              <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-amberx-300" title={`${s.stars}/5`}>
                {"★".repeat(s.stars)}<span className="text-ink-600">{"★".repeat(5 - s.stars)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`border px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.2em] ${KIND_STYLE[s.kind]}`}>
                {s.kind}
              </span>
              {s.live !== null && s.live !== undefined && (
                <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.14em]">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${s.live ? "pulse-dot bg-phos-400" : "bg-danger-400"}`} />
                  <span className={s.live ? "text-phos-300" : "text-danger-300"}>{s.live ? "LIVE" : "SIN CONEXIÓN"}</span>
                </span>
              )}
            </div>
            <p className="flex-1 font-mono text-[10px] leading-relaxed text-fog-500 transition-colors group-hover:text-fog-300">
              {s.note}
            </p>
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 border border-line px-2 py-1 font-mono text-[9px] tracking-[0.18em] text-fog-500 transition-all duration-200 hover:-translate-y-0.5 hover:border-phos-400/50 hover:text-phos-300"
              >
                ABRIR
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M1.5 8.5 L8.5 1.5 M3 1.5 H8.5 V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="border-t border-line px-5 py-2.5 font-mono text-[9px] leading-relaxed text-fog-600">
        Solo se integran fuentes con API pública verificada (§5G): sin scraping frágil como dependencia del motor.
        CoinGlass/Hyblock quedan UNAVAILABLE porque exigirían API keys que nunca deben tocar el frontend (§6/§18).
      </p>
    </Panel>
  );
}
