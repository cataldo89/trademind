# TradeMind - Contratos de datos

## Senales

- `market` valido: `US` o `CL`.
- `EQUITY` solo se acepta como alias legado y se normaliza a `US`.
- `type` valido: `BUY`, `SELL`, `HOLD`.
- `/api/trading` devuelve `persisted: true` solo si Supabase confirma el insert en `signals`.
- Si la persistencia falla, `/api/trading` devuelve `success: false`, `persisted: false` y status HTTP no exitoso.

## Orden virtual

Frontend envia una intencion, no escribe contabilidad directamente:

```json
{
  "side": "BUY",
  "symbol": "AAPL",
  "market": "US",
  "amount": 100,
  "price": 200,
  "source": "signal",
  "signalId": "uuid-opcional",
  "idempotencyKey": "uuid-obligatorio"
}
```

Backend llama `trade_execution_guard` antes del RPC `execute_virtual_trade`. Si el guard devuelve `BLOCKED`, no ejecuta. Si devuelve `REQUIRES_CONFIRMATION`, solo ejecuta con confirmacion explicita. El RPC bloquea el perfil del usuario, valida saldo, inserta posicion, descuenta balance, inserta transaccion y cancela la senal si corresponde.

## Cierre de posicion

`POST /api/portfolio/positions/:id/close` recibe precio de cierre e `idempotencyKey`. Backend llama `trade_execution_guard` antes del RPC `close_virtual_position`; el RPC bloquea posicion/perfil, marca posicion cerrada, reintegra proceeds al balance e inserta transaccion `SELL`.

## Quotes

- Clientes deben agrupar simbolos unicos por pantalla.
- Endpoint: `/api/market/quote?symbols=AAPL,MSFT,NVDA&market=US`.
- Limite actual: 50 simbolos por request.
- Respuesta: objeto para un simbolo, array para multiples simbolos.
- API aplica cache server-side corta y rate limit por IP.

## Candles / series temporales

- Endpoint: `/api/market/candles?symbol=AAPL&market=US&range=1D`.
- Contrato visual: la respuesta mantiene `data`, `range`, `requestedRange`, `interval`, `fallback` y `fallbackReason`.
- Contrato tecnico: la ruta consulta cache en memoria y luego `market_data_cache` antes de pedir Yahoo Chart.
- Clave durable: `symbol + market + range + provider`.
- Rangos durables: `range:1D`, `range:5D`, `timeframe:1d`, etc.
- Si Yahoo falla y existe payload stale en `market_data_cache`, se permite devolver stale como degradacion controlada.
- La cache durable es una optimizacion: si falta `SUPABASE_SERVICE_ROLE_KEY`, la ruta sigue funcionando con cache en memoria y proveedor externo.

## Market data quality

- Skill canonica: `market_data_quality`.
- Endpoint quant-engine: `POST /mcp/tools/market_data_quality`.
- Contrato vivo: `specs/market-data-quality.md`.
- Entrada: `symbol`, `provider`, `timeframe`, `start_date`, `end_date`, dataset OHLCV y metadata del proveedor.
- Salida: `status`, `usable_for_chart`, `usable_for_ta`, `usable_for_ml`, `usable_for_backtest`, `quality_score`, `issues`, `warnings`, `blocking_errors`, `recommendation` y `raw_diagnostics`.
- Si `usable_for_ml=false`, el workflow cuantitativo no debe ejecutar modelos ML y debe devolver neutral/error controlado por datos insuficientes.
- Si `quality_score < 60`, se considera calidad baja y tambien se bloquea ML en workflow/screener.
- Si `usable_for_backtest=false`, no se debe ejecutar backtesting robusto.
- El screener valida esta skill antes de calcular indicadores y antes de llamar al workflow Python.

## Provider fallback

