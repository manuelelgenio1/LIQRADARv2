import { useEffect, useMemo, useState } from "react";
import { liquidationPrice } from "../lib/heatmap";
import { clamp, fmtPct, fmtPrice, fmtUsd } from "../lib/format";

type Direction = "long" | "short";
type MarginMode = "isolated" | "cross";

const LS_KEY = "liqradar-calc-v1";

type Saved = {
  direction: Direction;
  leverage: number;
  margin: string;
  mode: MarginMode;
  useMarket: boolean;
  customEntry: string;
};

function loadSaved(): Saved {
  const fallback: Saved = {
    direction: "long",
    leverage: 10,
    margin: "1000",
    mode: "isolated",
    useMarket: true,
    customEntry: "",
  };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    return fallback;
  }
}

function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { v: T; label: string; tone?: "long" | "short" }[];
}) {
  return (
    <div className="grid grid-flow-col gap-1 border border-line bg-ink-900 p-1">
      {options.map((o) => {
        const active = o.v === value;
        const tone =
          o.tone === "long"
            ? "border-long-400/60 bg-long-400/12 text-long-300"
            : o.tone === "short"
              ? "border-short-400/60 bg-short-400/12 text-short-300"
              : "border-fog-500/50 bg-ink-700 text-fog-100";
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`border px-4 py-2 font-display text-xs font-semibold tracking-[0.18em] transition-all duration-200 ${
              active ? tone : "border-transparent text-fog-600 hover:text-fog-300"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const LEV_CHIPS = [2, 5, 10, 20, 25, 50, 75, 100, 125];

type Props = {
  price: number;
  onMarker?: (marker: { price: number; side: "long" | "short" } | null) => void;
};

export default function Calculator({ price, onMarker }: Props) {
  const [saved] = useState(loadSaved);
  const [direction, setDirection] = useState<Direction>(saved.direction);
  const [leverage, setLeverage] = useState(saved.leverage);
  const [margin, setMargin] = useState(saved.margin);
  const [mode, setMode] = useState<MarginMode>(saved.mode);
  const [useMarket, setUseMarket] = useState(saved.useMarket);
  const [customEntry, setCustomEntry] = useState(saved.customEntry);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ direction, leverage, margin, mode, useMarket, customEntry } satisfies Saved)
      );
    } catch { /* private mode */ }
  }, [direction, leverage, margin, mode, useMarket, customEntry]);

  const parsedCustom = parseFloat(customEntry.replace(",", "."));
  const entry = useMarket || !isFinite(parsedCustom) || parsedCustom <= 0
    ? price
    : parsedCustom;
  const marginNum = parseFloat(margin.replace(",", "."));
  const hasInput = isFinite(entry) && entry > 0 && isFinite(marginNum) && marginNum > 0;

  const result = useMemo(() => {
    if (!hasInput) return null;
    const liq = liquidationPrice(entry, leverage, direction, mode);
    const posSize = marginNum * leverage;
    const distPct = price > 0 ? ((liq - price) / price) * 100 : 0;
    const roe =
      price > 0
        ? ((price - entry) / entry) * leverage * (direction === "long" ? 1 : -1) * 100
        : 0;
    return { liq, posSize, distPct, distAbs: price > 0 ? liq - price : 0, roe };
  }, [hasInput, entry, leverage, direction, mode, marginNum, price]);

  useEffect(() => {
    onMarker?.(result ? { price: result.liq, side: direction } : null);
  }, [result, direction, onMarker]);

  const risk =
    result === null
      ? null
      : Math.abs(result.distPct) < 1.5
        ? { label: "RIESGO EXTREMO — liquidación inminente", cls: "border-loss-400/60 bg-loss-500/12 text-loss-400", dot: "bg-loss-400 animate-pulse" }
        : Math.abs(result.distPct) < 4
          ? { label: "RIESGO ALTO — poca holgura ante volatilidad", cls: "border-short-400/50 bg-short-400/10 text-short-300", dot: "bg-short-400" }
          : { label: "HOLGURA ACEPTABLE — vigila el funding y los picos", cls: "border-long-400/40 bg-long-400/8 text-long-300", dot: "bg-long-400" };

  const copyLiq = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.liq.toFixed(1));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  const dirLong = direction === "long";

  return (
    <section className="panel panel-corners" aria-label="Calculadora de liquidación">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold tracking-[0.18em] text-fog-100">
            CALCULADORA DE LIQUIDACIÓN
          </h2>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-fog-600">
            DONDE TERMINA TU POSICIÓN · TU NIVEL APARECE EN EL MAPA
          </p>
        </div>
        <span className="border border-line px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] text-fog-500">
          MODO {mode === "isolated" ? "AISLADO" : "CRUZADO"} · MMR {mode === "isolated" ? "0,40" : "0,50"} %
        </span>
      </header>

      <div className="grid gap-0 lg:grid-cols-2">
        {/* form */}
        <div className="space-y-6 border-b border-line p-6 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center gap-4">
            <span className="w-24 font-mono text-[10px] tracking-[0.22em] text-fog-600">DIRECCIÓN</span>
            <Seg
              value={direction}
              onChange={setDirection}
              options={[
                { v: "long", label: "LONG ▲", tone: "long" },
                { v: "short", label: "SHORT ▼", tone: "short" },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="w-24 font-mono text-[10px] tracking-[0.22em] text-fog-600">ENTRADA</span>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={useMarket ? (price ? fmtPrice(price) : "—") : customEntry}
                  onFocus={() => {
                    if (useMarket) {
                      setUseMarket(false);
                      setCustomEntry(price ? String(Math.round(price * 10) / 10) : "");
                    }
                  }}
                  onChange={(e) => {
                    setUseMarket(false);
                    setCustomEntry(e.target.value);
                  }}
                  placeholder="97400"
                  className={`w-40 border border-line bg-ink-900 px-3 py-2 pr-8 font-mono text-sm tabular-nums text-fog-100 transition-colors focus:border-short-400/60 ${
                    useMarket ? "text-fog-500" : ""
                  }`}
                  aria-label="Precio de entrada"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-fog-600">$</span>
              </div>
              <button
                onClick={() => setUseMarket(true)}
                className={`border px-2.5 py-2 font-mono text-[10px] tracking-[0.14em] transition-colors ${
                  useMarket
                    ? "border-long-400/50 bg-long-400/10 text-long-300"
                    : "border-line text-fog-500 hover:border-fog-600 hover:text-fog-100"
                }`}
              >
                {useMarket ? "● MERCADO" : "USAR MERCADO"}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.22em] text-fog-600">APALANCAMIENTO</span>
              <span className={`font-mono text-2xl font-bold tabular-nums ${leverage >= 50 ? "text-loss-400" : leverage >= 20 ? "text-short-300" : "text-long-300"}`}>
                {leverage}×
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={125}
              step={1}
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
              className="lev-slider mt-2"
              aria-label="Apalancamiento"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LEV_CHIPS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLeverage(l)}
                  className={`border px-2 py-1 font-mono text-[10px] tabular-nums transition-colors ${
                    leverage === l
                      ? "border-short-400/60 bg-short-400/12 text-short-300"
                      : "border-line text-fog-600 hover:border-fog-600 hover:text-fog-300"
                  }`}
                >
                  {l}×
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="w-24 font-mono text-[10px] tracking-[0.22em] text-fog-600">MARGEN</span>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={margin}
                onChange={(e) => setMargin(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="1000"
                className="w-40 border border-line bg-ink-900 px-3 py-2 pr-14 font-mono text-sm tabular-nums text-fog-100 transition-colors focus:border-short-400/60"
                aria-label="Margen en USDT"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-fog-600">USDT</span>
            </div>
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { v: "isolated", label: "AISLADO" },
                { v: "cross", label: "CRUZADO" },
              ]}
            />
          </div>
        </div>

        {/* results */}
        <div className="flex flex-col justify-between gap-5 p-6">
          <div>
            <p className="font-mono text-[10px] tracking-[0.24em] text-fog-600">
              PRECIO DE LIQUIDACIÓN ESTIMADO
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className={`font-mono text-4xl font-bold tabular-nums tracking-tight md:text-5xl ${result ? "text-loss-400" : "text-fog-600"}`}>
                {result ? fmtPrice(result.liq) : "——.———,—"}
                <span className="ml-2 text-lg font-medium text-fog-600">$</span>
              </span>
              {result && (
                <button
                  onClick={copyLiq}
                  className={`border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] transition-all ${
                    copied
                      ? "border-gain-400/60 bg-gain-400/10 text-gain-400"
                      : "border-line text-fog-500 hover:border-fog-600 hover:text-fog-100"
                  }`}
                >
                  {copied ? "✓ COPIADO" : "COPIAR"}
                </button>
              )}
            </div>

            {result && risk && (
              <div className={`mt-4 flex items-center gap-2.5 border px-3 py-2 ${risk.cls}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${risk.dot}`} />
                <span className="font-display text-[11px] font-semibold tracking-[0.14em]">{risk.label}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-4">
            {[
              {
                l: "DISTANCIA",
                v: result ? `${fmtPct(result.distPct)}` : "—",
                s: result ? fmtUsd(Math.abs(result.distAbs)) : "desde mercado",
                warn: result !== null && Math.abs(result.distPct) < 4,
                roe: 0,
              },
              {
                l: "TAMAÑO POSICIÓN",
                v: result ? fmtUsd(result.posSize) : "—",
                s: `${leverage}× sobre margen`,
                warn: false,
                roe: 0,
              },
              {
                l: "PÉRDIDA EN LIQ.",
                v: result ? fmtUsd(marginNum) : "—",
                s: mode === "isolated" ? "margen aislado" : "margen asignado",
                warn: false,
                roe: 0,
              },
              {
                l: "ROE ACTUAL",
                v: result ? fmtPct(clamp(result.roe, -999, 9999), 1) : "—",
                s: dirLong ? "posición long" : "posición short",
                warn: false,
                roe: result?.roe ?? 0,
              },
            ].map((c) => (
              <div key={c.l} className="bg-ink-900/95 px-4 py-3 transition-colors hover:bg-ink-800">
                <p className="font-mono text-[9px] tracking-[0.22em] text-fog-600">{c.l}</p>
                <p
                  className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                    c.l === "ROE ACTUAL"
                      ? c.roe >= 0
                        ? "text-gain-400"
                        : "text-loss-400"
                      : c.warn
                        ? "text-short-300"
                        : "text-fog-100"
                  }`}
                >
                  {c.v}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-fog-600">{c.s}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
