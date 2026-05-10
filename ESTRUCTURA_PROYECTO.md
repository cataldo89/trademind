# ESTRUCTURA DEL PROYECTO - TradeMind CV

Fecha de actualizacion: 2026-05-10  
Rol: mapa del repositorio para agentes IA  
Regla: inventario no equivale a funcionalidad. Para estado real leer `ESTADO_ACTUAL_PROYECTO.md` y para incidentes frontend/backend leer `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`.

## 1. Documentacion maestra

| Archivo | Rol |
|---|---|
| `AGENTS.md` | Reglas operativas, GitHub oficial, Vercel, orden de lectura obligatorio |
| `ANTIGRAVITY_CONTEXT.md` | Fuente operativa para agentes IA y separacion entre vision, realidad y gaps |
| `ESTADO_ACTUAL_PROYECTO.md` | Auditoria tecnica actual del codigo, validaciones y brechas |
| `ESTRUCTURA_PROYECTO.md` | Mapa de archivos y carpetas del repositorio |
| `soluciones_tecnicas.md` | Problemas resueltos y patrones tecnicos obligatorios |
| `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` | Runbook de fallas frontend/backend y riesgos de escalamiento SaaS |
| `SEGURIDAD.md` | Reglas de secretos, service role, scripts y checklist pre-push |
| `MEMORY.md` | Memoria historica y filosofia del producto |
| `GEMINI.md` | Vision futura y roadmap aspiracional AI-native |
| `CLAUDE.md` | Wrapper de lectura para Claude |
| `README.md` | Entrada publica, stack y ejecucion local |

## 2. Raiz del repo `trademind/`

| Ruta | Descripcion |
|---|---|
| `.env.example` | Plantilla de variables de entorno. No debe contener secretos reales |
| `.env.local` | Variables locales. No se sube a GitHub |
| `.gitignore` | Exclusiones de secretos, builds, dependencias y binarios locales |
| `next.config.ts` | Configuracion Next.js |
| `next-env.d.ts` | Tipos generados por Next.js |
| `package.json` | Scripts y dependencias npm |
| `package-lock.json` | Lockfile npm |
| `tsconfig.json` | Configuracion TypeScript |
| `tsconfig.tsbuildinfo` | Cache incremental TypeScript |
| `eslint.config.mjs` | Configuracion ESLint |
| `postcss.config.mjs` | Configuracion PostCSS/Tailwind |
| `tailwind.config.js` | Configuracion Tailwind |
| `public/` | Assets publicos |
| `src/` | App Next.js, APIs, componentes y librerias |
| `supabase/` | Schema, migraciones y config Supabase |
| `quant-engine/` | Servicio Python/FastAPI cuantitativo |
| `qc-workspace/` | Workspace QuantConnect LEAN |
| `lean-workspace/` | Workspace adicional relacionado a LEAN |
| `reports/` | Reportes generados, por ejemplo auditorias Zesty |
| `scripts/` | Scripts de mantenimiento/auditoria |
| `docs/` | Runbooks y documentacion operativa adicional |
| `apply-schema.ps1` | Script para aplicar schema usando variables de entorno |
| `check-tables.ps1` | Script para verificar tablas Supabase usando variables de entorno |
| `create-user.mjs` | Script para crear usuario usando variables de entorno |
| `patch-trigger.js` | Script de mantenimiento DB usando `DATABASE_URL` |
| `patch-trigger.sql` | SQL asociado a trigger de señales |
| `update-zesty.js` | Script de actualizacion Zesty |
| `upload_results.mjs` | Script de carga de resultados |

## 3. `docs/`

| Ruta | Descripcion |
|---|---|
| `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` | Registro de errores actuales, sintomas de frontend causados por backend, riesgos futuros de escalamiento y contratos recomendados |

Regla para agentes:

```text
Si el error se manifiesta en UI, revisar este runbook antes de editar componentes.
```

## 4. `src/` - Next.js frontend y backend

| Ruta | Descripcion |
|---|---|
| `src/app/` | App Router de Next.js |
| `src/components/` | Componentes React cliente/servidor |
| `src/lib/` | Utilidades, clientes Supabase/Yahoo/AI y logica compartida |
| `src/store/` | Estado global cliente |
| `src/types/` | Tipos TypeScript |
| `src/middleware.ts` | Middleware Supabase SSR y proteccion de rutas |

## 5. `src/app/`

