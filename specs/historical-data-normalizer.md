# historical_data_normalizer

## Objetivo

Normalizar datasets historicos OHLCV de proveedores financieros antes de `market_data_quality`, analisis tecnico, ML, backtesting o screener.

## Entrada

- `symbol`
- `provider`
- `market`
- `timeframe`
- `raw_dataset`
- `metadata`

## Salida

- `symbol`
- `provider`
- `normalized_dataset`
- `row_count`
- `timezone`
- `currency`
- `adjusted_status`: `adjusted`, `unadjusted` o `unknown`
- `normalization_status`: `OK`, `WARNING` o `FAILED`
- `issues`
- `warnings`
- `raw_diagnostics`

## Vela Normalizada

```json
{
  "time": 1704153600,
  "open": 100.0,
  "high": 101.0,
  "low": 99.0,
  "close": 100.5,
  "volume": 1000.0
}
```

## Guardrails

- No inventar velas faltantes.
- No interpolar precios.
- No rellenar volumen falso.
- No cambiar precios para mejorar `quality_score`.
- Rechazar filas con precios cero o negativos.
- Si falta fecha u OHLCV, devolver `FAILED`.

## Integracion

`provider_fallback` ejecuta esta skill por cada proveedor y solo despues llama a `market_data_quality`.

Endpoint:

`POST /mcp/tools/historical_data_normalizer`
