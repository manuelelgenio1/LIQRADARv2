/* ============================================================
 * LIQRADAR — Terminal principal
 * Arquitectura §3: connectors → normalizer → validators →
 * feature engine → event engine → regime → scenario → signal →
 * confidence → risk/journal → UI. Sin fetch en JSX, sin secretos
 * en frontend, sin simulación en modo REAL (§65).
 * ============================================================ */

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useRadar } from "./lib/store";
import type { Mode } from "./types";
import { formatClock, formatCountdown, formatPercent, formatPrice } from "./lib/safe";
import {
  AlertsPanel, CrossPanel, HealthPanel, JournalPanel, LiquidityPanel,
  LiquidationsPanel, MtfPanel, OptionsPanel, OrderFlowPanel, RegimePanel,
  ReplayPanel, Reveal, SignalPanel, TruthBadge,
} from "./components/panels";
import { BriefingPanel, SourcesPanel } from "./components/context";

/* ------------------------- Error Boundary global (§53) ------------------------- */

interface EBState { error: Error | null; component: string; ts: number; }

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null, component: "", ts: 0 };

  static getDerivedStateFromError(error: Error): Partial<EBState> {
    return { error, ts: Date.now() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("LIQRADAR ErrorBoundary:", error, info.componentStack);
    this.setState({ component: info.componentStack?.split("\n")[1]?.trim() ?? "componente desconocido" });
  }

  render() {
    if (this.state.error) {
      const details = `LIQRADAR crash\nerror: ${this.state.error.message}\ncomponente: ${this.state.component}\nts: ${new Date(this.state.ts).toISOString()}\nstack: ${this.state.error.stack ?? "—"}`;
      return (
        <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
          <div className="panel corner-frame w-full max-w-xl p-8">
            <p className="font-display text-lg font-bold tracking-[0.2em] text-danger-300">RADAR DETENIDO — ERROR INTERNO</p>
            <p className="mt-3 font-mono text-xs text-fog-300">{this.state.error.message}</p>
            <p className="mt-2 font-mono text-[10px] text-fog-600">componente: {this.state.component}</p>
            <p className="font-mono text-[10px] text-fog-600">timestamp: {formatClock(this.state.ts)}</p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => { void navigator.clipboard?.writeText(details).catch(() => undefined); }}
                className="border border-line px-4 py-2 font-display text-[10px] font-bold tracking-[0.2em] text-fog-300 transition-colors hover:border-fog-600 hover:text-fog-100"
              >
                COPIAR DETALLES
              </button>
              <button
                onClick={() => window.location.reload()}
                className="border border-phos-400/50 bg-phos-400/10 px-4 py-2 font-display text-[10px] font-bold tracking-[0.2em] text-phos-300 transition-colors hover:bg-phos-400/20"
              >
                REINICIAR RADAR
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------- logo radar ------------------------------- */

function RadarLogo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="21" stroke="#3df5a5" strokeWidth="1.6" opacity="0.9" />
      <circle cx="24" cy="24" r="13" stroke="#3df5a5" strokeWidth="1" strokeDasharray="3 5" opacity="0.6" />
      <circle cx="24" cy="24" r="5" stroke="#3df5a5" strokeWidth="1" opacity="0.4" />
      <g className="radar-rotor">
        <path d="M24 24 L24 3 A21 21 0 0 1 38.8 9.2 Z" fill="#3df5a5" fillOpacity="0.14" />
        <line x1="24" y1="24" x2="24" y2="3" stroke="#3df5a5" strokeWidth="1.8" />
      </g>
      <circle cx="31" cy="17" r="2" fill="#ffb020"><animate attributeName="opacity" values="1;0.2;1" dur="2.2s" repeatCount="indefinite" /></circle>
      <circle cx="17" cy="30" r="1.6" fill="#ff4d6d"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.7s" repeatCount="indefinite" /></circle>
      <circle cx="24" cy="24" r="2.2" fill="#3df5a5" />
    </svg>
  );
}

/* ------------------------------- header ------------------------------- */

function Header({
  mode, setMode, price, tickDir, changePct, fundingRate, nextFundingTime, now, liveCount, totalSources, startedAt,
}: {
  mode: Mode; setMode: (m: Mode) => void; price: number; tickDir: "up" | "down" | "none";
  changePct: number; fundingRate: number; nextFundingTime: number; now: number; liveCount: number; totalSources: number; startedAt: number;
}) {
  const up = tickDir === "up";
  const down = tickDir === "down";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink-950/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-3">
          <RadarLogo />
          <div>
            <p className="font-display text-lg font-extrabold leading-none tracking-[0.26em] text-fog-100">
              LIQ<span className="text-phos-400">RADAR</span>
            </p>
            <p className="mt-0.5 font-mono text-[8px] tracking-[0.3em] text-fog-600">RADAR DE EVIDENCIA · BTCUSDT PERP</p>
          </div>
        </div>

        <div className="flex items-baseline gap-3">
          <span
            key={`${price}-${tickDir}`}
            className={`font-mono text-2xl font-bold tabular-nums tracking-tight text-fog-100 md:text-3xl ${up ? "tick-up" : ""} ${down ? "tick-down" : ""}`}
          >
            {price > 0 ? formatPrice(price) : "——.———,—"}
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
            <p className="font-mono text-[8px] tracking-[0.24em] text-fog-600">FUENTES LIVE</p>
            <p className={`font-mono text-xs font-semibold tabular-nums ${liveCount > 0 ? "text-phos-300" : "text-danger-300"}`}>{liveCount} / {totalSources}</p>
          </div>
          <div>
            <p className="font-mono text-[8px] tracking-[0.24em] text-fog-600">SESIÓN</p>
            <p className="font-mono text-xs tabular-nums text-fog-500">{formatCountdown(now - startedAt)}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[9px] tracking-[0.18em] text-fog-600 sm:inline">MODO (§65)</span>
          <div className="grid grid-flow-col border border-line bg-ink-900 p-0.5">
            {(["REAL", "DEMO"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3.5 py-1.5 font-display text-[10px] font-bold tracking-[0.22em] transition-all duration-200 ${
                  mode === m
                    ? m === "REAL"
                      ? "bg-phos-400/15 text-phos-300 shadow-[inset_0_0_0_1px_rgba(61,245,165,0.5)]"
                      : "demo-stripes bg-amberx-400/15 text-amberx-300 shadow-[inset_0_0_0_1px_rgba(255,176,32,0.5)]"
                    : "text-fog-600 hover:text-fog-300"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------- terminal ------------------------------- */

function Terminal() {
  const { state, setMode } = useRadar();

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink-950">
        <RadarLogo size={72} />
        <p className="font-mono text-xs tracking-[0.3em] text-fog-500">
          INICIANDO RADAR<span className="blink-caret ml-1 text-phos-400">▊</span>
        </p>
      </div>
    );
  }

  const demo = state.mode === "DEMO";
  const out = state.engine;
  const liveCount = state.health.filter((h) => h.status === "LIVE").length;
  const waiting = !out && state.now - state.startedAt < 8000;
  const noData = !out && state.now - state.startedAt >= 8000 && liveCount === 0;

  return (
    <div className="min-h-screen">
      {/* capas ambientales */}
      <div className="grid-overlay pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
      <div className="scanlines pointer-events-none fixed inset-0 z-50" aria-hidden="true" />
      <div className="sweep-band pointer-events-none fixed inset-0 z-0" aria-hidden="true" />

      <div className="relative z-10">
        <Header
          mode={state.mode} setMode={setMode} price={state.price} tickDir={state.tickDir}
          changePct={state.changePct} fundingRate={state.fundingRate}
          nextFundingTime={state.nextFundingTime} now={state.now} liveCount={liveCount}
          totalSources={state.health.length} startedAt={state.startedAt}
        />

        {demo && (
          <div className="demo-stripes border-b border-amberx-400/40 bg-amberx-400/10">
            <p className="mx-auto max-w-[1600px] px-4 py-1.5 text-center font-display text-[10px] font-bold tracking-[0.26em] text-amberx-300 md:px-6">
              MODO DEMO — DATOS SIMULADOS Y ETIQUETADOS · NO ALIMENTA EL JOURNAL REAL (§65)
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
                    Modo REAL (§65): sin datos reales no hay señal — el motor emite <span className="text-amberx-300">NO TRADE</span> y el
                    Data Health marca cada fuente UNAVAILABLE. Si tu red bloquea Binance/OKX/Bybit, cambia a <span className="text-amberx-300">DEMO</span> para
                    ver el pipeline completo con datos simulados y etiquetados.
                  </p>
                </div>
                <button
                  onClick={() => setMode("DEMO")}
                  className="demo-stripes border border-amberx-400/60 bg-amberx-400/10 px-5 py-2.5 font-display text-[11px] font-bold tracking-[0.22em] text-amberx-300 transition-colors hover:bg-amberx-400/20"
                >
                  ACTIVAR DEMO
                </button>
              </div>
            </div>
          )}

          {waiting && (
            <div className="flex items-center justify-center gap-3 py-10 font-mono text-[11px] tracking-[0.24em] text-fog-500">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-phos-400" />
              CONECTANDO FUENTES Y CALENTANDO EL MOTOR
            </div>
          )}

          {/* fila 1: señal · régimen · health */}
          <div className="grid grid-cols-12 gap-4">
            <Reveal className="col-span-12 lg:col-span-4">
              <SignalPanel signal={out?.signal ?? null} demo={demo} />
            </Reveal>
            <Reveal className="col-span-12 md:col-span-6 lg:col-span-3">
              {out ? <RegimePanel out={out} /> : <EmptyPanel title="RÉGIMEN DE MERCADO" />}
            </Reveal>
            <Reveal className="col-span-12 md:col-span-6 lg:col-span-5">
              <HealthPanel health={state.health} />
            </Reveal>
          </div>

          {/* fila 1.5: QUÉ ESTÁ PASANDO (narrativa + sentimiento + basis + liq/exchange) */}
          <Reveal>
            <BriefingPanel
              briefing={state.briefing}
              sentiment={state.sentiment}
              basis={state.basis}
              liqAgg={state.liqAgg}
              demo={demo}
            />
          </Reveal>

          {/* fila 2: order flow · liquidaciones · liquidez */}
          <Reveal>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-5">
                {out ? <OrderFlowPanel out={out} /> : <EmptyPanel title="ORDER FLOW" />}
              </div>
              <div className="col-span-12 md:col-span-7 lg:col-span-4">
                {out ? <LiquidationsPanel out={out} liqs={state.liqs} demo={demo} /> : <EmptyPanel title="LIQUIDACIONES OBSERVADAS" />}
              </div>
              <div className="col-span-12 md:col-span-5 lg:col-span-3">
                {out && state.price > 0 ? <LiquidityPanel out={out} price={state.price} /> : <EmptyPanel title="MAPA DE LIQUIDEZ" />}
              </div>
            </div>
          </Reveal>

          {/* fila 3: MTF · funding/cross · opciones */}
          <Reveal>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 md:col-span-6 lg:col-span-4">
                {out ? <MtfPanel out={out} /> : <EmptyPanel title="CONFLUENCIA MTF" />}
              </div>
              <div className="col-span-12 md:col-span-6 lg:col-span-4">
                <CrossPanel state={state} />
              </div>
              <div className="col-span-12 lg:col-span-4">
                <OptionsPanel state={state} />
              </div>
            </div>
          </Reveal>

          {/* fila 4: journal · replay */}
          <Reveal>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-7">
                <JournalPanel journal={state.journal} />
              </div>
              <div className="col-span-12 lg:col-span-5">
                <ReplayPanel frames={state.frames} />
              </div>
            </div>
          </Reveal>

          {/* fila 5: fuentes del radar valoradas por el usuario */}
          <Reveal>
            <SourcesPanel sources={state.sources} />
          </Reveal>

          {/* fila 6: alertas */}
          <Reveal>
            <AlertsPanel alerts={state.alerts} />
          </Reveal>

          {/* footer de arquitectura */}
          <footer className="border-t border-line pb-8 pt-6">
            <div className="grid gap-6 md:grid-cols-3">
              <div>
                <p className="font-display text-[10px] font-bold tracking-[0.24em] text-fog-500">PIPELINE (§3)</p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-fog-600">
                  DATA SOURCES → CONNECTORS → NORMALIZER → VALIDATION → FEATURE ENGINE → EVENT ENGINE →
                  RÉGIMEN → ESCENARIO → SEÑAL → CALIBRACIÓN → JOURNAL / ALERTAS / REPLAY / UI
                </p>
              </div>
              <div>
                <p className="font-display text-[10px] font-bold tracking-[0.24em] text-fog-500">VERDAD DE LOS DATOS (§66)</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TruthBadge truth="REAL" /><TruthBadge truth="ESTIMATED" /><TruthBadge truth="PARTIAL" /><TruthBadge truth="UNAVAILABLE" /><TruthBadge truth="DEMO" />
                </div>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-fog-600">
                  Las estimaciones nunca se presentan como observaciones. Sin dato crítico ⇒ NO TRADE (§39/§71).
                </p>
              </div>
              <div>
                <p className="font-display text-[10px] font-bold tracking-[0.24em] text-fog-500">LÍMITES DE ESTE ENTORNO</p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-fog-600">
                  Build estático sin backend: SQLite, WS bridge, CoinGlass/Hyblock (requieren API key que nunca debe
                  tocar el frontend, §6/§18), .bat de Windows y tests viven en <span className="text-fog-300">docs/ARCHITECTURE.md</span> como fase pendiente.
                  El journal persiste en localStorage como sustituto documentado.
                </p>
              </div>
            </div>
            <p className="mt-6 font-mono text-[9px] leading-relaxed text-fog-600">
              LIQRADAR es una herramienta de análisis y evidencia, no un oráculo: no adivina el precio y un buen backtest no garantiza
              rendimiento futuro (§74). Nada de lo mostrado constituye asesoramiento financiero.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <section className="panel corner-frame flex h-full min-h-[180px] flex-col items-center justify-center gap-2 pt-5">
      <span className="panel-tag">{title}</span>
      <p className="font-mono text-[10px] tracking-[0.24em] text-fog-600">
        ESPERANDO DATOS<span className="blink-caret ml-1 text-phos-400">▊</span>
      </p>
      <p className="font-mono text-[9px] text-fog-600">sin datos no hay feature — sin feature no hay voto (§77)</p>
    </section>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Terminal />
    </ErrorBoundary>
  );
}
