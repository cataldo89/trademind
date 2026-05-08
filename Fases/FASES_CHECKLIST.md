# FASES CHECKLIST (F0 - F6)

## Fase 0: Auditoría inicial obligatoria
- [x] Leer archivos obligatorios
- [x] Crear FASES_CHECKLIST.md (este archivo)
- [x] Ejecutar `npm install`
- [x] Ejecutar `npm run lint`
- [x] Ejecutar `npm run typecheck`
- [x] Ejecutar `npm run build`
- [x] Crear y activar venv en quant-engine
- [x] Instalar requirements.txt en quant-engine
- [x] Ejecutar `python -m compileall .` en quant-engine

## Fase 1: Producción Vercel sin romper proyecto oficial
- [x] Validar Vercel config
- [x] Desplegar en Vercel
- [x] Validar variables de entorno en Vercel

## Fase 2: Reparar /api/trading como orquestador real
- [x] Modificar `src/app/api/trading/route.ts`
- [x] Validar symbol/usuario
- [x] Llamar a `mcpClient.runWorkflow(symbol)`
- [x] Recibir acción/confianza y modelos
- [x] Persistir señal en Supabase
- [x] Eliminar `Math.random()`
- [x] Generar respuesta con formato correcto o error de quant engine.

## Fase 3: Robustecer quant-engine
- [x] Implementar seguridad con `QUANT_ENGINE_SECRET` y headers en FastAPI
- [x] Implementar /health
- [x] Implementar /workflow/analyze
- [x] Implementar /mcp/tools/... (get_market_regime, calculate_var, check_graham_filters)
- [x] Implementar /ml/... (predict_direction, predict_sarima)
- [x] Implementar /lean/backtest
- [x] Agregar manejo de errores para validación de datos.

## Fase 4: Implementar SARIMA y ordenar ARIMA/MARIMA
- [x] Actualizar o crear `quant-engine/time_series_models.py`
- [x] Implementar `predict_direction_arima`
- [x] Implementar `predict_direction_sarima`
- [x] Implementar `predict_direction_marima` (o not_implemented)
- [x] Computar `confidence` según métricas en vez de hardcodeado
- [x] Validar formato de respuesta para todos

## Fase 5: QuantConnect / LEAN real
- [x] Implementar lógica en `quant-engine/lean_integration.py`
- [x] Validar CLI de LEAN
- [x] Validar credenciales
- [x] Crear workspace y exportar algoritmo
- [x] Ejecutar `lean backtest` y capturar stdout/stderr/results
- [x] Devolver `lean_not_ready` si no está configurado

## Fase 6: Tests, verificación final y deploy
- [x] Validaciones npm (`lint`, `typecheck`, `build`, `verify`)
- [x] Crear tests pytest en python
- [x] Ejecutar pytest
- [x] Deploy final en Vercel apuntando a `trademind-cv`
- [x] Actualizar checklist como OK.

[OK] Implementado
[OK] Probado
[OK] Build exitoso
[OK] Deploy producción
[URL] https://trademind-cv.vercel.app
