# provider_fallback

Skill reutilizable para seleccionar proveedor OHLCV antes de análisis técnico, ML, backtesting o screener.

## Entrada

- `symbol`: ticker solicitado.
- `market`: mercado (`US`, `CL`, etc.).
- `timeframe`: intervalo de velas, por defecto `1d`.
- `range`, `start_date`, `end_date`: ventana solicitada.
- `required_use`: `chart`, `ta`, `ml` o `backtest`.

## Salida

- `symbol`
- `selected_provider`
- `selected_dataset`
- `selected_quality`
- `providers_attempted`
- `provider_statuses`
- `fallback_used`
- `usable_for_chart`
- `usable_for_ta`
- `usable_for_ml`
- `usable_for_backtest`
- `final_status`: `OK`, `WARNING` o `FAILED`
- `reason`
- `errors`

## Reglas

- Cada dataset retornado por proveedor se valida con `market_data_quality`.
- No se inventan precios, volumen, fechas ni velas.
- Proveedores sin API key se marcan `not_configured`.
- Rate limit se marca `rate_limited`.
- Finnhub se marca `not_applicable` para OHLCV; queda reservado para noticias/sentimiento.
- Si ningún proveedor cumple `required_use=ml`, el flujo devuelve estado bloqueado y no ejecuta ML.

## Endpoint

`POST /mcp/tools/provider_fallback`

```json
{
  "symbol": "AAPL",
  "market": "US",
  "timeframe": "1d",
  "range": "2y",
  "required_use": "ml"
}
```