| Ruta | Descripcion |
|---|---|
| `src/app/layout.tsx` | Layout raiz |
| `src/app/page.tsx` | Landing page |
| `src/app/live/page.tsx` | Pagina live/trading |
| `src/app/(auth)/login/page.tsx` | Login |
| `src/app/(auth)/register/page.tsx` | Registro |
| `src/app/(auth)/forgot-password/page.tsx` | Recuperacion de password |
| `src/app/auth/callback/route.ts` | Callback Supabase Auth |
| `src/app/(dashboard)/layout.tsx` | Layout dashboard autenticado |
| `src/app/(dashboard)/dashboard/page.tsx` | Dashboard principal |
| `src/app/(dashboard)/analysis/page.tsx` | Analisis tecnico |
| `src/app/(dashboard)/alerts/page.tsx` | Alertas |
| `src/app/(dashboard)/signals/page.tsx` | Señales |
| `src/app/(dashboard)/portfolio/page.tsx` | Portafolio |
| `src/app/(dashboard)/screener/page.tsx` | Screener |
| `src/app/(dashboard)/settings/page.tsx` | Configuracion |
| `src/app/(dashboard)/admin/page.tsx` | Admin |

## 6. API routes

| Ruta | Estado / descripcion |
|---|---|
| `src/app/api/ai/analyze/route.ts` | Analisis narrativo con Yahoo + Gemini/OpenAI si hay claves; fallback deterministico |
| `src/app/api/alerts/check/route.ts` | Verifica alertas activas. Requiere hardening de cron, auth y batching |
| `src/app/api/market/quote/route.ts` | Proxy Yahoo Finance para una o multiples cotizaciones |
| `src/app/api/market/candles/route.ts` | OHLCV desde Yahoo Finance |
| `src/app/api/market/movers/route.ts` | Market movers desde Yahoo Finance |
| `src/app/api/signals/route.ts` | CRUD de senales con JWT fallback y Supabase |
| `src/app/api/trading/route.ts` | Orquestador hacia quant-engine. Tiene P0 de persistencia por `market: 'EQUITY'` |
| `src/app/api/profile/virtual-balance/route.ts` | Actualizacion server-side de balance virtual |

## 7. Componentes principales

| Ruta | Descripcion / riesgo relevante |
|---|---|
| `src/components/analysis/zesty-workspace.tsx` | Workspace Zesty. Lint falla por `setState` sincronico en effects |
| `src/components/analysis/candlestick-chart.tsx` | Grafico OHLCV |
| `src/components/analysis/technical-summary.tsx` | Resumen tecnico y compra simulada desde cliente; requiere transaccion server-side |
| `src/components/analysis/ai-advisor.tsx` | UI de analisis IA narrativo |
| `src/components/analysis/quote-header.tsx` | Header de cotizacion |
| `src/components/analysis/symbol-search.tsx` | Busqueda de simbolos |
| `src/components/signals/signals-client.tsx` | Lista/ejecucion de senales; hace fan-out de quotes y writes no atomicos |
| `src/components/portfolio/portfolio-client.tsx` | Portafolio; hace fan-out de quotes y operaciones cliente |
| `src/components/alerts/alerts-client.tsx` | CRUD de alertas |
| `src/components/dashboard/portfolio-summary-widget.tsx` | Resumen de portafolio; revisar batching de quotes |
| `src/components/dashboard/active-signals-widget.tsx` | Senales activas |
| `src/components/dashboard/market-calendar-widget.tsx` | Calendario de mercado |
| `src/components/dashboard/market-movers-widget.tsx` | Movers de mercado |
| `src/components/dashboard/watchlist-widget.tsx` | Watchlist |
| `src/components/layout/header.tsx` | Header |
| `src/components/layout/sidebar.tsx` | Sidebar desktop |
| `src/components/layout/mobile-nav.tsx` | Navegacion mobile |
| `src/components/landing/HeroSection.tsx` | Landing hero |
| `src/components/landing/FeatureGrid.tsx` | Grid de features |
| `src/components/landing/VisionSection.tsx` | Vision landing; lint por entidad JSX no escapada |
| `src/components/auth/*.tsx` | Formularios auth |
| `src/components/ui/skeleton-card.tsx` | UI skeleton |

## 8. `src/lib/`

