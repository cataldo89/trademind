# robust_backtest

## Objetivo

Validar si una senal o estrategia tiene respaldo historico minimo antes de considerarla confiable.

## Entrada

- `symbol`
- `market`
- `provider`
- `timeframe`
- `normalized_dataset`
- `market_data_quality`
- `signal_quality`
- `strategy_type`
- `strategy_params`
- `initial_capital`
- `fees`
- `slippage`

## Salida

- `backtest_status`: `OK`, `WEAK`, `FAILED` o `BLOCKED`
- `usable_for_decision`
- `total_return`
- `annualized_return`
- `volatility`
- `max_drawdown`
- `sharpe_ratio`
- `win_rate`
- `trades_count`
- `exposure_time`
- `benchmark_return`
- `warnings`
- `blocking_reasons`
- `explanation`
- `raw_diagnostics`

## Reglas

- Si `market_data_quality.usable_for_backtest=false`, devuelve `BLOCKED`.
- Si `signal_quality.signal_status=BLOCKED`, no simula y devuelve `BLOCKED`.
- No usa raw data ni inventa/interpola velas.
- Menos de 252 velas diarias no puede marcarse robusto.
- `trades_count < 5` fuerza `WEAK`.
- `trades_count < 3` fuerza `usable_for_decision=false`.
- Sharpe extremadamente alto por baja varianza o pocos trades agrega `UNSTABLE_SHARPE`.
- `max_drawdown = 0` con pocos trades agrega `INSUFFICIENT_DRAWDOWN_EVIDENCE`.
- Pocos trades, drawdown alto o Sharpe negativo bajan estado a `WEAK` o `FAILED`.
- Resultado diagnostico, no promesa de rentabilidad.

## Endpoint

`POST /mcp/tools/robust_backtest`
