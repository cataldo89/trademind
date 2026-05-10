# Problemas de escalamiento y errores producidos en el frontend por backend

Fecha de auditoria: 2026-05-10  
Estado: memoria operativa para IAs y desarrolladores  
Prioridad: alta  
Relacion directa: `AGENTS.md`, `ANTIGRAVITY_CONTEXT.md`, `ESTADO_ACTUAL_PROYECTO.md`, `ESTRUCTURA_PROYECTO.md`, `soluciones_tecnicas.md`, `SEGURIDAD.md`

## 1. Objetivo

Este runbook registra los errores actuales y los riesgos futuros de escalamiento que pueden hacer que el frontend falle por decisiones, limites o inconsistencias del backend.

La regla para cualquier IA futura es:

> No corregir sintomas visuales del frontend sin verificar primero API routes, Supabase, quant-engine, contratos de datos, cache, rate limits y variables de entorno.

Este archivo no reemplaza la auditoria general. Complementa `ESTADO_ACTUAL_PROYECTO.md` con foco en incidentes frontend/backend y escalabilidad SaaS.

## 2. Resumen ejecutivo

Los problemas mas importantes detectados son:

| Prioridad | Problema | Impacto visible en frontend | Causa backend |
|---|---|---|---|
| P0 | `/api/trading` inserta `market: 'EQUITY'` | La UI puede mostrar `success: true`, pero la senal no queda guardada | `signals.market` solo acepta `US` o `CL` |
| P0 | Schema Supabase no confiable | Ambientes nuevos pueden fallar o quedar incompletos | `schema.sql` contiene comentario SQL invalido con `#` y migraciones parciales |
| P0 | Operaciones financieras virtuales no atomicas | Balance, posiciones y transacciones pueden quedar inconsistentes | Compras simuladas se ejecutan desde cliente con multiples writes separados |
| P0 | Alertas sin contrato seguro de cron | Alertas no se disparan o se dispara trabajo masivo inseguro | `/api/alerts/check` no valida cron secret y procesa N alertas una por una |
| P1 | Market data sin rate limit ni batching real en consumidores | Pantallas lentas, errores 500/429 y degradacion con muchos usuarios | Clientes hacen fan-out de `/api/market/quote` aunque la API soporta multiples simbolos |
| P1 | Quant-engine sin cache/cola | `/api/trading` puede devolver 503 o timeout | Modelos pesados se entrenan por request y `QUANT_ENGINE_URL` cae a localhost |
| P1 | Service role usado en endpoints de usuario | Riesgo de fuga si un filtro futuro se rompe | `createAdminClient` bypassea RLS |
| P1 | Lint base fallando | `npm run verify` no queda verde | React Compiler, `any`, entidades no escapadas y archivos externos/minificados |

## 3. Problema tecnico actual principal

### P0.1 `/api/trading` devuelve exito aunque la persistencia puede fallar

Evidencia:

- `src/app/api/trading/route.ts:89-100` inserta en `signals` con `market: 'EQUITY'`.
- `supabase/schema.sql:139` define `market TEXT NOT NULL CHECK (market IN ('US', 'CL'))`.
- `src/app/api/trading/route.ts:101-103` captura el error de Supabase, lo imprime y continua.
- `src/app/api/trading/route.ts:106` devuelve `{ success: true, signal: ... }` aunque el insert haya fallado.

Sintomas probables en frontend:

- El usuario genera una senal y ve respuesta exitosa.
- La pantalla de senales no muestra la senal despues de refrescar.
- El dashboard parece inconsistente porque el motor dice que genero algo, pero Supabase no lo persiste.
- Otra IA puede perder tiempo depurando React Query, cache o componentes cuando la causa real es un constraint de DB.

Causa raiz:

```text
Contrato roto entre backend y base de datos:
/api/trading usa market = EQUITY
Supabase signals.market acepta solo US o CL
```

Mitigacion inmediata recomendada:

- Normalizar `market` antes del insert a `US` o `CL` segun el simbolo/mercado recibido.
- No tragarse errores de persistencia cuando la UI espera que la senal quede guardada.
- Devolver `success: false` o `persisted: false` si Supabase rechaza el insert.
- Agregar test de integracion para `/api/trading` con payload valido.

Criterio de cierre:

