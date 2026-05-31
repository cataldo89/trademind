---
title: "TradeMind - Contexto canonico para agentes IA"
status: "operational-source-of-truth"
owner: "Carlos / TradeMind"
created_at: "2026-05-04"
updated_at: "2026-05-25"
recommended_path: "LLM_CONTEXT.md"
editable_by: "human-or-agent-with-evidence"
purpose: "Orientar a cualquier IA para estabilizar TradeMind sin confundir vision futura con estado real del codigo."
---

# TradeMind - Contexto canonico para agentes IA

El entorno operativo principal es VS Code. Las reglas de ejecución local, puertos fijos y pruebas visuales se encuentran en `AGENTS.md` y deben respetarse por cualquier agente IA.

## 0.0 Rutas y direcciones canonicas

Esta tabla es la unica fuente canonica para rutas, URLs, puertos, repositorios y proyectos externos. Si otro archivo contradice esta tabla, actualizar el otro archivo. No inventar rutas, aliases, puertos ni proyectos.

| Concepto | Valor canonico | Regla |
|---|---|---|
| Workspace padre | `C:\Users\catal\Desktop\IA\SAASFACTORY\IA SAAS TRADE CV` | Solo contiene el repo y antecedentes. No ejecutar comandos de app desde aqui salvo que se indique. |
| Repo local | `C:\Users\catal\Desktop\IA\SAASFACTORY\IA SAAS TRADE CV\trademind` | Este es el cwd correcto para Next.js, Git, Vercel y scripts npm. |
| Repo GitHub oficial | `https://github.com/cataldo89/trademind.git` | Unico remoto permitido para push/pull. |
| Repo prohibido | `cataldo89/trademind-push` | No usar, recrear, pushear ni referenciar. |
| Rama principal | `main` | Push normal: `git push origin main`. |
| Vercel project | `trademind-cv` | ID fijo: `prj_1Sqjg0370DyliHgMI0FcVe2jpG3I`. |
| Vercel team/scope | `cataldo89-1519s-projects` | Usar siempre este scope. |
| URL publica canonica | `https://trademind-cv-ten.vercel.app` | Usar este alias estable para validar produccion. No hardcodear URLs `trademind-*.vercel.app` de deploy puntual. |
| Frontend local | `http://localhost:3000` | Unico puerto local permitido para Next.js salvo autorizacion explicita. |
| Quant-engine local | `http://127.0.0.1:8000` | FastAPI Python separado del frontend. |
| Quant-engine publico | `QUANT_ENGINE_URL` | En produccion apunta al tunel activo. No escribir un `trycloudflare.com` concreto en codigo/docs. |
| Cloudflare actual | Quick Tunnel `trycloudflare.com` | Es efimero. Al reiniciar, ejecutar `npm run quant:start:vercel` para actualizar Vercel. |
| Env Next local | `.env.local` | No subir a GitHub. |
| Env quant local | `quant-engine/.env` | No subir a GitHub. |
| Env produccion | Vercel Environment Variables | Gestionar con `vercel env ... --scope cataldo89-1519s-projects`. |
| Arranque frontend | `npm run dev` | Ejecutar desde el repo local. |
| Arranque quant local | `npm run quant:start` | Levanta FastAPI + quick tunnel y actualiza `.env.local`. |
| Arranque quant + Vercel | `npm run quant:start:vercel` | Actualiza `QUANT_ENGINE_URL` en Vercel y despliega produccion. |
| Auditoria quant/tunel | `npm run quant:audit` | Muestra Startup, procesos, puerto 8000, health local/publico y errores recientes. |
| Deploy Vercel manual | `vercel deploy --prod --project trademind-cv --scope cataldo89-1519s-projects` | Antes verificar `.vercel/project.json`. |