- Skill canonica: `provider_fallback`.
- Endpoint quant-engine: `POST /mcp/tools/provider_fallback`.
- Contrato vivo: `specs/provider-fallback.md`.
- Entrada: `symbol`, `market`, `timeframe`, `range`, `start_date`, `end_date` y `required_use`.
- Salida: `selected_provider`, `selected_dataset`, `selected_quality`, `providers_attempted`, `provider_statuses`, `fallback_used`, flags `usable_for_*`, `final_status`, `reason` y `errors`.
- Cada proveedor OHLCV intentado debe pasar por `market_data_quality`.
- Proveedores sin API key se reportan como `not_configured`; rate limits se reportan como `rate_limited`.
- Si ningun proveedor alcanza `required_use=ml`, el workflow/screener devuelven HOLD o datos insuficientes y no ejecutan ML.
- Finnhub queda como proveedor de noticias/sentimiento, no fuente principal OHLCV.

## Historical data normalizer

- Skill canonica: `historical_data_normalizer`.
- Endpoint quant-engine: `POST /mcp/tools/historical_data_normalizer`.
- Contrato vivo: `specs/historical-data-normalizer.md`.
- Entrada: `symbol`, `provider`, `market`, `timeframe`, `raw_dataset` y `metadata`.
- Salida: `normalized_dataset`, `row_count`, `timezone`, `currency`, `adjusted_status`, `normalization_status`, `issues`, `warnings` y `raw_diagnostics`.
- Vela canonica: `time` unix seconds, `open`, `high`, `low`, `close`, `volume`.
- `provider_fallback` debe normalizar cada dataset antes de llamar `market_data_quality`.
- El screener normaliza velas locales de Yahoo antes de calcular quality, indicadores o score.
- Esta skill no inventa velas, no interpola precios y no rellena volumen falso.

## Signal quality

- Skill canonica: `signal_quality`.
- Endpoint quant-engine: `POST /mcp/tools/signal_quality`.
- Contrato vivo: `specs/signal-quality.md`.
- Entrada: datos de proveedor/calidad, tecnico, ML, riesgo, Graham, FinBERT, accion/confianza de workflow y razones.
- Salida: `signal_status`, `final_action`, `final_confidence`, `confidence_level`, `signal_score`, factores de soporte/contradiccion/bloqueo, warnings, explanation y diagnostics.
- `BLOCKED` fuerza `HOLD` con confianza 0.
- `isOpportunity=true` solo es valido si `signal_status=OK`, `final_action=BUY` y `final_confidence >= 70`.
- FinBERT positivo no puede convertir mala data o una senal contradictoria en oportunidad.

## Robust backtest

- Skill canonica: `robust_backtest`.
- Endpoint quant-engine: `POST /mcp/tools/robust_backtest`.
- Contrato vivo: `specs/robust-backtest.md`.
- Entrada: dataset normalizado, calidad de mercado, calidad de senal, estrategia, capital inicial, fees y slippage.
- Salida: `backtest_status`, `usable_for_decision`, retornos, volatilidad, drawdown, Sharpe, win rate, trades, exposure, benchmark, warnings y bloqueos.
- Si `market_data_quality.usable_for_backtest=false`, devuelve `BLOCKED`.
- Si `signal_quality.signal_status=BLOCKED`, no ejecuta simulacion.
- `trades_count < 5` marca `WEAK`; `trades_count < 3` marca `usable_for_decision=false`.
- Sharpe extremo por baja varianza/pocos trades agrega `UNSTABLE_SHARPE`; drawdown cero con pocos trades agrega `INSUFFICIENT_DRAWDOWN_EVIDENCE`.
- `isOpportunity=true` solo puede mantenerse si `robust_backtest` no esta `BLOCKED` ni `FAILED` y `usable_for_decision=true`; si esta `WEAK`, se baja confianza o se muestra advertencia.
- El resultado es diagnostico historico y no promesa de rentabilidad.

## Portfolio risk manager

- Skill canonica: `portfolio_risk_manager`.
- Endpoint quant-engine: `POST /mcp/tools/portfolio_risk_manager`.
- Contrato vivo: `specs/portfolio-risk-manager.md`.
- Entrada: accion final, calidad de senal, backtest robusto, precio, posiciones, caja, equity y perfil de riesgo.
- Salida: `portfolio_risk_status`, `action_allowed`, `adjusted_action`, tamanos maximo/sugerido, exposiciones, warnings, bloqueos y diagnosticos.
- Si `signal_quality` esta `BLOCKED`, bloquea compra.
- Si `robust_backtest` esta `BLOCKED` o `FAILED`, bloquea compra.
- Si no hay `portfolio_positions`, devuelve `WARNING`; no inventa cartera.
- No ejecuta trades reales ni virtuales; solo diagnostico y sizing sugerido.

