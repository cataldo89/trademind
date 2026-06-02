# trade_execution_guard

Skill canonica final para autorizar, bloquear o pedir confirmacion antes de una operacion virtual en TradeMind.

No conecta brokers reales y no ejecuta trades por si misma. Solo devuelve una decision auditable que debe consultarse antes de llamar RPCs transaccionales como `execute_virtual_trade` o `close_virtual_position`.

## Entrada

- `user_id`
- `symbol`
- `market`
- `side`: `BUY` o `SELL`
- `requested_amount`
- `requested_quantity`
- `current_price`
- `signal_quality`
- `robust_backtest`
- `portfolio_risk`
- `market_data_quality`
- `selected_provider`
- `account_equity`
- `cash_balance`
- `current_position`
- `idempotency_key`
- `source`: `screener`, `signal`, `manual` o `workflow`

## Salida

- `execution_status`: `ALLOWED`, `BLOCKED` o `REQUIRES_CONFIRMATION`
- `action_to_execute`: `BUY`, `SELL` o `NONE`
- `approved_amount`
- `approved_quantity`
- `max_allowed_amount`
- `price_used`
- `guardrails_passed`
- `blocking_reasons`
- `warnings`
- `confirmation_required`
- `explanation`
- `raw_diagnostics`

## Reglas

- Si `market_data_quality.usable_for_ml=false`, bloquear.
- Si `market_data_quality.status=FAILED`, bloquear.
- Si `signal_quality.signal_status=BLOCKED`, bloquear.
- Si `robust_backtest.backtest_status` es `FAILED` o `BLOCKED`, bloquear.
- Si `portfolio_risk.portfolio_risk_status=BLOCKED`, bloquear.
- Si `portfolio_risk.action_allowed=false`, bloquear.
- Si `side=BUY` y `cash_balance` es insuficiente, bloquear.
- Si `side=BUY` y `requested_amount > max_allowed_amount`, devolver `REQUIRES_CONFIRMATION` con monto aprobado limitado.
- Si `side=SELL` y no existe `current_position`, bloquear.
- Si `current_price` falta o es `<=0`, bloquear.
- Si falta `idempotency_key`, bloquear.
- Si `source=manual`, puede devolver `REQUIRES_CONFIRMATION` cuando la senal no es BUY, siempre que los datos no esten bloqueados.
- Si `source=signal`, `workflow` o `screener`, una compra derivada requiere senal compatible `OK/BUY`.

## Integracion

- Endpoint quant-engine: `POST /mcp/tools/trade_execution_guard`.
- `/api/portfolio/trade` llama el guard antes de `execute_virtual_trade`.
- `/api/portfolio/positions/:id/close` llama el guard antes de `close_virtual_position`.
- El frontend envia `idempotencyKey` en compras/cierres virtuales.
- El formulario manual de portfolio ya no inserta posiciones directamente en Supabase; pasa por `/api/portfolio/trade`.

## Guardrails

- No ejecutar trades reales.
- No conectar broker real.
- No inventar precio, cantidad, saldo, posicion ni calidad de datos.
- Si el guard devuelve `BLOCKED`, la API no llama los RPCs de ejecucion.
- Si el guard devuelve `REQUIRES_CONFIRMATION`, la API no ejecuta salvo confirmacion explicita en el request.