Aliases historicos o no canonicos que no deben usarse como fuente: `https://trademind-rose.vercel.app`, URLs de deploy tipo `https://trademind-<hash>-cataldo89-1519s-projects.vercel.app`, y cualquier `https://*.trycloudflare.com` pegado en documentacion permanente.

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
2. `LLM_CONTEXT.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `ESTRUCTURA_PROYECTO.md`
5. `soluciones_tecnicas.md`
6. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
7. `SEGURIDAD.md`
8. `README.md` si necesita ejecutar localmente
9. `LLM.md` solo para vision futura
10. `MEMORY.md` solo para filosofia e historia del producto

## 2. Roles documentales

| Documento | Autoridad | Uso correcto |
|---|---|---|
| `AGENTS.md` | Operativa | GitHub oficial, Vercel, orden de lectura, reglas de deploy |
| `LLM_CONTEXT.md` | Canónica para agentes | Separar realidad, vision, gaps y reglas de trabajo |
| `ESTADO_ACTUAL_PROYECTO.md` | Tecnica actual | Estado real auditado, validaciones y brechas |
| `ESTRUCTURA_PROYECTO.md` | Mapa | Ubicar archivos; no usar como prueba de funcionalidad |
| `soluciones_tecnicas.md` | Runbook historico | Problemas ya resueltos y patrones que no deben revertirse |
| `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` | Incidentes/escala | Errores actuales frontend/backend, causas raiz y riesgos futuros |
| `docs/architecture/fase-7-escalabilidad-distribuida.md` | Arquitectura evolutiva | Jobs asincronos, BFF estable, SDD y cache de series temporales para escalar quant-engine |
| `specs/` | SDD vivo | Contratos por dominio para jobs, cache y BFF; debe crecer con cada cambio funcional |
| `SEGURIDAD.md` | Seguridad | Secretos, service role, scripts, pre-push |
| `LLM.md` | Vision | Roadmap aspiracional AI-native; no estado real |
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

## 4. Estado real resumido al 2026-05-25

| Area | Estado |
|---|---|
| Next.js | 16.2.4 con React 19.2.4 |
| TypeScript | `npm run typecheck` pasa al 2026-05-25 |
| Build | `npm run build` pasa al 2026-05-25 |
| Contratos | `npm run test:contracts` pasa al 2026-05-25 |
| `/api/trading` | Normaliza mercado y reporta persistencia real |
| `/api/signals` | Node.js, JWT fallback, Supabase; riesgo por service role documentado |
| `/api/market/*` | Yahoo Finance real con cache/rate limit basico |
| `/api/alerts/check` | Protegido por secreto de cron y batch de quotes |
| Supabase | Migracion inicial consolidada y RPCs financieras |
| Quant-engine | FastAPI local expuesto por Cloudflare Tunnel, con fallback de velas por Yahoo chart para HMM/GARCH/ARIMA |
| QuantConnect | Estructura presente, sin backtest end-to-end confirmado |
| SDD | Parcial: contratos/runbooks/memoria tecnica, sin `specs/` formal aun |

## 5. Estado operativo reciente

El problema reciente del screener/quant era doble:

```text
1. QUANT_ENGINE_URL apuntaba a un quick tunnel expirado.
2. yfinance recibia 429 en Python, por lo que Graham/ARIMA/HMM/GARCH quedaban en HOLD/0/Unknown.
```

Estado aplicado:

- `scripts/start-quant-cloudflare.ps1` levanta FastAPI + Cloudflare quick tunnel y puede actualizar Vercel.
- `quant-engine/market_data.py` obtiene velas desde `query1.finance.yahoo.com/v8/finance/chart`.
- HMM/GARCH/ARIMA usan ese helper antes de caer a `yfinance`.
- Graham puede quedar no concluyente sin anular el analisis tecnico.
- El screener no deja que un HOLD neutral de Python tape un BUY/SELL tecnico por score.
- Fase 7 inicia el desacoplamiento con `quant_jobs`, `quant_job_events`, `market_data_cache`, el BFF `/api/quant/jobs`, cache durable en `/api/market/candles` y specs SDD bajo `specs/`.

Limitacion vigente: sin credenciales de Cloudflare para tunel nombrado, `trycloudflare.com` no garantiza URL fija. Usar `npm run quant:start:vercel` al reiniciar para actualizar Vercel.

## 6. Reglas de implementacion

### Antes de escribir codigo

```text
[ ] Leer AGENTS.md
[ ] Leer LLM_CONTEXT.md
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

`LLM.md` puede hablar de:

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
[ ] Spec bajo `specs/` actualizada si cambia API, Supabase, quant-engine, BFF o cache
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
2. LLM_CONTEXT.md
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