```text
POST /api/trading con usuario autenticado
-> llama quant-engine o fallback controlado
-> inserta signal con market permitido
-> devuelve persisted: true solo si Supabase confirma insert
-> /api/signals muestra la senal persistida
```

## 4. Errores actuales y riesgos P0

### P0.2 Schema y migraciones Supabase no son una fuente confiable

Evidencia:

- `supabase/schema.sql:203` contiene `# bumped: 2026-05-05T04:21:00`.
- PostgreSQL no acepta `#` como comentario SQL valido.
- `supabase/migrations/001_add_virtual_balance.sql` solo agrega `virtual_balance`.
- El schema completo tiene tablas, policies e indices que no estan versionados en migraciones incrementales completas.

Impacto en frontend:

- Deploys nuevos pueden fallar al aplicar schema.
- Pantallas de portfolio, senales, alertas o watchlist pueden quedar vacias aunque el codigo parezca correcto.
- Errores RLS o columnas faltantes pueden aparecer como errores genericos de Supabase en componentes cliente.

Accion recomendada:

- Cambiar `# bumped` por `-- bumped`.
- Convertir el schema real en migraciones idempotentes y ordenadas.
- Documentar si `schema.sql` es snapshot manual o fuente aplicable.
- Ejecutar una auditoria de drift antes de agregar features sobre Supabase.

### P0.3 Operaciones financieras virtuales no atomicas

Evidencia:

- `src/components/signals/signals-client.tsx:178-226` inserta posicion, actualiza balance, inserta transaccion y cancela senal con writes separados.
- `src/components/analysis/technical-summary.tsx:373-407` repite compras simuladas con multiples writes.
- `src/components/portfolio/portfolio-client.tsx:189-209` inserta posiciones desde cliente.

Impacto en frontend:

- Doble click, dos pestanas o latencia pueden crear dos posiciones contra el mismo saldo.
- Una posicion puede quedar abierta aunque el balance no se haya descontado.
- El historial puede perder transacciones si falla el write posterior.
- El usuario ve P&L o capital virtual incorrecto.

Causa raiz:

```text
Logica financiera critica en Client Components
sin transaccion SQL ni RPC atomica
```

Accion recomendada:

- Crear una RPC Supabase o API route server-side para orden simulada.
- En una sola transaccion: validar saldo, insertar posicion, insertar transaccion, descontar balance y actualizar senal.
- Bloquear concurrencia por usuario o usar control optimista con condicion `virtual_balance >= amount`.
- El cliente solo debe enviar intencion, no ejecutar la contabilidad.

### P0.4 `/api/alerts/check` no tiene contrato seguro de ejecucion

Evidencia:

- `src/app/api/alerts/check/route.ts:7-90` acepta POST sin validar `CRON_SECRET` o usuario admin.
- Usa `createClient()` con cookies, lo que en cron sin sesion puede no ver filas por RLS.
- Procesa alertas una por una y llama internamente `/api/market/quote` por cada alerta.

Impacto en frontend:

- Alertas activas no se disparan porque el cron no ve datos.
- Alertas se disparan tarde si hay muchas filas.
- Un cliente podria provocar chequeos masivos si la ruta queda publica.

Accion recomendada:

- Definir `POST /api/alerts/check` solo para cron con `CRON_SECRET`.
- Usar service role solo dentro del servidor y con ruta protegida.
- Paginar alertas activas.
- Agrupar simbolos y usar `/api/market/quote?symbols=AAPL,MSFT`.
- Guardar metricas: checked, triggered, failed, durationMs.

## 5. Riesgos P1 de escalamiento SaaS

### P1.1 Fan-out de quotes desde el frontend

Evidencia:

- `src/components/signals/signals-client.tsx:48-65` hace `Promise.all` con un request por senal.
- `src/components/portfolio/portfolio-client.tsx:61-79` hace un request por posicion.
- `src/app/api/market/quote/route.ts:21-39` ya soporta simbolos separados por coma y chunks de 50.

Impacto:

- 50 posiciones generan 50 llamadas frontend -> Next -> Yahoo.
- Mas usuarios multiplican requests y riesgo de 429/rate limit.
- La cache `s-maxage=30` no se aprovecha si los clientes fuerzan `cache: 'no-store'`.

Accion recomendada:

- Agrupar simbolos unicos por pantalla.
- Llamar una vez a `/api/market/quote?symbols=AAPL,MSFT,NVDA`.
- Mapear resultados por `symbol` en memoria.
- Definir politica de cache por tipo de dato.

