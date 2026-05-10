---
title: "TradeMind - Contexto canonico para agentes IA"
status: "operational-source-of-truth"
owner: "Carlos / TradeMind"
created_at: "2026-05-04"
updated_at: "2026-05-10"
recommended_path: "ANTIGRAVITY_CONTEXT.md"
editable_by: "human-or-agent-with-evidence"
purpose: "Orientar a cualquier IA para estabilizar TradeMind sin confundir vision futura con estado real del codigo."
---

# TradeMind - Contexto canonico para agentes IA

## 0. Regla principal

Este archivo debe leerse antes de modificar el repositorio.

> No afirmar que algo esta implementado, probado, escalable o funcional si no existe evidencia directa en codigo, logs, tests o ejecucion CLI.

TradeMind mezcla cuatro capas que deben mantenerse separadas:

1. Vision del producto.
2. Estado real del codigo.
3. Plan futuro.
4. Memoria operativa de agentes IA.

La funcion de este archivo es mantener esa separacion para que ninguna IA construya sobre supuestos falsos.

## 1. Orden de lectura obligatorio

Toda IA debe leer en este orden:

1. `AGENTS.md`
2. `ANTIGRAVITY_CONTEXT.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `ESTRUCTURA_PROYECTO.md`
5. `soluciones_tecnicas.md`
6. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
7. `SEGURIDAD.md`
8. `README.md` si necesita ejecutar localmente
9. `GEMINI.md` solo para vision futura
10. `MEMORY.md` solo para filosofia e historia del producto

## 2. Roles documentales

| Documento | Autoridad | Uso correcto |
|---|---|---|
| `AGENTS.md` | Operativa | GitHub oficial, Vercel, orden de lectura, reglas de deploy |
| `ANTIGRAVITY_CONTEXT.md` | Canónica para agentes | Separar realidad, vision, gaps y reglas de trabajo |
| `ESTADO_ACTUAL_PROYECTO.md` | Tecnica actual | Estado real auditado, validaciones y brechas |
| `ESTRUCTURA_PROYECTO.md` | Mapa | Ubicar archivos; no usar como prueba de funcionalidad |
| `soluciones_tecnicas.md` | Runbook historico | Problemas ya resueltos y patrones que no deben revertirse |
| `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` | Incidentes/escala | Errores actuales frontend/backend, causas raiz y riesgos futuros |
| `SEGURIDAD.md` | Seguridad | Secretos, service role, scripts, pre-push |
| `GEMINI.md` | Vision | Roadmap aspiracional; no estado real |
| `MEMORY.md` | Memoria historica | Identidad, filosofia y estilo de producto |
| `README.md` | Entrada publica | Stack, ejecucion local y documentacion maestra |

## 3. Objetivo real de TradeMind

TradeMind es un SaaS de trading/inversion que busca cerrar el ciclo:

```text
Dato real -> analisis cuantitativo -> senal explicable -> persistencia -> simulacion/backtest -> validacion -> UI
```

La prioridad inmediata no es agregar mas capas aspiracionales de IA. La prioridad inmediata es estabilizar lo existente:

- Contratos frontend/backend.
- Persistencia Supabase.
- Auth SSR en Vercel.
- Market data con cache/rate limits.
- Quant-engine con URL, secreto, cache y health checks.
- Backtesting LEAN real antes de afirmar eficacia.
- Tests y verificacion verde.

## 4. Estado real resumido al 2026-05-10

| Area | Estado |
|---|---|
| Next.js | 16.2.4 con React 19.2.4 |
| TypeScript | `npm run typecheck` pasa |
| ESLint | `npm run lint` falla con 21 errores y 865 warnings |
| `/api/trading` | Conectado a `mcpClient.runWorkflow`, pero tiene P0 de persistencia por `market: 'EQUITY'` |
| `/api/signals` | Node.js, JWT fallback, Supabase; riesgo por service role |
| `/api/market/*` | Yahoo Finance real, sin rate limit robusto |
| `/api/alerts/check` | Sin contrato seguro de cron y N+1 quotes |
| Supabase | Schema/RLS presentes, pero migraciones incompletas y `schema.sql` tiene comentario invalido `#` |
| Quant-engine | FastAPI y modelos iniciales reales, pero no escala como request sincrono bajo demanda |
| QuantConnect | Estructura presente, sin backtest end-to-end confirmado |
| Documentacion | Actualizada para enlazar runbook de escalamiento y errores frontend/backend |

## 5. Problema tecnico actual mas importante

El error principal detectado es:

```text
/api/trading intenta guardar signals.market = EQUITY
pero Supabase signals.market solo acepta US o CL.
```

Evidencia:

- `src/app/api/trading/route.ts` inserta `market: 'EQUITY'`.
- `supabase/schema.sql` define `CHECK (market IN ('US', 'CL'))`.
- El catch de persistencia solo hace `console.error` y la API igualmente devuelve `success: true`.

Impacto:

- El frontend puede mostrar exito aunque la senal no quede guardada.
- El usuario refresca `/signals` y no ve la senal.
- Otra IA podria culpar al frontend, React Query o cache cuando la causa real es backend/DB.

Registro completo:

```text
docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
```

## 6. Reglas de implementacion

### Antes de escribir codigo

```text
[ ] Leer AGENTS.md
[ ] Leer ANTIGRAVITY_CONTEXT.md
[ ] Leer ESTADO_ACTUAL_PROYECTO.md
[ ] Leer ESTRUCTURA_PROYECTO.md
[ ] Leer soluciones_tecnicas.md
[ ] Leer docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
[ ] Leer SEGURIDAD.md si toca secrets, Supabase, scripts, deploy o Git
[ ] Verificar codigo real antes de afirmar funcionalidad
```

### Durante cambios frontend

```text
[ ] Confirmar shape real de la API consumida
[ ] Confirmar constraints Supabase que reciben los datos
[ ] No solucionar solo UI si el backend devuelve contrato roto
[ ] Evitar fan-out de requests si existe endpoint batch
[ ] No mover logica financiera critica al cliente
```

### Durante cambios backend/API

```text
[ ] Mantener Authorization Bearer fallback para Supabase SSR en Vercel
[ ] No usar service role en rutas de usuario sin justificacion
[ ] No tragar errores de persistencia si el frontend espera exito real
[ ] No exponer detalles internos de error al cliente
[ ] Agregar rate limit/cache si la ruta llama servicios externos
```

### Durante cambios Supabase

```text
[ ] No tocar .env.local ni secretos
[ ] Usar migraciones idempotentes
[ ] Validar RLS y constraints contra enums TypeScript
[ ] No asumir que schema.sql se aplico en produccion
[ ] Corregir drift antes de nuevas features
```

### Durante cambios quant-engine

```text
[ ] No depender de localhost en produccion
[ ] Usar QUANT_ENGINE_URL y QUANT_ENGINE_SECRET
[ ] No entrenar modelos pesados por request sin cache/cola
[ ] Agregar timeouts y respuesta parcial
[ ] No afirmar backtest si LEAN no ejecuto y devolvio metricas
```

## 7. Brechas P0 vigentes

1. `/api/trading` puede devolver `success: true` aunque no persista por constraint `market`.
2. `supabase/schema.sql` no es aplicable de forma confiable por comentario `#` y migraciones incompletas.
3. Compras virtuales y operaciones de portfolio no son atomicas.
4. `/api/alerts/check` no tiene seguridad/contrato de cron y puede no funcionar con RLS.
5. `npm run lint` falla, por lo que `npm run verify` no esta verde.

## 8. Brechas P1 vigentes

1. Market data sin rate limit y con consumidores que hacen N requests por pantalla.
2. Quant-engine sin cache, cola ni contrato de despliegue robusto.
3. Uso de service role en endpoints de usuario.
4. Variables de entorno desalineadas entre codigo, README y `.env.example`.
5. Errores internos en algunas APIs pueden filtrarse con `details: String(error)`.

## 9. Vision futura permitida, pero no asumida

`GEMINI.md` puede hablar de:

- LangGraph.
- MCP completo.
- Autoencoders.
- SHAP/LIME.
- Algoritmos geneticos.
- Edge AI.
- Supabase Realtime.
- QuantConnect fully automated.

Pero ninguna IA debe tratar eso como implementado hasta verificarlo en codigo y ejecucion.

## 10. Definition of Done general

Una tarea no esta terminada hasta cumplir:

```text
[ ] Codigo implementado o documentacion actualizada con evidencia
[ ] Sin mocks ocultos nuevos
[ ] Sin datos aleatorios para senales
[ ] Manejo de errores correcto
[ ] Tests o prueba CLI ejecutada si aplica
[ ] Documentacion maestra actualizada si cambia contrato
[ ] No rompe Vercel/Supabase/QuantConnect
[ ] No introduce secretos
```

Para tareas de trading/senales:

```text
[ ] Usa datos reales o declara fallback controlado
[ ] Normaliza market/timeframe contra DB
[ ] Persiste solo si Supabase confirma
[ ] Devuelve `persisted: true` solo con insert confirmado
[ ] Puede auditarse despues desde `/api/signals`
```

## 11. Prompt recomendado para futuras IAs

```text
Trabaja en modo estabilizacion.

Antes de modificar codigo, lee:
1. AGENTS.md
2. ANTIGRAVITY_CONTEXT.md
3. ESTADO_ACTUAL_PROYECTO.md
4. ESTRUCTURA_PROYECTO.md
5. soluciones_tecnicas.md
6. docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
7. SEGURIDAD.md

No confundas vision con implementacion.
No afirmes funcionalidad sin verificar codigo o CLI.
No uses el repo duplicado trademind-push.
No expongas secretos.
Si el frontend falla, verifica primero el contrato backend/Supabase.
```