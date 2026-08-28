/* ============================================================
 * LIQRADAR — Radar circular (pieza central)
 *  · centro        = precio actual + veredicto
 *  · arcos arriba  = clústeres de shorts (combustible alcista)
 *  · arcos abajo   = clústeres de longs  (combustible bajista)
 *  · blips         = liquidaciones observadas (tamaño = USD,
 *                    color = lado quemado, opacidad = edad)
 *  · anillos       = distancia al precio (1% 2% 4% 8%)
 * ============================================================ */

import { useMemo } from "react";
import type { Cluster, LiqEvent, SignalResult } from "../types";
import { clamp, clamp01, formatPrice, formatUsd } from "../lib/safe";

const SIZE = 640;
const C = SIZE / 2;
const HUB_R = 92;       // radio del núcleo (veredicto)
const R_MIN = 118;      // primer anillo útil
const R_MAX = 292;      // borde exterior

function polar(r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180; // 0° = arriba, sentido horario
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Distribuye n arcos alrededor de un ángulo central con una apertura dada. */
function slotAngles(n: number, center: number, span: number): number[] {
  if (n === 0) return [];
  if (n === 1) return [center];
  const step = span / (n - 1);
  return Array.from({ length: n }, (_, i) => center - span / 2 + i * step);
}

const DIR_LABEL: Record<SignalResult["direction"], string> = {
  LONG: "LONG ▲",
  SHORT: "SHORT ▼",
  NO_TRADE: "NO TRADE",
};

export default function Radar({
  price, clusters, liqs, signal, now,
}: {
  price: number;
  clusters: Cluster[];
  liqs: LiqEvent[];
  signal: SignalResult | null;
  now: number;
}) {
  const model = useMemo(() => {
    if (!price || !isFinite(price) || price <= 0) return null;

    // escala logarítmica de distancia -> radio
    const maxDist = Math.max(8, ...clusters.map((c) => Math.abs(c.distancePct)));
    const rOf = (distPct: number) =>
      R_MIN + (R_MAX - R_MIN) * (Math.log(1 + Math.abs(distPct)) / Math.log(1 + maxDist));

    const rings = [1, 2, 4, 8].map((pct) => ({ pct, r: rOf(pct) }));

    // arcos de combustible
    const up = clusters.filter((c) => c.side === "short").sort((a, b) => a.distancePct - b.distancePct);
    const down = clusters.filter((c) => c.side === "long").sort((a, b) => b.distancePct - a.distancePct);
    const maxEst = Math.max(1, ...clusters.map((c) => c.estimatedUsd));
    const buildArcs = (list: Cluster[], angles: number[], kind: "up" | "down") =>
      list.map((c, i) => {
        const half = clamp(8 + 34 * (c.estimatedUsd / maxEst), 10, 42);
        const center = angles[i] ?? (kind === "up" ? 0 : 180);
        return {
          key: `${kind}-${i}`,
          d: arcPath(rOf(c.distancePct), center - half, center + half),
          kind,
          usd: c.estimatedUsd,
          dist: c.distancePct,
          price: c.price,
        };
      });
    const arcs = [
      ...buildArcs(up, slotAngles(up.length, 0, 150), "up"),
      ...buildArcs(down, slotAngles(down.length, 180, 150), "down"),
    ];

    // blips de liquidaciones observadas
    const blips = liqs.slice(0, 90).map((l) => {
      const distPct = ((l.price - price) / price) * 100;
      const r = clamp(rOf(distPct), R_MIN - 8, R_MAX);
      const age = now - l.ts;
      const opacity = clamp01(1 - age / 600_000) * 0.85 + 0.08;
      const radius = clamp(2.5 + Math.sqrt(l.usd) / 240, 2.5, 11);
      return {
        id: l.id,
        r,
        angle: hash(l.id) % 360,
        radius,
        opacity,
        side: l.side, // SELL = long quemado (rojo) · BUY = short quemado (verde)
        usd: l.usd,
        fresh: age < 4000,
      };
    });

    return { rings, arcs, blips };
  }, [price, clusters, liqs, now]);

  const dir = signal?.direction ?? "NO_TRADE";
  const conf = signal?.confidence ?? 0;
  const dirColor = dir === "LONG" ? "#3df5a5" : dir === "SHORT" ? "#ff4d6d" : "#8299b8";

  return (
    <div className="relative mx-auto w-full max-w-[600px]">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block w-full select-none" role="img" aria-label="Radar de liquidaciones BTC">
        <defs>
          <radialGradient id="hubGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={dirColor} stopOpacity="0.16" />
            <stop offset="70%" stopColor={dirColor} stopOpacity="0.03" />
            <stop offset="100%" stopColor={dirColor} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#3df5a5" stopOpacity="0.0" />
            <stop offset="100%" stopColor="#3df5a5" stopOpacity="0.14" />
          </linearGradient>
        </defs>

        {/* halo de fondo */}
        <circle cx={C} cy={C} r={R_MAX + 8} fill="url(#hubGlow)" />

        {/* anillos de distancia */}
        {model?.rings.map(({ pct, r }) => (
          <g key={pct}>
            <circle cx={C} cy={C} r={r} fill="none" stroke="#1c3054" strokeWidth="1" strokeDasharray="2 6" />
            <text x={C} y={C - r - 5} textAnchor="middle" fontSize="11" fill="#5c7392" fontFamily="JetBrains Mono, monospace">
              {pct}%
            </text>
          </g>
        ))}
        <circle cx={C} cy={C} r={R_MAX + 8} fill="none" stroke="#1c3054" strokeWidth="1.5" />

        {/* cruz de referencia */}
        <line x1={C} y1={C - R_MAX - 8} x2={C} y2={C + R_MAX + 8} stroke="#152238" strokeWidth="1" />
        <line x1={C - R_MAX - 8} y1={C} x2={C + R_MAX + 8} y2={C} stroke="#152238" strokeWidth="1" />

        {/* barrido */}
        <g className="radar-sweep-g" style={{ transformOrigin: `${C}px ${C}px` }}>
          <path d={`M ${C} ${C} L ${C} ${C - R_MAX - 8} A ${R_MAX + 8} ${R_MAX + 8} 0 0 1 ${C + (R_MAX + 8) * 0.5} ${C - (R_MAX + 8) * 0.866} Z`} fill="url(#beam)" />
          <line x1={C} y1={C} x2={C} y2={C - R_MAX - 8} stroke="#3df5a5" strokeWidth="1.5" strokeOpacity="0.5" />
        </g>

        {/* arcos de combustible (clústeres estimados) */}
        {model?.arcs.map((a) => (
          <path
            key={a.key}
            d={a.d}
            fill="none"
            stroke={a.kind === "up" ? "#3df5a5" : "#ff4d6d"}
            strokeOpacity={a.kind === "up" ? 0.75 : 0.7}
            strokeWidth={10}
            strokeLinecap="round"
            className="arc-anim"
            style={{ filter: `drop-shadow(0 0 6px ${a.kind === "up" ? "rgba(61,245,165,0.5)" : "rgba(255,77,109,0.5)"})` }}
          />
        ))}

        {/* blips de liquidaciones observadas */}
        {model?.blips.map((b) => {
          const [x, y] = polar(b.r, b.angle);
          const color = b.side === "SELL" ? "#ff4d6d" : "#3df5a5";
          return (
            <g key={b.id}>
              {b.fresh && <circle cx={x} cy={y} r={b.radius + 6} fill="none" stroke={color} strokeWidth="1.5" className="blip-ring" />}
              <circle cx={x} cy={y} r={b.radius} fill={color} fillOpacity={b.opacity} />
            </g>
          );
        })}

        {/* núcleo: precio + veredicto */}
        <circle cx={C} cy={C} r={HUB_R + 8} fill="#080d18" stroke={dirColor} strokeOpacity="0.5" strokeWidth="1.5" />
        <circle cx={C} cy={C} r={HUB_R} fill="#0b1322" stroke="#1c3054" strokeWidth="1" />
        {/* arco de confianza */}
        {conf > 0 && (
          <path
            d={arcPath(HUB_R + 8, 0, conf * 360)}
            fill="none"
            stroke={dirColor}
            strokeWidth="3"
            strokeLinecap="round"
            className="arc-anim"
          />
        )}
        <text x={C} y={C - 26} textAnchor="middle" fontSize="13" fill="#5c7392" fontFamily="Oxanium, sans-serif" letterSpacing="3">
          BTCUSDT PERP
        </text>
        <text x={C} y={C + 4} textAnchor="middle" fontSize="30" fontWeight="700" fill="#e7eef9" fontFamily="JetBrains Mono, monospace">
          {price > 0 ? formatPrice(price, 0) : "—"}
        </text>
        <text x={C} y={C + 34} textAnchor="middle" fontSize="17" fontWeight="700" fill={dirColor} fontFamily="Oxanium, sans-serif" letterSpacing="2">
          {DIR_LABEL[dir]}
        </text>
        <text x={C} y={C + 56} textAnchor="middle" fontSize="11" fill="#8299b8" fontFamily="JetBrains Mono, monospace">
          confianza {Math.round(conf * 100)}%
        </text>
      </svg>

      {/* leyenda superpuesta */}
      <div className="pointer-events-none absolute left-1 top-1 flex flex-col gap-1 font-mono text-[9px] text-fog-600">
        <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 rounded-full bg-phos-400" />combustible alcista (shorts)</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-3 rounded-full bg-danger-400" />combustible bajista (longs)</span>
      </div>
      <div className="pointer-events-none absolute bottom-1 right-1 font-mono text-[9px] text-fog-600">
        clústeres <span className="text-amberx-300">ESTIMADOS</span> · blips <span className="text-phos-300">OBSERVADOS</span>
      </div>
    </div>
  );
}
