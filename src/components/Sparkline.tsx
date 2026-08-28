import { useMemo } from "react";
import { fmtPrice } from "../lib/format";

type Props = { history: number[] };

export default function Sparkline({ history }: Props) {
  const W = 620;
  const H = 170;
  const PAD = 10;

  const model = useMemo(() => {
    if (history.length < 5) return null;
    const pts = history.slice(-180);
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = Math.max(1e-9, max - min);
    const step = (W - PAD * 2) / (pts.length - 1);
    const xy = pts.map((v, i) => {
      const x = PAD + i * step;
      const y = PAD + (1 - (v - min) / span) * (H - PAD * 2);
      return [x, y] as const;
    });
    const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${H - 2} L${xy[0][0].toFixed(1)},${H - 2} Z`;
    const upTrend = pts[pts.length - 1] >= pts[0];
    const last = xy[xy.length - 1];
    return { line, area, upTrend, last, min, max };
  }, [history]);

  return (
    <section className="panel panel-corners" aria-label="Acción de precio">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.18em] text-fog-100">
            ACCIÓN DE PRECIO
          </h2>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-fog-600">
            ÚLTIMAS {Math.min(history.length, 180)} MUESTRAS
          </p>
        </div>
        {model && (
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              model.upTrend ? "text-long-300" : "text-loss-400"
            }`}
          >
            {model.upTrend ? "▲ impulso alcista" : "▼ impulso bajista"}
          </span>
        )}
      </header>

      <div className="relative px-2 pb-2 pt-3">
        {!model ? (
          <div className="flex h-[170px] items-center justify-center font-mono text-[11px] tracking-[0.2em] text-fog-600">
            RECOPILANDO DATOS DE PRECIO<span className="blink-caret ml-1 text-long-400">▊</span>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-[170px] w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={model.upTrend ? "#2dd4bf" : "#fb7185"} stopOpacity="0.22" />
                <stop offset="100%" stopColor={model.upTrend ? "#2dd4bf" : "#fb7185"} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* gridlines */}
            {[0.25, 0.5, 0.75].map((g) => (
              <line
                key={g}
                x1="0"
                x2={W}
                y1={H * g}
                y2={H * g}
                stroke="#1d2b4a"
                strokeWidth="1"
                strokeDasharray="3 6"
              />
            ))}
            <path d={model.area} fill="url(#sparkFill)" />
            <path
              d={model.line}
              fill="none"
              stroke={model.upTrend ? "#2dd4bf" : "#fb7185"}
              strokeWidth="1.8"
              strokeLinejoin="round"
              pathLength={1}
              style={{ strokeDasharray: 1, strokeDashoffset: 0 }}
            />
            <circle cx={model.last[0]} cy={model.last[1]} r="3.4" fill={model.upTrend ? "#2dd4bf" : "#fb7185"}>
              <animate attributeName="r" values="3.4;5;3.4" dur="1.6s" repeatCount="indefinite" />
            </circle>
          </svg>
        )}
        {model && (
          <>
            <span className="absolute right-3 top-3 font-mono text-[10px] tabular-nums text-fog-600">
              máx {fmtPrice(model.max)}
            </span>
            <span className="absolute bottom-3 right-3 font-mono text-[10px] tabular-nums text-fog-600">
              mín {fmtPrice(model.min)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
