# portfolio_risk_manager

## Objetivo

Evaluar si una senal BUY/SELL/HOLD es compatible con riesgo de cartera antes de mostrarla como oportunidad o permitir una operacion virtual.

## Entrada

- `user_id`
- `symbol`
- `market`
- `final_action`
- `signal_quality`
- `robust_backtest`
- `current_price`
- `portfolio_positions`
- `cash_balance`
- `account_equity`
- `risk_profile`
- `max_position_pct`
- `max_sector_pct`
- `max_market_pct`

## Salida

- `portfolio_risk_status`: `OK`, `WARNING` o `BLOCKED`
- `action_allowed`
- `adjusted_action`
- `max_position_size`
- `suggested_position_size`
- `current_exposure_pct`
- `projected_exposure_pct`
- `concentration_risk`
- `liquidity_warning`
- `drawdown_warning`
- `correlation_warning`
- `blocking_reasons`
- `warnings`
- `explanation`
- `raw_diagnostics`

## Reglas

- Si `signal_quality` esta `BLOCKED`, bloquear compra.
- Si `robust_backtest` esta `BLOCKED` o `FAILED`, bloquear compra.
- Si `robust_backtest` esta `WEAK`, reducir tamano sugerido y marcar `WARNING`.
- Si no hay caja suficiente, bloquear compra.
- Si no hay `portfolio_positions`, devolver `WARNING`; no inventar cartera.
- Si `final_action` no es `BUY`, no sugerir tamano de compra.
- Si `final_action=SELL`, permitir reduccion si existe posicion.
- No ejecuta operaciones reales; solo diagnostico y sizing.

## Endpoint

`POST /mcp/tools/portfolio_risk_manager`
