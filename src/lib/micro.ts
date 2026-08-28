/* ============================================================
 * LIQRADAR — Microestructura profunda (spec §21/§22/§34/§35)
 * Funciones puras sobre datos YA OBSERVADOS en sesión:
 *  - §34 Footprint: delta comprador/vendedor por nivel de precio
 *  - §35 Volume profile: POC / VAH / VAL de la sesión actual
 *  - §22 Migración de liquidez: órdenes grandes que cambian de precio
 * Regla §21: nunca se inventa histórico anterior al inicio de sesión.
 * Regla §8: toda entrada pasa por isFiniteNumber antes de calcular.
 * ============================================================ */

import type { Book, FootprintLevel, MigrationEvent, Trade, VolumeProfileData } from "../types";
import { isFiniteNumber, safeRatio, uid } from "./safe";

/** §34 — Footprint: agrupa trades reales en buckets de precio. */
export function footprintOf(trades: Trade[], bucket: number, windowMs: number, now: number): {
  levels: FootprintLevel[];
  netDelta: number;
  buyUsd: number;
  sellUsd: number;
  imbalance: number; // -1..1 (>0 = compradores dominan)
} {
  const from = now - windowMs;
  const map = new Map<number, FootprintLevel>();
  let buyUsd = 0; let sellUsd = 0;
  for (const t of trades) {
    if (t.ts < from) continue;
    if (!isFiniteNumber(t.price) || t.price <= 0 || !isFiniteNumber(t.qty) || t.qty <= 0) continue;
    const key = Math.round(t.price / bucket) * bucket;
    const notional = t.price * t.qty;
    const lvl = map.get(key) ?? { price: key, buyUsd: 0, sellUsd: 0, delta: 0, count: 0 };
    if (t.isBuyerMaker) { lvl.sellUsd += notional; sellUsd += notional; }
    else { lvl.buyUsd += notional; buyUsd += notional; }
    lvl.count += 1;
    lvl.delta = lvl.buyUsd - lvl.sellUsd;
    map.set(key, lvl);
  }
  const levels = [...map.values()].sort((a, b) => b.price - a.price);
  const netDelta = buyUsd - sellUsd;
  return { levels, netDelta, buyUsd, sellUsd, imbalance: safeRatio(netDelta, buyUsd + sellUsd) };
}

/** §35 — Volume profile: POC + Value Area (≈70 % del volumen alrededor del POC). */
export function volumeProfileOf(trades: Trade[], bucket: number, now: number): VolumeProfileData | null {
  const map = new Map<number, number>();
  let coverageSince = Infinity; let totalUsd = 0;
  for (const t of trades) {
    if (!isFiniteNumber(t.price) || t.price <= 0 || !isFiniteNumber(t.qty) || t.qty <= 0) continue;
    const key = Math.round(t.price / bucket) * bucket;
    const notional = t.price * t.qty;
    map.set(key, (map.get(key) ?? 0) + notional);
    totalUsd += notional;
    if (t.ts < coverageSince) coverageSince = t.ts;
  }
  if (map.size < 3 || !isFiniteNumber(coverageSince)) return null;

  const levels = [...map.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);

  // POC = nivel con mayor volumen
  let pocIdx = 0;
  levels.forEach((l, i) => { if (l.volume > levels[pocIdx].volume) pocIdx = i; });
  const poc = levels[pocIdx].price;

  // Value area: expandir desde el POC hasta cubrir ~70 % del volumen
  const target = totalUsd * 0.7;
  let acc = levels[pocIdx].volume;
  let lo = pocIdx; let hi = pocIdx;
  while (acc < target && (lo > 0 || hi < levels.length - 1)) {
    const vLo = lo > 0 ? levels[lo - 1].volume : -1;
    const vHi = hi < levels.length - 1 ? levels[hi + 1].volume : -1;
    if (vHi >= vLo) { hi += 1; acc += vHi; } else { lo -= 1; acc += vLo; }
  }

  return {
    levels, poc,
    vah: levels[hi].price + bucket / 2,
    val: levels[lo].price - bucket / 2,
    bucket,
    coverageSince,
    totalUsd,
  };
}

/**
 * §22 — Migración de liquidez: entre snapshots consecutivos del libro,
 * detecta liquidez grande que desaparece de un nivel y reaparece cerca
 * (misma cara). Devuelve eventos con dirección, tamaño y pasos recorridos.
 * Es una inferencia del libro => siempre "evento estimado" (§66).
 */
export function detectMigrations(
  history: Book[],
  minUsd: number,
  maxLookback: number,
  priceBucket: number
): MigrationEvent[] {
  const events: MigrationEvent[] = [];
  const recent = history.slice(-maxLookback);
  if (recent.length < 6) return events;

  const levelsOf = (b: Book, side: "bid" | "ask") => {
    const out = new Map<number, number>();
    for (const l of side === "bid" ? b.bids : b.asks) {
      if (!isFiniteNumber(l.price) || !isFiniteNumber(l.qty)) continue;
      out.set(Math.round(l.price / priceBucket) * priceBucket, l.price * l.qty);
    }
    return out;
  };

  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const cur = recent[i];
    if (cur.ts - prev.ts > 10_000) continue; // gap de datos: no inferir
    for (const side of ["bid", "ask"] as const) {
      const before = levelsOf(prev, side);
      const after = levelsOf(cur, side);
      // liquidez que desapareció
      for (const [px, usd] of before) {
        const now2 = after.get(px) ?? 0;
        const removed = usd - now2;
        if (removed < minUsd) continue;
        // ¿reapareció cerca (±3 buckets) en el mismo lado?
        let found: { to: number; size: number } | null = null;
        for (const off of [1, -1, 2, -2, 3, -3]) {
          const cand = px + off * priceBucket;
          const added = (after.get(cand) ?? 0) - (before.get(cand) ?? 0);
          if (added >= minUsd * 0.6 && (!found || added > found.size)) {
            found = { to: cand, size: Math.min(added, removed) };
          }
        }
        if (found) {
          events.push({
            id: uid(), ts: cur.ts, side,
            from: px, to: found.to, usd: found.size,
            steps: Math.abs(found.to - px) / priceBucket,
          });
        }
      }
    }
  }
  // deduplicar eventos del mismo nivel dentro de 12 s
  const seen = new Map<string, MigrationEvent>();
  for (const e of events) {
    const k = `${e.side}:${e.from}:${e.to}`;
    const prevEv = seen.get(k);
    if (!prevEv || e.ts - prevEv.ts > 12_000) seen.set(k, e);
  }
  return [...seen.values()].sort((a, b) => b.ts - a.ts).slice(0, 24);
}

/** Sesión de mercado para el volume profile (fronteras UTC estándar). */
export function sessionLabel(ts: number): "ASIA" | "LONDRES" | "NUEVA YORK" {
  const h = new Date(ts).getUTCHours();
  if (h < 8) return "ASIA";
  if (h < 13) return "LONDRES";
  return "NUEVA YORK";
}
