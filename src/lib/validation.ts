/* ============================================================
 * LIQRADAR — §49 Prediction vs Reality
 * Valida estadísticamente si el radar aporta valor usando los
 * outcomes registrados por el journal (§48).
 * Reglas duras:
 *  - §65: las entradas DEMO NUNCA entran en las métricas REAL.
 *  - §46: los casos ambiguos (target e invalidación tocados a la
 *    vez) se excluyen del hit rate.
 *  - §74: se reporta tamaño de muestra; sin muestra no hay métrica.
 * ============================================================ */

import type { JournalEntry, Outcome, ValidationStats } from "../types";

const HORIZON = "+15m"; // horizonte principal de validación

interface Resolved {
  e: JournalEntry;
  o: Outcome;
  hit: boolean;
  rMultiple: number; // ganancia/pérdida potencial en R (target vs invalidación)
}

function resolveAll(journal: JournalEntry[]): Resolved[] {
  const out: Resolved[] = [];
  for (const e of journal) {
    if (e.demo || e.direction === "NO_TRADE") continue;
    const o = e.outcomes[HORIZON];
    if (!o || o.noData || o.ambiguous) continue;
    const hit = o.hitTarget && !o.hitInvalidation;
    const risk = e.invalidation !== undefined ? Math.abs(e.price - e.invalidation) : 0;
    const reward = e.target !== undefined ? Math.abs(e.target - e.price) : 0;
    let rMultiple = 0;
    if (risk > 0) {
      rMultiple = hit ? reward / risk : o.hitInvalidation ? -1 : 0;
    }
    out.push({ e, o, hit, rMultiple });
  }
  return out;
}

const rate = (hits: number, n: number) => (n > 0 ? hits / n : 0);

export function computeValidation(journal: JournalEntry[]): ValidationStats {
  const resolved = resolveAll(journal);
  const n = resolved.length;
  const hits = resolved.filter((r) => r.hit).length;
  const avgConfidence = n ? resolved.reduce((s, r) => s + r.e.confidence, 0) / n : 0;
  const hitRate = rate(hits, n);
  const expectancyPct = n ? resolved.reduce((s, r) => s + r.rMultiple, 0) / n : 0;

  const bucketsDef: { range: string; lo: number; hi: number }[] = [
    { range: "50–64%", lo: 0, hi: 0.64 },
    { range: "64–72%", lo: 0.64, hi: 0.72 },
    { range: "72–80%", lo: 0.72, hi: 0.8 },
    { range: "80–88%", lo: 0.8, hi: 0.88 },
    { range: "88–100%", lo: 0.88, hi: 1.01 },
  ];
  const buckets = bucketsDef.map(({ range, lo, hi }) => {
    const inB = resolved.filter((r) => r.e.confidence >= lo && r.e.confidence < hi);
    const h = inB.filter((r) => r.hit).length;
    return {
      range, n: inB.length, hits: h, rate: rate(h, inB.length),
      avgConf: inB.length ? inB.reduce((s, r) => s + r.e.confidence, 0) / inB.length : 0,
    };
  });

  const group = (key: (r: Resolved) => string) => {
    const m = new Map<string, { n: number; hits: number }>();
    for (const r of resolved) {
      const k = key(r);
      const g = m.get(k) ?? { n: 0, hits: 0 };
      g.n += 1; if (r.hit) g.hits += 1;
      m.set(k, g);
    }
    return [...m.entries()]
      .map(([k, g]) => ({ regime: k, scenario: k, n: g.n, hits: g.hits, rate: rate(g.hits, g.n) }))
      .sort((a, b) => b.n - a.n);
  };

  return {
    resolved: n,
    total: journal.filter((e) => !e.demo && e.direction !== "NO_TRADE").length,
    hits, hitRate, avgConfidence,
    calibrationError: n ? Math.abs(avgConfidence - hitRate) : 0,
    buckets,
    byRegime: group((r) => r.e.regime).map(({ regime, n: nn, hits: hh, rate: rr }) => ({ regime, n: nn, hits: hh, rate: rr })),
    byScenario: group((r) => r.e.scenario).map(({ scenario, n: nn, hits: hh, rate: rr }) => ({ scenario, n: nn, hits: hh, rate: rr })),
    expectancyPct,
  };
}
