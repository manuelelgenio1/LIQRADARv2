import type { MarketApi } from "../lib/market";
import { fmtCompact } from "../lib/format";

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "long" | "short" | "plain";
}) {
  const color =
    tone === "long"
      ? "text-long-300"
      : tone === "short"
        ? "text-short-300"
        : "text-fog-100";
  return (
    <div className="bg-ink-850/90 px-5 py-4 transition-colors duration-300 hover:bg-ink-800">
      <p className="font-mono text-[9px] tracking-[0.26em] text-fog-600">{label}</p>
      <p className={`mt-1.5 font-mono text-xl font-semibold tabular-nums md:text-2xl ${color}`}>
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[11px] text-fog-500">{sub}</p>
    </div>
  );
}

export default function StatsStrip({ m }: { m: MarketApi }) {
  const { stats, events, nowTs } = m;
  const totalUsd = stats.longUsd + stats.shortUsd;
  const totalOrders = stats.longCount + stats.shortCount;
  const longShare = totalUsd > 0 ? (stats.longUsd / totalUsd) * 100 : 50;
  const recent = events.filter((e) => nowTs - e.time < 5 * 60_000).length;

  return (
    <section className="panel panel-corners" aria-label="Estadísticas de la sesión">
      <div className="grid grid-cols-2 gap-px bg-line/60 md:grid-cols-3 xl:grid-cols-5">
        <Cell
          label="LIQUIDADO · SESIÓN"
          value={totalUsd > 0 ? fmtCompact(totalUsd) : "0 $"}
          sub={`${totalOrders} órdenes forzadas · ${recent}/5 min`}
        />
        <Cell
          label="LONGS LIQUIDADOS"
          value={String(stats.longCount)}
          sub={stats.longUsd > 0 ? fmtCompact(stats.longUsd) : "0 $"}
          tone="long"
        />
        <Cell
          label="SHORTS LIQUIDADOS"
          value={String(stats.shortCount)}
          sub={stats.shortUsd > 0 ? fmtCompact(stats.shortUsd) : "0 $"}
          tone="short"
        />
        <Cell
          label="MAYOR ORDEN"
          value={stats.maxUsd > 0 ? fmtCompact(stats.maxUsd) : "—"}
          sub="posición individual"
        />
        {/* ratio */}
        <div className="col-span-2 bg-ink-850/90 px-5 py-4 transition-colors duration-300 hover:bg-ink-800 md:col-span-1">
          <p className="font-mono text-[9px] tracking-[0.26em] text-fog-600">RATIO L / S</p>
          <div className="mt-3 flex h-2.5 w-full overflow-hidden border border-line bg-ink-900">
            <div
              className="ratio-fill h-full bg-gradient-to-r from-long-500 to-long-300"
              style={{ width: `${longShare}%` }}
            />
            <div
              className="ratio-fill h-full bg-gradient-to-r from-short-500 to-short-300"
              style={{ width: `${100 - longShare}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-fog-500">
            <span className="text-long-300">{longShare.toFixed(0)} % long</span>
            {" · "}
            <span className="text-short-300">{(100 - longShare).toFixed(0)} % short</span>
          </p>
        </div>
      </div>
    </section>
  );
}