| Ruta | Descripcion |
|---|---|
| `src/lib/ai/mcp-client.ts` | Cliente hacia quant-engine. Usa `QUANT_ENGINE_URL` o localhost por defecto |
| `src/lib/supabase/client.ts` | Cliente Supabase browser |
| `src/lib/supabase/server.ts` | Cliente Supabase server y admin client |
| `src/lib/yahoo-finance.ts` | Wrapper yahoo-finance2 |
| `src/lib/market-data.ts` | Datos/categorias Zesty y utilidades de mercado |
| `src/lib/market-schedule.ts` | Horarios de mercado |
| `src/lib/chart-ranges.ts` | Rangos de chart |
| `src/lib/indicators.ts` | Indicadores tecnicos |
| `src/lib/utils.ts` | Utilidades comunes |
| `src/lib/supabase-test.ts` | Prueba manual de Supabase |

## 9. Supabase

| Ruta | Descripcion / riesgo |
|---|---|
| `supabase/schema.sql` | Snapshot de schema. Contiene comentario `# bumped` invalido para PostgreSQL y debe migrarse correctamente |
| `supabase/migrations/001_add_virtual_balance.sql` | Migracion parcial para `profiles.virtual_balance` |
| `supabase/config.toml` | Configuracion Supabase CLI |

Tablas principales descritas por el schema:

| Tabla | Uso |
|---|---|
| `profiles` | Perfil y `virtual_balance` |
| `watchlist_items` | Watchlist por usuario |
| `positions` | Posiciones simuladas |
| `transactions` | Historial de operaciones |
| `alerts` | Alertas de precio/volumen/cambio |
| `signals` | Senales generadas o guardadas |
| `audit_logs` | Auditoria |

## 10. Quant-engine

| Ruta | Descripcion |
|---|---|
| `quant-engine/main.py` | FastAPI con endpoints MCP/tools, ML y workflow |
| `quant-engine/risk_models.py` | HMM, GARCH/VaR y ARIMA |
| `quant-engine/time_series_models.py` | Modelos de series temporales |
| `quant-engine/graham_filters.py` | Filtros Benjamin Graham |
| `quant-engine/ml_pipeline.py` | PCA/Lasso/Ridge iniciales |
| `quant-engine/lean_integration.py` | Integracion LEAN pendiente end-to-end |
| `quant-engine/agents/graph.py` | Workflow secuencial, no LangGraph real |
| `quant-engine/tests/` | Tests Python existentes |
| `quant-engine/requirements.txt` | Dependencias Python |
| `quant-engine/run.py` | Arranque/ejecucion del servicio |

## 11. QuantConnect / LEAN

| Ruta | Descripcion |
|---|---|
| `qc-workspace/` | Workspace LEAN con configuracion y datos historicos |
| `qc-workspace/TradeMindCRT/` | Algoritmo TradeMindCRT |
| `lean-workspace/` | Workspace adicional relacionado a LEAN |

Estado real:

```text
LEAN existe en estructura, pero no hay evidencia de backtest end-to-end conectado al SaaS.
```

## 12. Flujo de datos actual

```text
Browser
  -> Next.js pages/components
  -> API routes `/api/market/*` -> Yahoo Finance
  -> API route `/api/ai/analyze` -> Yahoo + Gemini/OpenAI/fallback
  -> API route `/api/signals` -> Supabase
  -> API route `/api/trading` -> MCPClient -> quant-engine FastAPI -> Supabase signals
  -> Supabase browser client para partes del portfolio, alerts y signals
```

Riesgo principal:

```text
Varias operaciones criticas aun viven en Client Components y deben moverse a API/RPC atomicas antes de escalar.
```

## 13. Tecnologias reales y aspiracionales

| Categoria | Real hoy | Aspiracional / pendiente |
|---|---|---|
| Datos mercado | Yahoo Finance | Alpha Vantage, Finnhub, Polygon integrados end-to-end |
| Agentes | Workflow Python secuencial | LangGraph real con memoria persistente |
| XAI | Explicaciones deterministicas/textuales | SHAP/LIME real |
| ML | HMM, GARCH, ARIMA, PCA/Lasso iniciales | Autoencoder real, validacion robusta, jobs asincronos |
| Backtesting | Estructura LEAN | Backtest ejecutado y parseado desde SaaS |
| Realtime | Polling/refetch parcial | SSE/WebSocket/Supabase Realtime validado |

## 14. Regla de mantenimiento

Actualizar este archivo cuando:

- Se agregue una ruta API.
- Se mueva logica critica de cliente a servidor.
- Se agregue una migracion Supabase real.
- Cambie el contrato entre frontend, API routes, Supabase o quant-engine.
- Se cierre alguno de los P0 del runbook de escalamiento.