const nf = (min: number, max: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: min, maximumFractionDigits: max });

/** 97412.5 -> "97.412,5" */
export const fmtPrice = (v: number) => nf(1, 1).format(v);

/** 1234567 -> "1.234.567 $" */
export const fmtUsd = (v: number) => nf(0, 0).format(Math.round(v)) + " $";

/** compact: 2.4 M$, 812 k$ ... */
export const fmtCompact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return nf(2, 2).format(v / 1e9) + " B$";
  if (a >= 1e6) return nf(1, 2).format(v / 1e6) + " M$";
  if (a >= 1e3) return nf(0, 1).format(v / 1e3) + " k$";
  return nf(0, 0).format(v) + " $";
};

export const fmtPct = (v: number, digits = 2) =>
  (v >= 0 ? "+" : "") + nf(digits, digits).format(v) + " %";

export const fmtBtc = (v: number) => nf(2, 4).format(v) + " BTC";

export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString("es-ES", { hour12: false });

/** ms -> "02:14:09" */
export const fmtCountdown = (ms: number) => {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(ss)}`;
};

/** minutes ago -> "hace 4 min" */
export const fmtAgo = (ts: number, now: number) => {
  const d = Math.max(0, now - ts);
  if (d < 8_000) return "ahora";
  if (d < 60_000) return `hace ${Math.floor(d / 1000)} s`;
  if (d < 3_600_000) return `hace ${Math.floor(d / 60_000)} min`;
  return `hace ${Math.floor(d / 3_600_000)} h`;
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