### P1.2 Rutas publicas sin rate limit real

Rutas afectadas:

- `src/app/api/market/quote/route.ts`
- `src/app/api/market/candles/route.ts`
- `src/app/api/market/movers/route.ts`
- `src/app/api/ai/analyze/route.ts`

Impacto:

- Un crawler o usuario puede consumir cuotas de Yahoo/LLM.
- Vercel puede escalar serverless por trafico inutil.
- Gemini/OpenAI pueden generar costo si hay claves configuradas.

Accion recomendada:

- Rate limit por IP y por usuario autenticado.
- Limitar cantidad maxima de simbolos por request.
- Cache server-side para quotes/candles.
- Proteger rutas AI con cuota de usuario o feature flag.

### P1.3 Quant-engine no escala como request sincrono

Evidencia:

- `src/lib/ai/mcp-client.ts:18` usa `QUANT_ENGINE_URL || 'http://127.0.0.1:8000'`.
- `src/lib/ai/mcp-client.ts:88-90` usa timeout de 15 segundos para workflow.
- `quant-engine/risk_models.py` descarga datos y entrena HMM/GARCH/ARIMA bajo demanda.
- `quant-engine/graham_filters.py` depende de `Ticker.info`.

Impacto:

- En Vercel, si falta `QUANT_ENGINE_URL`, se intenta conectar al localhost del runtime serverless.
- Analisis lentos devuelven 503 o timeout.
- Yahoo/yfinance puede bloquear o degradar por volumen.

Accion recomendada:

- Declarar `QUANT_ENGINE_URL` y `QUANT_ENGINE_SECRET` como obligatorias en produccion.
- Devolver error de configuracion antes de intentar localhost en Vercel.
- Agregar cache por simbolo/rango.
- Agregar cola de jobs para modelos pesados.
- Guardar resultados parciales y permitir respuesta asincrona.

### P1.4 Uso de service role en endpoints de usuario

Evidencia:

- `src/app/api/signals/route.ts:18-29` usa `createAdminClient()` si existe `SUPABASE_SERVICE_ROLE_KEY`.
- Las queries filtran por `user_id`, pero service role bypassea RLS.

Impacto:

- Un bug futuro en filtro podria exponer o modificar datos de otro usuario.
- Produccion no prueba realmente las policies RLS.

Accion recomendada:

- Preferir cliente autenticado y RLS para CRUD de usuario.
- Usar service role solo para jobs internos protegidos.
- Si se mantiene, validar `user_id` server-side y agregar tests de aislamiento.

### P1.5 Variables de entorno desalineadas

Riesgos detectados:

- `.env.example` no documenta todas las variables usadas por Next/Vercel y quant-engine.
- `NEXT_PUBLIC_APP_URL` se usa como fallback para alertas.
- `QUANT_ENGINE_URL`, `QUANT_ENGINE_SECRET`, `QUANT_ENGINE_AUTH_DISABLED`, `OPENAI_MODEL` y `GEMINI_MODEL` deben quedar en matriz de entorno.

Impacto:

- Deploys nuevos fallan de forma silenciosa.
- Alertas llaman localhost en produccion si falta URL publica.
- Trading devuelve 503 por configuracion incompleta.

Accion recomendada:

- Mantener matriz de entorno en `README.md` y `.env.example`.
- Marcar variables obligatorias de produccion.
- No poner secretos reales en `.env.example`.

## 6. Riesgos P2 y deuda tecnica

### P2.1 Errores internos expuestos al cliente

Evidencia:

- Algunas API routes devuelven `details: String(error)`.

Impacto:

- Puede filtrar mensajes internos de librerias o configuracion.
- Frontend queda acoplado a errores no estables.

Accion recomendada:

- Log server-side con correlation id.
- Responder errores genericos y codigos estables al cliente.

### P2.2 Tipos de timeframe/range mezclados

Evidencia:

- Tipos globales usan timeframes tecnicos como `1m`, `5m`, `1d`.
- Senales guardables usan rangos visuales `1D`, `5D`, `1M`.

Impacto:

- Filtros, expiraciones y charts pueden interpretar mal el mismo campo.

Accion recomendada:

- Separar `ChartRange` de `TechnicalTimeframe`.
- Definir contrato DB para `signals.timeframe`.

