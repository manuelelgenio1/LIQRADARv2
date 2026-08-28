/* ============================================================
 * LIQRADAR — Paneles de profundidad (spec §22/§33/§34/§35/§49)
 * Microestructura observada en sesión + opciones + validación.
 * Regla de oro: todo lo mostrado aquí proviene de datos reales
 * capturados desde el arranque; nunca se inventa histórico (§21).
 * ============================================================ */

import { useMemo } from "react";
import type {
  FootprintLevel, JournalEntry, MigrationEvent, OptionsSummary, VolumeProfileData,
} from "../types";
import type { FootprintResult } from "../lib/store";
import { sessionLabel } from "../lib/micro";
import { computeValidation } from "../lib/validation";
import {
  clamp01, formatClock, formatNumber, formatPercent, formatPercentRaw, formatPrice, formatUsd,
} from "../lib/safe";
import { Bar, BipolarBar, Chip, Panel, Row, TruthBadge } from "./ui";

/** Estado de calentamiento vivo: el panel está despierto esperando datos. */
function Warming({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
      <svg width="46" height="46" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="20" stroke="#1c3054" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="11" stroke="#1c3054" strokeWidth="1" strokeDasharray="3 5" />
        <g className="radar-rotor">
          <path d="M24 24 L24 4 A20 20 0 0 1 38 10 Z" fill="#3df5a5" fillOpacity="0.12" />
          <line x1="24" y1="24" x2="24" y2="4" stroke="#3df5a5" strokeWidth="1.4" />
        </g>
        <circle cx="24" cy="24" r="2" fill="#3df5a5" />
      </svg>
      <div>
        <p className="font-display text-[9px] font-bold tracking-[0.24em] text-fog-500">
          {label}<span className="blink-caret ml-1 text-phos-400">▊</span>
        </p>
        <p className="mx-auto mt-1.5 max-w-[250px] font-mono text-[9px] leading-relaxed text-fog-600">{hint}</p>
      </div>
    </div>
  );
}

/* ------------------------------ §34 FOOTPRINT ------------------------------ */

function FootprintRow({ lvl, maxSide, maxAbsDelta }: { lvl: FootprintLevel; maxSide: number; maxAbsDelta: number }) {
  const sellPct = maxSide > 0 ? (lvl.sellUsd / maxSide) * 100 : 0;
  const buyPct = maxSide > 0 ? (lvl.buyUsd / maxSide) * 100 : 0;
  const isMax = maxAbsDelta > 0 && Math.abs(lvl.delta) === maxAbsDelta;
  return (
    <div
      className={`group grid grid-cols-[64px_1fr_1fr_70px] items-center gap-1.5 border-b border-line/40 py-[3px] transition-colors last:border-b-0 hover:bg-ink-700/40 ${
        isMax ? "bg-ink-700/50" : ""
      }`}
    >
      <span className="font-mono text-[10px] font-semibold tabular-nums text-fog-300">
        {formatPrice(lvl.price, 0)}
      </span>
      <div className="flex justify-end">
        <div
          className="bar-anim h-3 bg-danger-400/80 shadow-[0_0_8px_rgba(255,77,109,0.35)]"
          style={{ width: `${sellPct}%`, transformOrigin: "right center" }}
        />
      </div>
      <div className="flex justify-start">
        <div
          className="bar-anim h-3 bg-phos-400/80 shadow-[0_0_8px_rgba(61,245,165,0.35)]"
          style={{ width: `${buyPct}%`, transformOrigin: "left center" }}
        />
      </div>
      <span
        className={`text-right font-mono text-[10px] font-bold tabular-nums ${
          lvl.delta >= 0 ? "text-phos-300" : "text-danger-300"
        } ${isMax ? "phos" : ""}`}
      >
        {formatUsd(lvl.delta)}
      </span>
    </div>
  );
}

