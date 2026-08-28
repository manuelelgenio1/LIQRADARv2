import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Background from "./components/Background";
import TickerTape from "./components/TickerTape";
import Header from "./components/Header";
import StatsStrip from "./components/StatsStrip";
import LiquidationMap, { type Marker } from "./components/LiquidationMap";
import EventFeed from "./components/EventFeed";
import Sparkline from "./components/Sparkline";
import Calculator from "./components/Calculator";
import { useMarket } from "./lib/market";
import { computeLadder } from "./lib/heatmap";
import { useReveal } from "./hooks/useReveal";
import { fmtClock } from "./lib/format";

export default function App() {
  const m = useMarket();
  const [marker, setMarker] = useState<Marker>(null);
  const [flashKey, setFlashKey] = useState(0);
  const lastFlashRef = useRef("");

  const ladder = useMemo(
    () => computeLadder(m.price, m.events, m.nowTs),
    [m.price, m.events, m.nowTs]
  );

  // screen-edge flash when a whale liquidation lands
  useEffect(() => {
    const ev = m.events[0];
    if (ev && ev.usd >= 350_000 && ev.id !== lastFlashRef.current) {
      lastFlashRef.current = ev.id;
      setFlashKey((k) => k + 1);
    }
  }, [m.events]);

  const onMarker = useCallback((mk: Marker) => setMarker(mk), []);

  const statsRef = useReveal<HTMLElement>();
  const gridRef = useReveal<HTMLDivElement>();
  const calcRef = useReveal<HTMLElement>();
  const footRef = useReveal<HTMLElement>();

  return (
    <div className="relative min-h-screen">
      <Background />

      {flashKey > 0 && (
        <div key={flashKey} className="whale-flash pointer-events-none fixed inset-0 z-50" aria-hidden="true" />
      )}

      <div className="relative z-10">
        <TickerTape events={m.events} />

        <div className="mx-auto max-w-[1440px] px-4 md:px-7">
          <Header m={m} />

          <section ref={statsRef} aria-label="Resumen de sesión" className="mt-1">
            <StatsStrip m={m} />
          </section>

          <div ref={gridRef} className="mt-5 grid items-stretch gap-5 lg:grid-cols-12">
            <div className="min-h-[560px] lg:col-span-6">
              <LiquidationMap price={m.price} ladder={ladder} marker={marker} />
            </div>
            <div className="flex flex-col gap-5 lg:col-span-6">
              <Sparkline history={m.history} />
              <EventFeed m={m} />
            </div>
          </div>

          <section ref={calcRef} className="mt-5" aria-label="Calculadora">
            <Calculator price={m.price} onMarker={onMarker} />
          </section>

          <footer ref={footRef} className="mt-10 border-t border-line py-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-xl">
                <p className="font-display text-sm font-bold tracking-[0.16em] text-fog-300">
                  LIQ<span className="text-short-400">RADAR</span>
                  <span className="ml-3 font-mono text-[10px] font-normal tracking-[0.2em] text-fog-600">v1.0</span>
                </p>
                <p className="mt-3 font-mono text-[11px] leading-relaxed text-fog-600">
                  Datos en vivo de los streams públicos de Binance Futures (markPrice y forceOrder).
                  Los niveles del mapa son <span className="text-fog-300">estimaciones de concentración</span> de
                  posiciones apalancadas, no órdenes reales de la cartera. Si el stream no está disponible,
                  la terminal opera con un feed simulado claramente etiquetado.
                </p>
                <p className="mt-2 font-mono text-[11px] text-fog-600">
                  Esto no es asesoramiento financiero. El apalancamiento liquida.
                </p>
              </div>
              <div className="font-mono text-[11px] leading-relaxed text-fog-600">
                <p>
                  SESIÓN INICIADA <span className="text-fog-300">{fmtClock(m.stats.startedAt)}</span>
                </p>
                <p>
                  FUENTE{" "}
                  <span className={m.status === "live" ? "text-gain-400" : "text-short-300"}>
                    {m.status === "live" ? "BINANCE FUTURES · WS" : m.status === "sim" ? "SIMULADOR LOCAL" : "CONECTANDO…"}
                  </span>
                </p>
                <p className="mt-2 text-[10px] text-fog-600/70">
                  LONGS liquidan al caer · SHORTS liquidan al subir
                </p>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