### P2.3 Modo demo oculta errores de configuracion

Riesgo:

- Si faltan env vars, algunos componentes pueden seguir renderizando con usuario demo o Supabase demo.
- Esto puede esconder fallos reales hasta produccion.

Accion recomendada:

- En produccion, fallar explicito si faltan Supabase envs.
- Mantener demo mode solo con flag explicito.

### P2.4 `next.config.ts` solo permite localhost en Server Actions

Riesgo:

- Si se agregan Server Actions reales en produccion, pueden fallar por origen no permitido.

Accion recomendada:

- Agregar dominio oficial Vercel si se usan Server Actions.
- Quitar config si no aplica.

## 7. Validacion ejecutada en esta auditoria

Comandos ejecutados el 2026-05-10:

```bash
npm run typecheck
npm run lint
```

Resultado:

- `npm run typecheck`: pasa sin errores TypeScript.
- `npm run lint`: falla con `886 problems (21 errors, 865 warnings)`.

Errores lint destacados:

- `src/components/analysis/zesty-workspace.tsx:98` y `:117`: `setState` sincronico dentro de effect.
- `src/components/landing/VisionSection.tsx:37`: entidades HTML no escapadas.
- `src/components/portfolio/portfolio-client.tsx:372` y `:378`: uso de `any`.
- Salida grande incluye muchos warnings/errores provenientes de archivos externos/minificados bajo antecedentes del proyecto, por lo que ESLint necesita `ignores` o saneamiento de scope.

## 8. Checklist para otra IA antes de tocar frontend

Antes de modificar componentes React, verificar:

```text
[ ] La API que consume el componente devuelve el shape documentado.
[ ] La DB acepta los valores enviados por la API.
[ ] No hay constraints Supabase que contradigan enums TypeScript.
[ ] La ruta no traga errores y devuelve success falso cuando falla persistencia.
[ ] El componente no hace N requests si la API soporta batch.
[ ] Las operaciones financieras no se ejecutan desde cliente con writes separados.
[ ] La ruta esta protegida si consume service role o costos LLM.
[ ] La cache de frontend no contradice headers del backend.
[ ] Las variables de entorno obligatorias estan documentadas.
[ ] `npm run typecheck` pasa y `npm run lint` queda documentado si falla.
```

## 9. Contratos recomendados para escalar

### Contrato de senales

```text
Frontend -> /api/trading o /api/signals
Backend valida usuario, simbolo, market, timeframe
Backend normaliza market a US/CL
Backend persiste en Supabase
Backend devuelve persisted: true solo despues del insert
Frontend refresca /api/signals
```

### Contrato de orden simulada

```text
Frontend envia: symbol, market, amount, sourceSignalId opcional
Backend/RPC valida saldo y precio
Transaccion atomica:
  insertar position
  insertar transaction
  descontar virtual_balance
  cancelar signal opcional
Respuesta incluye positionId, transactionId, newBalance
```

### Contrato de quotes

```text
Cliente agrupa simbolos unicos
GET /api/market/quote?symbols=AAPL,MSFT,NVDA&market=US
Backend aplica limite maximo, cache y backoff
Respuesta array normalizada por symbol
Cliente no fuerza no-store salvo pantalla realmente live
```

### Contrato de quant-engine

```text
Next.js API Node runtime -> FastAPI quant-engine
Headers: X-TradeMind-Quant-Secret
Timeout por herramienta y timeout total
Cache por symbol/timeframe
Respuesta parcial si un modelo falla
No se entrena modelo pesado por cada request en produccion sin cola/cache
```

## 10. Criterios de cierre para estabilizacion

El sistema puede considerarse listo para escalar solo cuando:

```text
[ ] `npm run verify` pasa o sus fallos estan reducidos a deuda no bloqueante documentada.
[ ] Supabase tiene migraciones aplicables de cero a produccion.
[ ] `/api/trading` no devuelve success si no persiste.
[ ] Operaciones de balance/posiciones/transacciones son atomicas.
[ ] Alertas usan cron secret, service role protegido y batch de quotes.
[ ] Market data tiene rate limit, cache y consumidores batch.
[ ] Quant-engine tiene deployment URL real, secreto, cache y health check.
[ ] Service role no se usa en rutas de usuario sin justificacion y tests de aislamiento.
[ ] Frontend muestra errores accionables cuando backend falla.
```
