# TradeMind SaaS 2026 - Guia de Desarrollo Agent-First

> ADVERTENCIA PARA AGENTES IA: este documento es vision futura y roadmap aspiracional. No asumir que LangGraph completo, MCP real, Edge AI generalizado, autoencoders, SHAP/LIME o algoritmos geneticos estan implementados de forma estable.

Para realidad tecnica actual leer:

1. `AGENTS.md`
2. `ANTIGRAVITY_CONTEXT.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
5. `soluciones_tecnicas.md`
6. `SEGURIDAD.md`

## 1. Rol de este documento

`GEMINI.md` define direccion aspiracional para evolucionar TradeMind hacia una plataforma SaaS AI-native. No es auditoria del codigo actual.

Si este archivo contradice codigo, tests o `ESTADO_ACTUAL_PROYECTO.md`, manda la evidencia tecnica actual.

## 2. Arquitectura AI-native aspiracional

Objetivos futuros:

- Single Pane of AI para interactuar con cartera, senales y explicaciones en lenguaje natural.
- MCP como interfaz comun para herramientas internas.
- Agentes especializados con memoria persistente cuando la base de datos, seguridad y contratos API esten estabilizados.
- Artefactos dinamicos para analisis, backtests y decisiones.

No implementar mas capas de agentes antes de cerrar los P0 documentados en el runbook de escalamiento.

## 3. Interoperabilidad y MCP

Meta:

```text
Frontend -> Next.js API Node -> Quant-engine -> Supabase/audit logs -> UI
```

Reglas:

- No llamar FastAPI directo desde el navegador.
- Usar `QUANT_ENGINE_URL` y `QUANT_ENGINE_SECRET` en servidor.
- Agregar health checks y timeouts.
- Cachear resultados por simbolo/timeframe.
- Encolar calculos pesados que superen el segundo de latencia.

## 4. Nucleo cuantitativo y algoritmico

Estandares futuros:

- PCA o reduccion de ruido solo si hay dataset suficiente y validacion.
- Lasso/Ridge con target financiero claro.
- ARIMA/SARIMA con validacion historica, no confianza fija.
- GARCH(1,1) para volatilidad y VaR con manejo de datos insuficientes.
- HMM para regimenes con validacion de estabilidad.
- Backtesting LEAN antes de declarar una senal como validada.

Nota:

```text
run_pca_autoencoder no debe llamarse autoencoder si solo ejecuta PCA.
```

## 5. Graham y disciplina de inversion

La vision mantiene filtros de prudencia inspirados en Benjamin Graham:

- P/E moderado.
- Deuda controlada.
- Margen de seguridad.
- Rechazo explicable si faltan datos fundamentales.

El umbral de deuda debe ser canonico en codigo, tests y documentacion. Antes de modificarlo, verificar `quant-engine/graham_filters.py`, `ESTADO_ACTUAL_PROYECTO.md` y tests.

## 6. UX anti-FOMO

La UI debe ayudar a evitar decisiones impulsivas:

- Explicar por que una senal existe.
- Mostrar riesgos, no solo upside.
- Diferenciar analisis narrativo de senal cuantitativa validada.
- Indicar si una senal no fue persistida o no fue backtesteada.
- No mostrar `success` si el backend no confirmo persistencia.

## 7. XAI futura

SHAP/LIME solo deben implementarse cuando exista modelo entrenado/validado y dataset claro.

Mientras tanto, usar explicaciones deterministicas honestas basadas en reglas y datos disponibles.

## 8. Seguridad y costos

- No exponer secretos al cliente.
- No usar service role en rutas de usuario salvo justificacion tecnica y tests de aislamiento.
- Proteger rutas AI con rate limits o cuotas.
- Proteger cron y jobs internos con secretos.
- Consultar `SEGURIDAD.md` antes de tocar scripts, env vars o deploy.

## 9. Escalamiento obligatorio antes de nuevas features aspiracionales

Antes de avanzar con LangGraph, autoencoders, geneticos o XAI avanzado, cerrar o planificar explicitamente:

- `/api/trading` persistiendo con `market` valido.
- Migraciones Supabase aplicables de cero a produccion.
- Operaciones financieras virtuales atomicas.
- Alertas con cron seguro y batch quotes.
- Market data con rate limit, cache y consumidores batch.
- Quant-engine con URL real, secreto, cache y health check.
- `npm run verify` verde o deuda documentada.

Referencia principal:

```text
docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
```