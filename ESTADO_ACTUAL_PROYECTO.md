# ESTADO ACTUAL DEL PROYECTO - TradeMind CV

Fecha de auditoria: 2026-05-10  
Rol: memoria tecnica maestra para agentes IA  
Metodo: lectura de archivos, auditoria estatica de rutas frontend/backend y ejecucion de `npm run typecheck` + `npm run lint`.

## 0. Orden de lectura obligatorio

Antes de modificar codigo, leer:

1. `AGENTS.md`
2. `ANTIGRAVITY_CONTEXT.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `ESTRUCTURA_PROYECTO.md`
5. `soluciones_tecnicas.md`
6. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
7. `SEGURIDAD.md`

Este archivo describe el estado tecnico actual. El runbook de escalamiento documenta con mas detalle los errores frontend/backend y riesgos de crecimiento del SaaS.


## Actualizacion de estabilizacion - 2026-05-10

Cambios aplicados despues de la auditoria inicial:

- `/api/trading` normaliza `market` a `US`/`CL`, rechaza mercados invalidos y devuelve `persisted: true` solo si Supabase confirma el insert.
- `supabase/migrations/000_initial_schema.sql` consolida schema, RLS, policies idempotentes y RPCs `execute_virtual_trade` / `close_virtual_position`.
- Compras/cierres virtuales se ejecutan server-side via RPC transaccional; el cliente envia intenciones de orden.
- `/api/alerts/check` requiere `CRON_SECRET`, usa service role solo tras validar el secreto, batch de quotes y metricas.
- `/api/market/*` tiene validacion, limites, cache server-side y rate limit basico; pantallas principales agrupan quotes.
- Quant-engine se consume via `QUANT_ENGINE_URL` + `QUANT_ENGINE_SECRET` sin localhost en produccion y FastAPI cachea resultados por TTL.
- Validacion local: `npm run test:contracts`, `npm run typecheck` y `npm run lint` pasan; lint queda con warnings no bloqueantes.
## 1. Stack verificado

| Area | Estado actual |
|---|---|
| Frontend/backend | Next.js 16.2.4, React 19.2.4, TypeScript, App Router |
| UI | Tailwind CSS, Recharts, Lightweight Charts, componentes propios |
| Auth/DB | Supabase Auth, PostgreSQL, RLS, clientes SSR/browser |
| Datos de mercado | `yahoo-finance2` como integracion real principal |
| IA narrativa | Gemini/OpenAI si existen claves; fallback deterministico en `/api/ai/analyze` |
| Quant-engine | Python FastAPI, yfinance, HMM, GARCH, ARIMA, PCA/Lasso, Graham |
| Backtesting | QuantConnect LEAN presente, integracion real aun incompleta |
| Deploy | Vercel, proyecto oficial `trademind-cv` |

Scripts reales en `package.json`:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "audit:zesty": "node scripts/audit-zesty-symbols.mjs",
  "typecheck": "tsc --noEmit",
  "verify": "npm run lint && npm run typecheck && npm run build"
}
```

## 2. Validacion ejecutada

Comandos ejecutados el 2026-05-10:

```bash
npm run typecheck
npm run lint
```

Resultado:

| Comando | Resultado | Observacion |
|---|---|---|
| `npm run typecheck` | Pasa | No reporto errores TypeScript |
| `npm run lint` | Falla | `886 problems (21 errors, 865 warnings)` |

Errores lint destacados:

- `src/components/analysis/zesty-workspace.tsx:98` y `:117`: React Compiler marca `setState` sincronico dentro de effects.
- `src/components/landing/VisionSection.tsx:37`: comillas sin escape en JSX.
- `src/components/portfolio/portfolio-client.tsx:372` y `:378`: `any` explicito.
- La salida incluye muchos warnings/errores de archivos externos/minificados bajo antecedentes del workspace; ESLint necesita scope/ignores mas precisos.

Estado de `verify`:

```text
NO VERDE mientras `npm run lint` falle.
```

## 3. APIs Next.js

### `/api/trading`

Archivo: `src/app/api/trading/route.ts`

Estado actual:

- Ya no es un mock puro con `Math.random()`.
- Llama a `mcpClient.runWorkflow(symbol)`.
- Depende de `QUANT_ENGINE_URL`, `QUANT_ENGINE_SECRET` y disponibilidad del FastAPI quant-engine.
- Si hay usuario autenticado, intenta persistir en `signals`.

Problema critico actual:

- Inserta `market: 'EQUITY'`.
- `supabase/schema.sql` solo permite `market IN ('US', 'CL')`.
- El error de persistencia se captura y se ignora para la respuesta final.
- La API puede responder `success: true` aunque Supabase haya rechazado el insert.

Impacto:

- El frontend puede creer que una senal fue generada y persistida, pero `/api/signals` no la mostrara.
- Este es el error tecnico actual mas importante detectado en la auditoria.

Referencia: `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`.

### `/api/signals`

Archivo: `src/app/api/signals/route.ts`

Estado actual:

- Runtime Node.js por compatibilidad con `@supabase/ssr`.
- Mantiene patron de doble autenticacion: primero `Authorization: Bearer`, luego cookies.
- Permite guardar timeframes accionables `1D`, `5D`, `1M`.
- Usa `createAdminClient()` si existe `SUPABASE_SERVICE_ROLE_KEY`.

Riesgo:

- Service role bypassea RLS. Aunque hoy filtra por `user_id`, un bug futuro en filtros podria exponer datos de otros usuarios.

Accion recomendada:

- Preferir cliente autenticado + RLS para CRUD por usuario.
- Mantener service role solo para jobs internos protegidos.
- Agregar tests de aislamiento por usuario.

### `/api/ai/analyze`

Archivo: `src/app/api/ai/analyze/route.ts`

Estado actual:

- Usa datos de Yahoo Finance.
- Construye analisis narrativo.
- Intenta Gemini si existe `GEMINI_API_KEY`.
- Intenta OpenAI si existe `OPENAI_API_KEY`.
- Tiene fallback deterministico si no hay LLM disponible.

Riesgo:

- Ruta publica sin rate limit visible.
- Puede generar costo si hay claves LLM configuradas.
- No debe confundirse con motor cuantitativo validado o backtesteado.

### `/api/market/*`

Rutas principales:

- `src/app/api/market/quote/route.ts`
- `src/app/api/market/candles/route.ts`
- `src/app/api/market/movers/route.ts`

Estado actual:

- Usan Yahoo Finance como fuente real principal.
- `/api/market/quote` soporta `symbols` separados por coma y chunks de 50.

Riesgos:

- No hay rate limit real.
- Varios componentes clientes hacen fan-out de requests individuales en vez de batch.
- Algunos consumidores fuerzan `cache: 'no-store'`, contradiciendo headers `s-maxage`.

### `/api/alerts/check`

Archivo: `src/app/api/alerts/check/route.ts`

Estado actual:

- Revisa alertas activas contra precios actuales.
- No valida `CRON_SECRET` ni rol admin.
- Usa `createClient()` dependiente de cookies, lo que puede no funcionar en cron sin sesion.
- Hace una llamada de quote por alerta.

Riesgo:

- Alertas pueden no dispararse en produccion.
- Si se cambia a service role sin proteccion, puede quedar endpoint masivo expuesto.

## 4. Supabase y datos

Estado:

- `profiles`, `signals`, `alerts`, `positions`, `transactions`, `watchlist_items` y `audit_logs` aparecen en `supabase/schema.sql`.
- RLS esta definido para tablas principales.
- Existe migracion `supabase/migrations/001_add_virtual_balance.sql` para `profiles.virtual_balance`.

Problemas:

- `supabase/schema.sql` contiene `# bumped: ...`, comentario invalido para PostgreSQL.
- El schema completo no esta convertido en una secuencia de migraciones completa.
- Hay riesgo de drift entre ambientes.

Impacto:

- Un ambiente nuevo puede fallar al aplicar schema.
- Las pantallas pueden fallar por columnas o policies faltantes.

Accion recomendada:

- Convertir schema en migraciones idempotentes.
- Corregir comentario `#` por `--`.
- Auditar drift antes de nuevas features.

## 5. Quant-engine

Ruta: `quant-engine/`

Estado verificado:

- FastAPI expone endpoints MCP/tools y `/workflow/analyze`.
- HMM, GARCH, ARIMA, Graham y PCA/Lasso existen como implementacion inicial.
- `MCPClient` de Next.js ya llama al workflow del quant-engine.

Riesgos:

- `QUANT_ENGINE_URL` cae por defecto a `http://127.0.0.1:8000`; en Vercel esto no sirve si no se configura URL real.
- Modelos descargan datos y entrenan en request.
- No hay cache central, cola de jobs ni respuesta asincrona.
- `yfinance` puede degradar o limitar bajo carga.

Accion recomendada:

- Declarar `QUANT_ENGINE_URL` y `QUANT_ENGINE_SECRET` obligatorias en produccion.
- Agregar health check.
- Cachear por simbolo/rango.
- Separar entrenamiento de inferencia para modelos pesados.
- Permitir respuesta parcial si un modelo falla.

## 6. QuantConnect LEAN

Estado:

- `qc-workspace/` existe con estructura LEAN y datos historicos.
- `quant-engine/lean_integration.py` existe.
- La funcion `run_lean_backtest()` sigue sin ejecutar un backtest real end-to-end.

Riesgo:

- No afirmar que QuantConnect esta funcional hasta tener evidencia de `lean whoami`, `lean backtest`, parseo de resultados y retorno al SaaS.

## 7. Modelos cuantitativos

| Componente | Estado | Riesgo |
|---|---|---|
| HMM | Implementacion inicial real | Entrena bajo demanda, necesita cache y validacion |
| GARCH/VaR | Implementacion inicial real | Descarga datos bajo demanda, necesita manejo de datos insuficientes |
| ARIMA | Implementacion inicial | Confianza no suficientemente validada |
| PCA/Lasso | Implementacion basica | `run_pca_autoencoder` no es autoencoder real |
| Graham | Implementacion real | Umbral actual debe mantenerse canonico y testeado |

Nota Graham:

- El codigo actual debe verificarse antes de citar umbrales.
- La documentacion historica tuvo contradicciones entre `0.50` y `1.10`.
- Toda IA debe tratar el umbral canonico como decision tecnica a validar con tests y codigo actual.

## 8. Brechas criticas por prioridad

### P0

1. `/api/trading` puede devolver exito aunque no persista senales por `market: 'EQUITY'` incompatible con Supabase.
2. Supabase schema/migraciones no son confiables para recrear un ambiente desde cero.
3. Compras simuladas y balance virtual no son atomicos.
4. `/api/alerts/check` no tiene contrato seguro de cron y puede no funcionar con RLS.

### P1

1. Market data sin rate limit ni cache server-side robusta.
2. Frontend hace fan-out de quotes y no usa batching disponible.
3. Quant-engine no escala como workflow sincrono por request.
4. Service role se usa en endpoints de usuario.
5. Variables de entorno estan desalineadas entre codigo, README y `.env.example`.
6. `npm run lint` falla; por eso `npm run verify` no esta verde.

### P2

1. Errores internos pueden exponerse con `details: String(error)`.
2. `ChartRange` y `Timeframe` estan mezclados conceptualmente.
3. Modo demo puede ocultar errores de configuracion.
4. `next.config.ts` tiene `serverActions.allowedOrigins` solo para localhost.

## 9. Estado ejecutivo

| Area | Estado actual estimado |
|---|---|
| UI principal | Funcional en estructura, requiere saneamiento de lint y optimizacion de datos |
| API Next.js | Parcialmente funcional, con P0 en persistencia de `/api/trading` |
| Supabase | Funcional en partes, migraciones/schema requieren normalizacion |
| Auth | Patron JWT fallback documentado y vigente |
| Market data | Real con Yahoo, pero sin hardening de escala |
| Quant-engine | Conectado parcialmente, no preparado para carga SaaS |
| QuantConnect | Pendiente end-to-end |
| Testing/CI | `typecheck` pasa; `lint` falla; no hay CI verde completo |

## 10. Regla final para agentes

No usar nombres de archivos como evidencia de funcionalidad. Verificar codigo, comandos, rutas, schema y logs.

Para cualquier error de frontend que parezca visual o de estado, revisar primero el runbook:

```text
docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
```