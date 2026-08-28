/* ============================================================
 * LIQRADAR — Validación de datos (§8) + formateadores seguros (§54)
 * HTTP 200 no significa dato válido: NaN, Infinity, undefined,
 * null, timestamps imposibles y precios <= 0 se invalidan aquí.
 * ============================================================ */

export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const safeNumber = (v: unknown, fallback = 0): number =>
  isFiniteNumber(v) ? v : fallback;

export const requireFiniteNumber = (v: unknown, label: string): number => {
  if (!isFiniteNumber(v)) {
    throw new Error(`requireFiniteNumber: "${label}" inválido (${String(v)})`);
  }
  return v;
};

export const safeRatio = (num: unknown, den: unknown, fallback = 0): number => {
  const n = Number(num);
  const d = Number(den);
  return isFiniteNumber(n) && isFiniteNumber(d) && d !== 0 ? n / d : fallback;
};

export const safePercent = (v: unknown, fallback = 0): number =>
  isFiniteNumber(v) ? v * 100 : fallback;

export const validateTimestamp = (ts: unknown): boolean => {
  const n = Number(ts);
  return isFiniteNumber(n) && n > 1_500_000_000_000 && n < Date.now() + 120_000;
};

export const validateStaleness = (ts: unknown, maxAgeMs: number): boolean =>
  validateTimestamp(ts) && Date.now() - (ts as number) <= maxAgeMs;

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/* ---------------- estadística ---------------- */

export const mean = (a: number[]): number =>
  a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

export const stdev = (a: number[]): number => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export const percentileOf = (a: number[], v: number): number => {
  if (!a.length) return 0.5;
  const s = [...a].sort((x, y) => x - y);
  let i = 0;
  while (i < s.length && s[i] < v) i++;
  return i / s.length;
};

export const zScore = (a: number[], v: number): number => {
  const sd = stdev(a);
  return sd > 0 ? (v - mean(a)) / sd : 0;
};

export const uid = (): string =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

/* ---------------- formateadores seguros (§54) ----------------
 * Todos toleran undefined / null / NaN / Infinity => "—" */

export const formatNumber = (v: unknown, d = 2): string => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
};

export const formatPercent = (v: unknown, d = 2): string => {
  const n = Number(v);
  return Number.isFinite(n)
    ? `${n >= 0 ? "+" : ""}${n.toFixed(d).replace(".", ",")} %`
    : "—";
};

export const formatPercentRaw = (v: unknown, d = 2): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(d).replace(".", ",")} %` : "—";
};

export const formatUsd = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)} M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)} k`;
  return `${sign}$${abs.toFixed(0)}`;
};

export const formatPrice = (v: unknown, d = 1): string => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
};

export const formatBtc = (v: unknown, d = 3): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(d)} ₿` : "—";
};

export const formatAge = (ms: unknown): string => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  if (n < 3_600_000) return `${Math.floor(n / 60_000)} m`;
  return `${(n / 3_600_000).toFixed(1)} h`;
};

export const formatClock = (ts: unknown): string => {
  const n = Number(ts);
  return Number.isFinite(n)
    ? new Date(n).toLocaleTimeString("es-ES", { hour12: false })
    : "—";
};

export const formatCountdown = (ms: unknown): string => {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "—";
  const h = Math.floor(n / 3_600_000);
  const m = Math.floor((n % 3_600_000) / 60_000);
  const s = Math.floor((n % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