export function FootprintPanel({ footprint }: { footprint: FootprintResult }) {
  const { levels, netDelta, imbalance, buyUsd, sellUsd } = footprint;
  const maxSide = Math.max(1, ...levels.map((l) => Math.max(l.buyUsd, l.sellUsd)));
  const maxAbsDelta = levels.length ? Math.max(...levels.map((l) => Math.abs(l.delta))) : 0;
  const hasData = levels.length >= 2;

  return (
    <Panel
      title="§34 FOOTPRINT · DELTA POR NIVEL"
      truth={hasData ? "REAL" : "UNAVAILABLE"}
      right={<Chip tone={imbalance >= 0 ? "phos" : "danger"}>{imbalance >= 0 ? "COMPRADORES" : "VENDEDORES"}</Chip>}
    >
      <div className="px-5 pb-4">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div>
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">DELTA NETO 5M</p>
            <p className={`font-mono text-sm font-bold tabular-nums ${netDelta >= 0 ? "text-phos-300" : "text-danger-300"}`}>
              {formatUsd(netDelta)}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">COMPRA / VENTA</p>
            <p className="font-mono text-sm font-bold tabular-nums text-fog-100">
              <span className="text-phos-300">{formatUsd(buyUsd)}</span>
              <span className="mx-1 text-fog-600">/</span>
              <span className="text-danger-300">{formatUsd(sellUsd)}</span>
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">DESEQUILIBRIO</p>
            <BipolarBar value={imbalance} />
          </div>
        </div>

        {!hasData ? (
          <Warming label="RECOLECTANDO FOOTPRINT" hint="se arma con cada trade de futuros observado (compra/venta por nivel de precio)" />
        ) : (
          <>
            <div className="grid grid-cols-[64px_1fr_1fr_70px] gap-1.5 border-b border-line pb-1">
              <span className="font-mono text-[8px] tracking-[0.14em] text-fog-600">PRECIO</span>
              <span className="text-right font-mono text-[8px] tracking-[0.14em] text-danger-300/70">◄ VENTA</span>
              <span className="font-mono text-[8px] tracking-[0.14em] text-phos-300/70">COMPRA ►</span>
              <span className="text-right font-mono text-[8px] tracking-[0.14em] text-fog-600">DELTA</span>
            </div>
            <div className="mt-1 max-h-52 overflow-y-auto">
              {levels.slice(0, 14).map((l) => (
                <FootprintRow key={l.price} lvl={l} maxSide={maxSide} maxAbsDelta={maxAbsDelta} />
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------- §35 VOLUME PROFILE --------------------------- */

export function VolumeProfilePanel({ vprofile, price }: { vprofile: VolumeProfileData | null; price: number }) {
  const hasData = !!vprofile && vprofile.levels.length >= 3;

  const view = useMemo(() => {
    if (!vprofile) return null;
    const lvls = vprofile.levels;
    const maxVol = Math.max(...lvls.map((l) => l.volume));
    const hi = Math.max(...lvls.map((l) => l.price));
    const lo = Math.min(...lvls.map((l) => l.price));
    return { lvls, maxVol, hi, lo };
  }, [vprofile]);

  return (
    <Panel
      title="§35 PERFIL DE VOLUMEN · SESIÓN"
      truth={hasData ? "REAL" : "UNAVAILABLE"}
      right={hasData && vprofile ? <Chip tone="info">{sessionLabel(vprofile.coverageSince)}</Chip> : undefined}
    >
      <div className="px-5 pb-4">
        {!hasData || !view || !vprofile ? (
          <Warming label="CONSTRUYENDO PERFIL" hint="POC y zona de valor se calculan solo con volumen observado desde el arranque — nunca se inventa histórico" />
        ) : (
          <div className="flex gap-4">
            {/* histograma horizontal: precio arriba→abajo, volumen → */}
            <div className="relative w-44 shrink-0 self-stretch">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                {/* zona de valor (entre VAL y VAH) */}
                {(() => {
                  const y = (p: number) => ((view.hi - p) / (view.hi - view.lo)) * 100;
                  return (
                    <rect
                      x="0" y={Math.min(y(vprofile.vah), y(vprofile.val))}
                      width="100" height={Math.abs(y(vprofile.val) - y(vprofile.vah))}
                      fill="rgba(61,245,165,0.06)"
                    />
                  );
                })()}
                {view.lvls.map((l) => {
                  const yTop = ((view.hi - (l.price + vprofile.bucket / 2)) / (view.hi - view.lo)) * 100;
                  const yBot = ((view.hi - (l.price - vprofile.bucket / 2)) / (view.hi - view.lo)) * 100;
                  const w = (l.volume / view.maxVol) * 100;
                  const isPoc = l.price === vprofile.poc;
                  const inVa = l.price >= vprofile.val && l.price <= vprofile.vah;
                  return (
                    <rect
                      key={l.price}
                      x="0" y={yTop} width={w} height={Math.max(0.6, yBot - yTop - 0.4)}
                      fill={isPoc ? "#ffb020" : inVa ? "rgba(61,245,165,0.75)" : "rgba(130,153,184,0.4)"}
                      className={isPoc ? "" : ""}
                    />
                  );
                })}
                {/* línea de precio actual */}
                {price > view.lo && price < view.hi && (
                  <line
                    x1="0" x2="100"
                    y1={((view.hi - price) / (view.hi - view.lo)) * 100}
                    y2={((view.hi - price) / (view.hi - view.lo)) * 100}
                    stroke="#e7eef9" strokeWidth="0.7" strokeDasharray="3 2"
                  />
                )}
              </svg>
            </div>

            {/* lecturas */}
            <div className="min-w-0 flex-1 space-y-2.5">
              <Row label="POC · MÁXIMO VOLUMEN" value={formatPrice(vprofile.poc, 0)} tone="amber" sub="point of control" />
              <Row label="VAH · TECHO DE VALOR" value={formatPrice(vprofile.vah, 0)} tone="phos" sub="value area high" />
              <Row label="VAL · SUELO DE VALOR" value={formatPrice(vprofile.val, 0)} tone="phos" sub="value area low" />
              <Row label="VOLUMEN SESIÓN" value={formatUsd(vprofile.totalUsd)} tone="fog" />
              <Row
                label="PRECIO vs POC"
                value={price > 0 && vprofile.poc > 0 ? formatPercent(((price - vprofile.poc) / vprofile.poc) * 100) : "—"}
                tone={price >= vprofile.poc ? "phos" : "danger"}
                sub={price >= vprofile.poc ? "sobre el control" : "bajo el control"}
              />
              <p className="border-t border-line/50 pt-2 font-mono text-[8px] leading-relaxed text-fog-600">
                cobertura real desde {formatClock(vprofile.coverageSince)} · ámbar = POC · verde = zona de valor (70%)
              </p>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* -------------------------- §22 MIGRACIÓN LIQUIDEZ -------------------------- */

export function MigrationPanel({ migrations }: { migrations: MigrationEvent[] }) {
  const hasData = migrations.length > 0;
  const upCount = migrations.filter((m) => m.to > m.from).length;
  const bias = migrations.length ? (upCount / migrations.length) * 2 - 1 : 0;

  return (
    <Panel
      title="§22 MIGRACIÓN DE LIQUIDEZ"
      truth={hasData ? "ESTIMATED" : "UNAVAILABLE"}
      right={hasData ? <Chip tone={bias >= 0 ? "phos" : "danger"}>{bias >= 0 ? "SUBE" : "BAJA"}</Chip> : undefined}
    >
      <div className="px-5 pb-4">
        {!hasData ? (
          <Warming label="VIGILANDO EL LIBRO" hint="detecta órdenes grandes que se retiran y se recolocan en otro nivel (migración de liquidez)" />
        ) : (
          <>
            <div className="mb-2">
              <p className="mb-1 font-mono text-[9px] tracking-[0.16em] text-fog-600">SESGO DE MIGRACIÓN</p>
              <BipolarBar value={bias} />
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {migrations.slice(0, 9).map((m) => {
                const rising = m.to > m.from;
                return (
                  <li key={m.id} className="feed-item flex items-center gap-2 border-b border-line/40 py-1 last:border-b-0">
                    <span className="font-mono text-[9px] tabular-nums text-fog-600">{formatClock(m.ts)}</span>
                    <span className={`font-display text-[8px] font-bold tracking-[0.12em] ${m.side === "bid" ? "text-phos-300" : "text-danger-300"}`}>
                      {m.side === "bid" ? "BID" : "ASK"}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-fog-300">
                      {formatPrice(m.from, 0)}
                      <span className={`mx-1 ${rising ? "text-phos-300" : "text-danger-300"}`}>{rising ? "▲" : "▼"}</span>
                      {formatPrice(m.to, 0)}
                    </span>
                    <span className="ml-auto font-mono text-[10px] font-semibold tabular-nums text-fog-100">{formatUsd(m.usd)}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 border-t border-line/50 pt-2 font-mono text-[8px] leading-relaxed text-fog-600">
              inferencia del libro (retiro + recolocación cercana) — evento estimado, no spoofing confirmado
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------- §33 OPCIONES EXTENDIDAS --------------------------- */

export function OptionsDeepPanel({ options, price }: { options: OptionsSummary | null; price: number }) {
  const live = !!options && options.truth === "REAL";
  const ts = options?.termStructure ?? [];

  return (
    <Panel
      title="§33 OPCIONES · ESTRUCTURA Y SESGO"
      truth={live ? "REAL" : "UNAVAILABLE"}
      right={live ? <TruthBadge truth="ESTIMATED" label="MAX PAIN: DERIVADO" /> : undefined}
    >
      <div className="px-5 pb-4">
        {!live || !options ? (
          <Warming label="ESPERANDO OI DE OPCIONES" hint="Deribit entrega OI por strike, DVOL y vencimientos; si la fuente cae, este panel queda UNAVAILABLE sin inventar nada" />
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-3">
            <div>
              <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">OI TOTAL</p>
              <p className="font-mono text-sm font-bold tabular-nums text-fog-100">{formatUsd(options.totalOi)}</p>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">PUT / CALL</p>
              <p className={`font-mono text-sm font-bold tabular-nums ${(options.putCallRatio ?? 1) >= 1 ? "text-danger-300" : "text-phos-300"}`}>
                {formatNumber(options.putCallRatio, 2)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">DVOL · IV 30D</p>
              <p className="font-mono text-sm font-bold tabular-nums text-fog-100">{formatPercentRaw(options.atmIv, 1)}</p>
            </div>
            <div>
              <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">SKEW 25Δ (DERIVADO)</p>
              <p className={`font-mono text-sm font-bold tabular-nums ${(options.skew25 ?? 0) >= 0 ? "text-amberx-300" : "text-fog-100"}`}>
                {options.skew25 !== undefined ? formatPercentRaw(options.skew25, 2) : "—"}
              </p>
            </div>
            <div className="col-span-2">
              <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">
                MAX PAIN vs PRECIO {price > 0 && options.maxPain ? `(${formatPercent(((price - options.maxPain) / options.maxPain) * 100)})` : ""}
              </p>
              <p className="font-mono text-sm font-bold tabular-nums text-amberx-300">
                {options.maxPain ? formatPrice(options.maxPain, 0) : "—"}
                <span className="ml-2 font-mono text-[10px] font-normal text-fog-500">precio {formatPrice(price, 0)}</span>
              </p>
            </div>

            {/* term structure de IV */}
            {ts.length >= 2 && (
              <div className="col-span-2 md:col-span-3">
                <p className="mb-1 font-mono text-[9px] tracking-[0.16em] text-fog-600">TERM STRUCTURE · IV ATM POR VENCIMIENTO</p>
                <div className="flex items-end gap-1.5" style={{ height: 56 }}>
                  {(() => {
                    const ivs = ts.map((t) => t.iv);
                    const lo = Math.min(...ivs); const hi = Math.max(...ivs);
                    return ts.map((t) => {
                      const h = hi > lo ? 18 + ((t.iv - lo) / (hi - lo)) * 70 : 50;
                      return (
                        <div key={t.expiry} className="group flex flex-1 flex-col items-center gap-1">
                          <span className="font-mono text-[8px] tabular-nums text-fog-500 opacity-0 transition-opacity group-hover:opacity-100">
                            {formatPercentRaw(t.iv, 1)}
                          </span>
                          <div
                            className="bar-anim w-full bg-info-400/60 transition-colors group-hover:bg-info-300"
                            style={{ height: `${h}%`, transformOrigin: "bottom center" }}
                          />
                          <span className="font-mono text-[7px] tracking-[0.06em] text-fog-600">{t.expiry}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ------------------------ §49 PREDICCIÓN VS REALIDAD ------------------------ */

function CalibrationBucket({ b }: { b: { range: string; n: number; hits: number; rate: number; avgConf: number } }) {
  const noSample = b.n < 3;
  return (
    <div className="grid grid-cols-[64px_1fr_1fr_72px] items-center gap-2 border-b border-line/40 py-1.5 last:border-b-0">
      <span className="font-mono text-[10px] font-semibold tabular-nums text-fog-300">{b.range}</span>
      {/* confianza prometida */}
      <div>
        <div className="h-1.5 w-full bg-ink-700">
          <div className="liq-bar h-full bg-info-400/70" style={{ width: `${Math.round(b.avgConf * 100)}%` }} />
        </div>
      </div>
      {/* acierto real */}
      <div>
        <div className="h-1.5 w-full bg-ink-700">
          <div
            className={`liq-bar h-full ${noSample ? "bg-fog-600/50" : b.rate >= b.avgConf - 0.05 ? "bg-phos-400" : "bg-danger-400"}`}
            style={{ width: `${Math.round(clamp01(b.rate) * 100)}%` }}
          />
        </div>
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-fog-500">
        {noSample ? "n<3" : `${b.hits}/${b.n} · ${Math.round(b.rate * 100)}%`}
      </span>
    </div>
  );
}

export function ValidationPanel({ journal }: { journal: JournalEntry[] }) {
  const stats = useMemo(() => computeValidation(journal), [journal]);
  const hasSample = stats.resolved >= 10;
  const hitColor = stats.hitRate >= 0.55 ? "text-phos-300" : stats.hitRate >= 0.45 ? "text-amberx-300" : "text-danger-300";

  return (
    <Panel
      title="§49 PREDICCIÓN VS REALIDAD · ¿APORTA VALOR?"
      truth={hasSample ? "REAL" : "PARTIAL"}
      right={<Chip tone="fog">HORIZONTE +15M · SOLO REAL (§65)</Chip>}
    >
      <div className="px-5 pb-4">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="border border-line bg-ink-900/60 p-3">
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">SEÑALES RESUELTAS</p>
            <p className="font-mono text-xl font-bold tabular-nums text-fog-100">{stats.resolved}</p>
          </div>
          <div className="border border-line bg-ink-900/60 p-3">
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">HIT RATE</p>
            <p className={`font-mono text-xl font-bold tabular-nums ${hasSample ? hitColor : "text-fog-600"}`}>
              {hasSample ? formatPercentRaw(stats.hitRate * 100, 0) : "—"}
            </p>
          </div>
          <div className="border border-line bg-ink-900/60 p-3">
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">ERROR CALIBRACIÓN</p>
            <p className={`font-mono text-xl font-bold tabular-nums ${hasSample && stats.calibrationError <= 0.1 ? "text-phos-300" : "text-amberx-300"}`}>
              {hasSample ? formatPercentRaw(stats.calibrationError * 100, 0) : "—"}
            </p>
          </div>
          <div className="border border-line bg-ink-900/60 p-3">
            <p className="font-mono text-[9px] tracking-[0.16em] text-fog-600">EXPECTANCIA (R)</p>
            <p className={`font-mono text-xl font-bold tabular-nums ${!hasSample ? "text-fog-600" : stats.expectancyPct >= 0 ? "text-phos-300" : "text-danger-300"}`}>
              {hasSample ? `${stats.expectancyPct >= 0 ? "+" : ""}${formatNumber(stats.expectancyPct, 2)}R` : "—"}
            </p>
          </div>
        </div>

        {!hasSample ? (
          <div className="px-2 py-4">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="font-mono text-[9px] tracking-[0.18em] text-fog-500">
                RECOLECTANDO MUESTRA<span className="blink-caret ml-1 text-phos-400">▊</span>
              </p>
              <p className="font-mono text-[10px] font-bold tabular-nums text-phos-300">{stats.resolved}/10</p>
            </div>
            <Bar pct={stats.resolved / 10} tone="phos" />
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-fog-600">
              cada señal se registra y se mide a +15m contra el precio real · sin ≥10 señales resueltas no se publica ninguna métrica — la confianza se calibra contra resultados, no se inventa
            </p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <div className="grid grid-cols-[64px_1fr_1fr_72px] gap-2 border-b border-line pb-1">
                <span className="font-mono text-[8px] tracking-[0.14em] text-fog-600">CONFIANZA</span>
                <span className="font-mono text-[8px] tracking-[0.14em] text-info-300/80">PROMETIDA</span>
                <span className="font-mono text-[8px] tracking-[0.14em] text-phos-300/80">ACIERTO REAL</span>
                <span className="text-right font-mono text-[8px] tracking-[0.14em] text-fog-600">MUESTRA</span>
              </div>
              <div className="mt-1">
                {stats.buckets.map((b) => <CalibrationBucket key={b.range} b={b} />)}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-1 font-mono text-[9px] tracking-[0.16em] text-fog-600">POR RÉGIMEN DE MERCADO</p>
                {stats.byRegime.slice(0, 4).map((r) => (
                  <div key={r.regime} className="flex items-center gap-2 border-b border-line/40 py-1 last:border-b-0">
                    <span className="w-32 shrink-0 font-display text-[9px] font-bold tracking-[0.1em] text-fog-300">{r.regime.replace(/_/g, " ")}</span>
                    <div className="h-1.5 flex-1 bg-ink-700">
                      <div className={`liq-bar h-full ${r.rate >= 0.5 ? "bg-phos-400" : "bg-danger-400"}`} style={{ width: `${Math.round(r.rate * 100)}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-[9px] tabular-nums text-fog-500">{r.hits}/{r.n} · {Math.round(r.rate * 100)}%</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1 font-mono text-[9px] tracking-[0.16em] text-fog-600">POR ESCENARIO</p>
                {stats.byScenario.slice(0, 4).map((s) => (
                  <div key={s.scenario} className="flex items-center gap-2 border-b border-line/40 py-1 last:border-b-0">
                    <span className="w-32 shrink-0 font-display text-[9px] font-bold tracking-[0.1em] text-fog-300">{s.scenario.replace(/_/g, " ")}</span>
                    <div className="h-1.5 flex-1 bg-ink-700">
                      <div className={`liq-bar h-full ${s.rate >= 0.5 ? "bg-info-400" : "bg-fog-600"}`} style={{ width: `${Math.round(s.rate * 100)}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right font-mono text-[9px] tabular-nums text-fog-500">{s.hits}/{s.n} · {Math.round(s.rate * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="border-t border-line/50 pt-2 font-mono text-[8px] leading-relaxed text-fog-600">
                §74 · un buen backtest no garantiza rendimiento futuro · los casos ambiguos se excluyen (§46)
              </p>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
