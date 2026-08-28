/* ============================================================
 * LIQRADAR — Data contract (spec §7)
 * Toda fuente normaliza a estos tipos. Toda feature lleva
 * provenance. Nunca NaN/Infinity/null llega al motor (§8).
 * ============================================================ */

export type DataTruth = "REAL" | "ESTIMATED" | "PARTIAL" | "FALLBACK" | "UNAVAILABLE" | "DEMO";
export type HealthStatus = "LIVE" | "DEGRADED" | "UNAVAILABLE";
export type Dir = "bullish" | "bearish" | "neutral";

export interface Provenance {
  truth: DataTruth;
  source: string;
  fetchedAt: number;
  ageMs: number;
  latencyMs?: number;
  quality: number; // 0..1
  error?: string;
}

/** FeatureResult (§77): value + direction + strength + confidence + provenance */
export interface FeatureResult {
  value: number;
  direction: Dir;
  strength: number; // 0..1
  confidence: number; // 0..1
  provenance: Provenance;
}

/** EventResult (§77) */
export interface EventResult {
  id: string;
  ts: number;
  type: string;
  side?: "long" | "short";
  strength: number;
  truth: DataTruth;
  evidence: string[];
}

export interface SourceHealth {
  id: string;
  label: string;
  status: HealthStatus;
  latencyMs?: number;
  lastUpdate?: number;
  ageMs?: number;
  records: number;
  reconnects: number;
  seq?: string;
  error?: string;
  note?: string;
}

export interface Trade {
  ts: number;
  price: number;
  qty: number;
  /** true => el comprador era maker => venta agresiva */
  isBuyerMaker: boolean;
}

export interface LiqEvent {
  id: string;
  ts: number;
  price: number;
  qty: number;
  usd: number;
  /** SELL = long liquidado · BUY = short liquidado */
  side: "SELL" | "BUY";
  symbol: string;
  truth: DataTruth;
  /** exchange de origen (agregación multi-exchange) */
  exchange?: string;
}

/* ---------------- contexto de mercado en vivo ---------------- */

/** Línea de narrativa generada SOLO con datos existentes (§80) */
export interface BriefingLine {
  text: string;
  source: string;
  truth: DataTruth;
}

export interface Sentiment {
  value: number; // 0..100 Fear & Greed
  label: string;
  ts: number;
  truth: DataTruth;
}

export type SourceKind = "INTEGRADO" | "DERIVADO" | "CUBIERTO" | "EXTERNA";

export interface SourceCard {
  name: string;
  stars: number;
  url?: string;
  kind: SourceKind;
  note: string;
  live?: boolean | null; // estado dinámico de los health ids asociados
}

export interface BookLevel { price: number; qty: number; }

export interface Book {
  bids: BookLevel[];
  asks: BookLevel[];
  ts: number;
  lastUpdateId: number;
  notionalBid: number;
  notionalAsk: number;
}

export interface Candle {
  ts: number; open: number; high: number; low: number; close: number; volume: number;
}

export type Timeframe = "15m" | "1h" | "4h" | "1D" | "1W";

/** MTF confluence row (§11) */
export interface MtfRow { tf: Timeframe; direction: Dir; strength: number; quality: number; }

export type RegimeState =
  | "TREND_UP" | "TREND_DOWN" | "LONG_BUILD" | "SHORT_BUILD"
  | "SHORT_SQUEEZE" | "LONG_SQUEEZE" | "ACCUMULATION" | "DISTRIBUTION"
  | "COMPRESSION" | "EXPANSION" | "NEUTRAL";

export type ScenarioState =
  | "TREND_CONTINUATION" | "BREAKOUT" | "BREAKDOWN" | "MEAN_REVERSION"
  | "SHORT_SQUEEZE" | "LONG_SQUEEZE" | "LIQUIDATION_CASCADE" | "RANGE" | "NO_TRADE";

export type OiRegime = "LONG_BUILD" | "SHORT_BUILD" | "LONG_UNWIND" | "SHORT_UNWIND" | "NEUTRAL";
export type FundingState = "NORMAL" | "ELEVATED" | "EXTREME_LONGING" | "EXTREME_SHORTING";
export type BurstState = "NORMAL" | "ELEVATED" | "BURST" | "CASCADE" | "EXTREME_CASCADE";
export type AbsorptionState = "BUY_ABSORPTION" | "SELL_ABSORPTION" | "NONE";
export type SpoofLevel = "LOW" | "ELEVATED" | "HIGH";