## Trade execution guard

- Skill canonica: `trade_execution_guard`.
- Endpoint quant-engine: `POST /mcp/tools/trade_execution_guard`.
- Contrato vivo: `specs/trade-execution-guard.md`.
- Entrada: usuario, simbolo, mercado, lado, monto/cantidad, precio, calidad de senal, backtest, riesgo de cartera, calidad de datos, proveedor, equity/caja, posicion actual, `idempotency_key` y fuente.
- Salida: `execution_status`, `action_to_execute`, monto/cantidad aprobados, maximo permitido, precio usado, guardrails, bloqueos, warnings, confirmacion y diagnosticos.
- Si `market_data_quality.usable_for_ml=false`, `signal_quality` esta `BLOCKED`, `robust_backtest` esta `FAILED/BLOCKED` o `portfolio_risk` bloquea, no ejecuta.
- Si falta `idempotency_key`, no ejecuta.
- Si una compra manual no tiene senal BUY compatible, puede devolver `REQUIRES_CONFIRMATION`, nunca ejecucion automatica silenciosa.
- `/api/portfolio/trade` y `/api/portfolio/positions/:id/close` consultan esta skill antes de sus RPCs transaccionales.
- No ejecuta trades reales ni conecta brokers.

## Alertas

- `POST /api/alerts/check` es solo para cron autorizado.
- Requiere `Authorization: Bearer $CRON_SECRET` o header `x-cron-secret`.
- Usa service role solo despues de validar el secreto.
- Agrupa quotes por mercado/simbolo y devuelve metricas: `checked`, `triggered`, `failed`, `durationMs`.

## Quant-engine

- Rutas, URLs y puertos canonicos: `LLM_CONTEXT.md` seccion `0.0 Rutas y direcciones canonicas`.
- Next.js no ejecuta ML pesado dentro de Vercel.
- Next.js llama FastAPI externo/local via `QUANT_ENGINE_URL`.
- Header interno: `X-TradeMind-Quant-Secret`.
- En produccion faltas de `QUANT_ENGINE_URL` o `QUANT_ENGINE_SECRET` son errores de configuracion explicitos.
- FastAPI mantiene cache TTL por simbolo/endpoint con `QUANT_ENGINE_CACHE_TTL_SECONDS`.
- En local/Vercel actual, el FastAPI se expone con Cloudflare Tunnel hacia `http://127.0.0.1:8000`.
- Arranque facil: `npm run quant:start` para local y `npm run quant:start:vercel` para actualizar `QUANT_ENGINE_URL` en Vercel y desplegar.
- Atajo manual: `START_QUANT_CLOUDFLARE.cmd`.
- Arranque automatico: archivo de usuario instalado en Windows Startup.
- Sin credenciales de Cloudflare (`cert.pem` o token de tunel nombrado), el proyecto usa quick tunnel `trycloudflare.com`; la URL puede cambiar al reiniciar y nunca debe guardarse como URL fija en documentacion permanente.
- El motor Python usa `query1.finance.yahoo.com/v8/finance/chart` como fuente robusta de velas para HMM/GARCH/ARIMA cuando `yfinance` queda bloqueado por `429`.
- El filtro Graham basado en fundamentales puede quedar no concluyente si Yahoo bloquea `quoteSummary`; ese fallo no debe anular senales tecnicas con datos de velas validos.

## SDD

- Estado actual: SDD parcial con carpeta `specs/` inicial.
- Fuente de contratos actual: este archivo, `LLM_CONTEXT.md`, `ESTADO_ACTUAL_PROYECTO.md` y runbooks.
- Specs activas: `specs/quant-jobs.md`, `specs/market-data-cache.md`, `specs/bff-frontend-contracts.md`.
- Diagnostico y brecha formal: `docs/sdd-status.md`.
