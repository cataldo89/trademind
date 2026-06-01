# Market Data Quality Skill

## Objetivo

Validar la calidad de datasets OHLCV antes de que TradeMind use esos datos en analisis tecnico, ML, screener, workflow cuantitativo o backtesting. La skill evita confundir una accion mala con datos insuficientes.

## Alcance

- Skill Python: `quant-engine/market_data_quality.py`.
- Endpoint FastAPI: `POST /mcp/tools/market_data_quality`.
- Guardrail del workflow: `quant-engine/agents/graph.py` bloquea ML si `usable_for_ml=false`.
- Skill TypeScript: `src/lib/market-data-quality.ts`.
- Screener: `/api/quant/scan` valida velas antes de calcular TA y antes de llamar al workflow Python.

No incluye las otras skills recomendadas en el documento externo.

## Contrato de entrada

```json
{
  "symbol": "AAPL",
  "provider": "yahoo-chart",
  "timeframe": "1d",
  "start_date": "2024-01-01",
  "end_date": "2026-01-01",
  "dataset": [
    { "time": 1710000000, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1200000 }
  ],
  "metadata": {
    "adjusted": true,
    "provider_status": "ok"
  }
}
```

`dataset` acepta claves equivalentes `time/timestamp/date/datetime` y OHLCV en minusculas o mayusculas.

## Contrato de salida

```json
{
  "symbol": "AAPL",
  "provider": "yahoo-chart",
  "timeframe": "1d",
  "status": "OK",
  "usable_for_chart": true,
  "usable_for_ta": true,
  "usable_for_ml": true,
  "usable_for_backtest": true,
  "quality_score": 92,
  "issues": [],
  "warnings": [],
  "blocking_errors": [],
  "recommendation": "Datos aptos para grafico, TA, ML y backtesting bajo los umbrales actuales.",
  "raw_diagnostics": {
    "row_count": 300,
    "missing_columns": [],
    "duplicate_time_count": 0,
    "chronological": true,
    "history_days": 420
  }
}
```

## Validaciones

- Minimo de velas para grafico, TA, ML y backtesting.
- Fechas faltantes y gaps temporales.
- Columnas OHLCV obligatorias.
- Valores nulos.
- Precios cero o negativos.
- Volumen nulo, cero o sospechoso.
- Rango historico suficiente para ML/backtesting.
- Duplicados.
- Orden cronologico.
- Estado ajustado/no ajustado/unknown segun metadata.
- Fallos silenciosos del proveedor.
- Clasificacion `chart only`, `TA`, `ML`, `backtest`.

## Estados y guardrails

- `FAILED`: bloquear graficos, TA, ML y backtesting cuando hay errores OHLCV bloqueantes.
- `WARNING`: permitir solo usos compatibles. Si `usable_for_ml=false`, ningun modelo ML debe usar esos datos.
- `OK`: dataset apto bajo los umbrales actuales.

Reglas:

- Si `usable_for_ml=false`, el workflow devuelve `HOLD` con `confidence=0`, `data_status=insufficient` y razon de calidad de datos.
- Si `quality_score < 60`, el workflow tambien bloquea ML aunque `usable_for_ml` no sea falso.
- Si `usable_for_backtest=false`, no se debe ejecutar backtesting robusto.
- Si el screener recibe datos no aptos para TA, no calcula indicadores.
- Si el screener recibe datos no aptos para ML o `quality_score < 60`, no llama al workflow Python para ese activo.
- Prohibido inventar velas, volumen, fechas o estado de ajuste faltante.

## Proveedores verificados

| Proveedor | Estado real | Evidencia |
|---|---|---|
| Yahoo Finance via `yahoo-finance2` | Operativo en Next.js | `/api/market/quote`, `/api/market/candles`, `/api/market/movers` usan `src/lib/yahoo-finance.ts`. |
| Yahoo Chart API `query1.finance.yahoo.com/v8/finance/chart` | Operativo en Python | `quant-engine/market_data.py` alimenta HMM/GARCH/ARIMA y ahora `market_data_quality`. |
| `yfinance` | Operativo parcial/degradable | Se usa en Graham, fallback de modelos y noticias; puede fallar por `quoteSummary`/rate limit. |
| Alpha Vantage | Helper incompleto | Hay helpers y env vars, pero no esta conectado al flujo principal de candles/screener/workflow. |
| Finnhub | Helper incompleto | Hay helpers y env vars; noticias lo usan si hay token, pero no es proveedor principal de OHLCV. |
| Polygon/FMP/Stooq | No implementado | Solo aparecen como env/doc o no aparecen en codigo invocable. |

## Persistencia/telemetria

La skill no escribe en base de datos. Expone diagnostico por:

- `market_data_quality` en la respuesta de `/api/quant/scan`.
- `market_data_quality` dentro de `workflow_result`.
- Logs existentes de `/api/quant/scan` y FastAPI.

## Criterios de aceptacion

- Dataset correcto produce `OK` y permite chart/TA/ML/backtest.
- Dataset vacio produce `FAILED`.
- Dataset visual corto produce `usable_for_chart=true` y `usable_for_ml=false`.
- Datasets con columnas faltantes, precios no positivos o fallo de proveedor quedan bloqueados.
- El workflow no ejecuta modelos si la skill bloquea ML.
- El screener no llama Python para candidatos no aptos para ML.

## Pruebas obligatorias

- `quant-engine/venv/Scripts/python.exe -m pytest tests/test_market_data_quality.py test_main.py`
- `npm run test:contracts`
- `npm run typecheck`