/** Clúster de liquidación (§29/§70) — siempre ESTIMATED */
export interface Cluster {
  price: number;
  estimatedUsd: number;
  side: "long" | "short" | "unknown";
  distancePct: number;
  model: string;
  external?: string;
  convergence?: number;
  truth: DataTruth;
  freshnessMs: number;
}

/** Bloque de evidencia con peso dinámico (§43/§44) */
export interface BlockScore {
  block: string;
  score: number; // -1..1
  weight: number;
  confidence: number;
  truth: DataTruth;
  evidence: string[];
  against: string[];
}

export type SignalDirection = "LONG" | "SHORT" | "NO_TRADE";

/** SignalResult (§40/§77) */
export interface SignalResult {
  id: string;
  ts: number;
  price: number;
  direction: SignalDirection;
  confidence: number; // 0..1 calibrada
  regime: RegimeState;
  scenario: ScenarioState;
  target?: number;
  invalidation?: number;
  evidence: string[];
  contradictions: string[];
  dataQuality: number; // 0..1
  blocks: BlockScore[];
  noTradeReasons: string[];
  demo: boolean;
}

export interface Outcome {
  hitTarget: boolean;
  hitInvalidation: boolean;
  ambiguous: boolean;
  noData: boolean;
  priceAt?: number;
}

/** Entrada del journal de señales (§48) */
export interface JournalEntry {
  id: string;
  ts: number;
  price: number;
  direction: SignalDirection;
  confidence: number;
  regime: RegimeState;
  scenario: ScenarioState;
  target?: number;
  invalidation?: number;
  demo: boolean; // §65: DEMO nunca alimenta métricas REAL
  outcomes: Record<string, Outcome | undefined>;
}

/** Frame sincronizado para replay (§50) — solo datos observados en sesión */
export interface ReplayFrame {
  ts: number;
  price: number;
  futCvd: number;
  spotCvd: number;
  oi: number;
  liqUsd: number;
}

export interface OptionsSummary {
  truth: DataTruth;
  source: string;
  fetchedAt: number;
  totalOi?: number;
  putCallRatio?: number;
  atmIv?: number;
  maxPain?: number;
  expiries?: number;
  /** §33: term structure de IV — ATM por vencimiento (REAL observado) */
  termStructure?: { expiry: string; iv: number }[];
  /** §33: skew 25Δ aproximado con strikes ±2,5 % (DERIVADO) */
  skew25?: number;
  error?: string;
}

/* ------------------------- microestructura profunda ------------------------- */

/** §34: footprint — delta comprador/vendedor por nivel de precio (trades reales) */
export interface FootprintLevel {
  price: number;
  buyUsd: number;
  sellUsd: number;
  delta: number;
  count: number;
}

/** §35: volume profile de la sesión actual (nunca se inventa histórico, §21) */
export interface VolumeProfileData {
  levels: { price: number; volume: number }[];
  poc: number;
  vah: number;
  val: number;
  bucket: number;
  coverageSince: number;
  totalUsd: number;
}

/** §22: migración de liquidez detectada en el libro (evento estimado) */
export interface MigrationEvent {
  id: string;
  ts: number;
  side: "bid" | "ask";
  from: number;
  to: number;
  usd: number;
  /** niveles de precio recorridos */
  steps: number;
}

/** §49: predicción vs realidad — validación estadística del journal */
export interface ValidationStats {
  resolved: number;
  total: number;
  hits: number;
  hitRate: number;
  avgConfidence: number;
  calibrationError: number;
  buckets: { range: string; n: number; hits: number; rate: number; avgConf: number }[];
  byRegime: { regime: string; n: number; hits: number; rate: number }[];
  byScenario: { scenario: string; n: number; hits: number; rate: number }[];
  expectancyPct: number;
}

export interface CrossExchange {
  exchange: string;
  truth: DataTruth;
  price?: number;
  oiUsd?: number;
  funding?: number;
  fetchedAt?: number;
  error?: string;
}

export interface AlertItem {
  id: string;
  ts: number;
  type: string;
  severity: "info" | "warn" | "critical";
  msg: string;
}

export type Mode = "REAL" | "DEMO";
