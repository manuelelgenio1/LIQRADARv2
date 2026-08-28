/* ============================================================
 * LIQRADAR — Átomos de UI
 * ============================================================ */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { DataTruth } from "../types";
import { clamp01 } from "../lib/safe";

const TRUTH_STYLE: Record<DataTruth, string> = {
  REAL: "border-phos-400/50 bg-phos-400/10 text-phos-300",
  ESTIMATED: "border-amberx-400/50 bg-amberx-400/10 text-amberx-300",
  PARTIAL: "border-info-400/50 bg-info-400/10 text-info-300",
  FALLBACK: "border-line bg-ink-800 text-fog-500",
  UNAVAILABLE: "border-line bg-ink-800 text-fog-600",
  DEMO: "border-amberx-400/70 bg-amberx-400/15 text-amberx-300",
};

export function TruthBadge({ truth, label }: { truth: DataTruth; label?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.2em] ${TRUTH_STYLE[truth]}`}>
      {label ?? truth}
    </span>
  );
}

/** Marco de panel con esquina recortada y tag superior. */
export function Panel({
  title, truth, right, children, className,
}: { title: string; truth?: DataTruth; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel corner-frame pt-5 ${className ?? ""}`}>
      <span className="panel-tag">{title}</span>
      <div className="mb-3 flex items-center justify-between gap-2 px-5">
        <div className="min-w-0">{right}</div>
        {truth && <TruthBadge truth={truth} />}
      </div>
      {children}
    </section>
  );
}

/** Barra horizontal con relleno animado. tone controla el color. */
export function Bar({
  pct, tone, className,
}: { pct: number; tone: "phos" | "amber" | "danger" | "info" | "fog"; className?: string }) {
  const bg = {
    phos: "bg-phos-400", amber: "bg-amberx-400", danger: "bg-danger-400",
    info: "bg-info-400", fog: "bg-fog-600",
  }[tone];
  return (
    <div className={`h-1 w-full overflow-hidden bg-ink-700 ${className ?? ""}`}>
      <div className={`liq-bar h-full ${bg}`} style={{ width: `${Math.round(clamp01(pct) * 100)}%` }} />
    </div>
  );
}

/** Barra bipolar: relleno desde el centro hacia la dirección del valor (-1..1). */
export function BipolarBar({ value }: { value: number }) {
  const v = clamp01(Math.abs(value));
  const positive = value >= 0;
  return (
    <div className="relative h-1.5 w-full bg-ink-700">
      <span className="absolute left-1/2 top-0 h-full w-px bg-ink-600" />
      <span
        className={`liq-bar absolute top-0 h-full ${positive ? "left-1/2 bg-phos-400" : "right-1/2 bg-danger-400"}`}
        style={{ width: `${Math.round(v * 50)}%` }}
      />
    </div>
  );
}

/** Fila etiqueta/valor compacta para columnas de evidencia. */
export function Row({
  label, value, tone, sub,
}: { label: string; value: ReactNode; tone?: "phos" | "amber" | "danger" | "info" | "fog"; sub?: string }) {
  const color = {
    phos: "text-phos-300", amber: "text-amberx-300", danger: "text-danger-300",
    info: "text-info-300", fog: "text-fog-300",
  }[tone ?? "fog"];
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/50 py-1.5 last:border-b-0">
      <div className="min-w-0">
        <p className="font-mono text-[9px] tracking-[0.18em] text-fog-600">{label}</p>
        {sub && <p className="mt-0.5 truncate font-mono text-[9px] text-fog-600/70">{sub}</p>}
      </div>
      <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

/** Chip de estado pequeño. */
export function Chip({
  children, tone = "fog",
}: { children: ReactNode; tone?: "phos" | "amber" | "danger" | "info" | "fog" }) {
  const cls = {
    phos: "border-phos-400/40 bg-phos-400/10 text-phos-300",
    amber: "border-amberx-400/40 bg-amberx-400/10 text-amberx-300",
    danger: "border-danger-400/40 bg-danger-400/10 text-danger-300",
    info: "border-info-400/40 bg-info-400/10 text-info-300",
    fog: "border-line bg-ink-800 text-fog-500",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-display text-[8px] font-bold tracking-[0.16em] ${cls}`}>
      {children}
    </span>
  );
}

/** Scroll-reveal con IntersectionObserver. */
export function Reveal({
  children, className, delay = 0,
}: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("reveal");
    if (delay) el.style.transitionDelay = `${delay}ms`;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { el.classList.add("is-in"); io.disconnect(); }
      },
      { threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return <div ref={ref} className={className}>{children}</div>;
}
