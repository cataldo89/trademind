# signal_quality

## Objetivo

Evaluar la calidad de la senal final antes de mostrar oportunidades, BUY/SELL/HOLD o recomendaciones.

## Entrada

- `symbol`
- `market`
- `selected_provider`
- `market_data_quality`
- `technical_indicators`
- `ml_prediction`
- `risk_metrics`
- `graham_result`
- `sentiment_result`
- `workflow_action`
- `workflow_confidence`
- `reasons`

## Salida

- `signal_status`: `OK`, `WEAK`, `CONFLICTED` o `BLOCKED`
- `final_action`: `BUY`, `SELL` o `HOLD`
- `final_confidence`
- `confidence_level`: `LOW`, `MEDIUM` o `HIGH`
- `signal_score`
- `supporting_factors`
- `contradicting_factors`
- `blocking_reasons`
- `warnings`
- `explanation`
- `raw_diagnostics`

## Guardrails

- `usable_for_ml=false` bloquea la senal y fuerza `HOLD`.
- `quality_score < 60` bloquea la senal.
- FinBERT positivo no puede sobrepasar mala calidad de datos.
- Riesgo alto contradice BUY.
- Graham negativo contradice BUY tecnico/ML.
- Una oportunidad real requiere `signal_status=OK`, `final_action=BUY` y confianza suficiente.

## Endpoint

`POST /mcp/tools/signal_quality`
