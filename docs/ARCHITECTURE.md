# LIQRADAR — Arquitectura (adaptación del spec a entorno estático)

## Qué hay implementado (frontend, build estático)

| Capa spec | Implementación |
|---|---|
| §3 Pipeline | `src/lib/connectors.ts` (transporte) → `src/lib/safe.ts` (validación §8/§54) → `src/lib/engines.ts` (features/eventos/régimen/escenario/señal) → `src/lib/store.ts` (orquestación, journal, replay, alertas) → `src/components/panels.tsx` (UI) |
| §5A Binance Futures | markPrice WS (precio+funding), aggTrade WS (CVD futuros), forceOrder WS (liquidaciones observadas), depth diff WS + snapshot REST con validación de secuencia y resync (§20), REST: ticker 24h, OI, klines 15m/1h/4h/1D/1W, funding history, top trader / taker / global ratios, leverage brackets |
| §5B Spot | aggTrade WS real → Spot CVD |
| §5C/§5D Cross-exchange | OKX + Bybit REST público (OI, funding, precio) |
| §33 Opciones | Deribit público (OI por strike, P/C, DVOL, Max Pain derivado, term structure IV, skew 25Δ derivado). Si falla ⇒ UNAVAILABLE |
| §49 Predicción vs Realidad | hit rate / error de calibración / expectativa por bucket, régimen y escenario, desde el journal REAL (§65) |
| §7 Data contract | `src/types.ts` — Provenance/FeatureResult/EventResult/SignalResult |
| §9 Health Center | panel DATA HEALTH: LIVE/DEGRADED/UNAVAILABLE, latencia, age, records, reconexiones, estado de secuencia |
| §11/§38 MTF | matriz 15m-1W con pesos distintos, contradicción 0-1 |
| §13 OI régimen | LONG_BUILD / SHORT_BUILD / LONG_UNWIND / SHORT_UNWIND / NEUTRAL + velocidad/aceleración/percentil |
| §14-§16 CVD | spot y futuros por aggTrade real + divergencias |
| §18 Funding | percentil histórico, NORMAL/ELEVATED/EXTREME_LONGING/EXTREME_SHORTING, cross-exchange |
| §20-§24 Order book | imbalance, absorción (evento estimado), SPOOF_RISK (nunca "confirmado") |
| §22 Migración de liquidez | detección de retiro+recolocación de órdenes grandes en el libro (evento estimado) |
| §34 Footprint | delta comprador/vendedor por nivel de precio desde aggTrade real (ventana 5m) |
| §35 Volume profile | POC / VAH / VAL de la sesión actual, cobertura real desde el arranque (§21) |
| §26-§27 Liquidaciones | forceOrder observado + burst NORMAL→EXTREME_CASCADE |
| §29/§70 Clústeres | modelo propio ESTIMADO con brackets reales (sin MMR fijo); texto obligatorio "liquidez de liquidación estimada" |
| §36-§41 Motores | régimen, escenario, contradicción, NO TRADE, señal LONG/SHORT/NO_TRADE con evidencia/contradicciones/target/invalidación |
| §43-§45 | bloques agrupados (sin double counting), pesos dinámicos por escenario, calibración con offset aprendido del journal |
| §48/§49/§50 | journal con outcomes +5m/+15m/+30m/+1h/+4h, diagrama de calibración, replay de sesión capturada |
| §51/§53 | alertas del motor + Error Boundary global |
| §65 | Modo REAL por defecto (cero simulación) y Modo DEMO etiquetado que no alimenta métricas REAL |

## Pendiente por requerir backend (no ejecutable en build estático)

- **Servidor Node (Fastify) + rutas §55 + WS bridge §56**: este entorno sirve solo el build de Vite.
- **SQLite §58** (WAL, tablas trades/l2/liquidations/signals/outcomes): sustituido temporalmente por localStorage para el journal.
- **CoinGlass §5E / Hyblock §5F**: requieren API keys que NUNCA deben llegar al frontend (§6/§18). Sus paneles muestran UNAVAILABLE y el radar degrada sin ellos (§71).
- **Convergencia de clústeres §31**: activa cuando exista el conector CoinGlass de backend.
- **Tests §63 / scripts Windows §64 / audit §62**: `npm run test`, smoke, `audit:real`, INICIAR.bat, etc.
- **Backtest §46-§47 y walk-forward**: requieren histórico persistido por el backend.

## Reglas de seguridad vigentes

- Ninguna API key en el frontend; `.env` solo cuando exista backend.
- Modo REAL jamás simula precio/CVD/liquidaciones.
- Toda feature lleva provenance; NaN/Infinity/null se invalidan en `safe.ts` antes del motor.
- Las estimaciones (clústeres, absorción, spoof risk, régimen) siempre van etiquetadas ESTIMATED.
