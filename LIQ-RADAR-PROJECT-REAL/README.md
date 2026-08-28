# LIQ-RADAR 2.0 REAL DATA

Terminal local de derivados crypto que usa únicamente datos observables de exchanges públicos y proveedores configurados.

## Fuentes reales

- Binance USD-M Futures: liquidaciones `forceOrder`, trades `aggTrade`, order book `depth5`, precio, open interest y funding.
- Bybit Linear: `allLiquidation`, `publicTrade`, `tickers`.
- OKX SWAP: `liquidation-orders` y `trades`.
- Hyblock: opcional, solo cuando el usuario configura credenciales válidas para sus endpoints de niveles.

## Regla anti-falsos datos

El sistema NO genera pools futuros de liquidación por una fórmula arbitraria. Si no hay una fuente de niveles predictivos configurada, la aplicación muestra explícitamente que esos niveles no están disponibles.

Los "clusters" son agrupaciones de liquidaciones que realmente llegaron por los streams públicos.

El score direccional solo aparece cuando existe suficiente historial real recibido desde los streams. No se usa un valor prefijado para aparentar una señal.

## Inicio

Ejecuta `INICIAR_LIQ_RADAR.bat` con doble clic. El BAT instala Python 3.12 si es necesario, crea `.venv`, instala dependencias y abre el panel.
