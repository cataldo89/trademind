# ESTRUCTURA DEL PROYECTO — TradeMind CV

> **AVISO IMPORTANTE:** Este es un mapa de archivos e inventario. **INVENTARIO NO EQUIVALE A FUNCIONALIDAD**. La existencia de un archivo (ej. `lean_integration.py` o `mcp-client.ts`) no implica que el sistema esté interconectado o validado. Lea `ESTADO_ACTUAL_PROYECTO.md` para el estado real.
> **Fecha de generacion:** 2026-05-03
> **Descripcion:** Mapa completo de carpetas y archivos del proyecto TradeMind.

---

## RAIZ DEL PROYECTO (trademind/)

`
trademind/
`

| Archivo | Descripcion |
|---------|-------------|
| .env.example | Plantilla de variables de entorno (Supabase, Gemini, QuantConnect, AlphaVantage, OpenAI) |
| .env.local | Variables de entorno locales (no se sube a git) |
| .gitignore | Archivos y directorios ignorados por git (node_modules, .env, .next, etc.) |
| AGENTS.md | Instrucciones para agentes de IA (reglas de deploy Vercel, variables obligatorias) |
| CLAUDE.md | Configuracion de reglas para Claude Code CLI |
| GEMINI.md | Configuracion de reglas para Gemini CLI |
| LICENSE | Licencia del proyecto |
| MEMORY.md | Memoria de contexto del proyecto (estado historico de decisiones) |
| README.md | Documentacion principal del proyecto |
| soluciones_tecnicas.md | Notas tecnicas de soluciones implementadas |
| 
ext.config.ts | Configuracion de Next.js (headers, redirects, webpack) |
| 
ext-env.d.ts | Tipos generados automaticamente de Next.js |
| package.json | Dependencias del proyecto (Next.js, Supabase, tailwind, yahoo-finance2, etc.) |
| package-lock.json | Lockfile de dependencias npm |
| 	sconfig.json | Configuracion de TypeScript (paths, compiler options) |
| 	sconfig.tsbuildinfo | Info de compilacion TypeScript |
| eslint.config.mjs | Reglas de ESLint para linting |
| postcss.config.mjs | Configuracion de PostCSS + Tailwind |
| 	ailwind.config.js | Configuracion de Tailwind CSS (colores, plugins, theme) |
| ercel.json | Configuracion de deploy en Vercel (framework, builds, env) |
| supabase.exe | CLI de Supabase para Windows |
| supabase_cli.tar.gz | CLI de Supabase comprimido |
| pply-schema.ps1 | Script PowerShell para aplicar schema SQL a Supabase |
| check-tables.ps1 | Script PowerShell para verificar tablas en Supabase |
| create-user.mjs | Script para crear usuario admin en Supabase |
| patch-trigger.js | Script para agregar trigger en tabla signals |
| patch-trigger.sql | SQL para trigger de auto-trigger en tabla signals |
| update-zesty.js | Script de actualizacion de datos de symbols |
| upload_results.mjs | Script de carga de resultados al backend |
| 1.txt | Archivo de version/registro v1 |
| 2.txt | Archivo de version/registro v2 |

---

## CARPETA public/

`
trademind/public/
`

| Archivo | Descripcion |
|---------|-------------|
| ile.svg | Icono de archivo (landing page) |
| globe.svg | Icono de globo (landing page) |
| 
ext.svg | Logo de Next.js |
| ercel.svg | Logo de Vercel |
| window.svg | Icono de ventana (landing page) |

---

## CARPETA supabase/

`
trademind/supabase/
`

| Archivo | Descripcion |
|---------|-------------|
| config.toml | Configuracion de Supabase CLI (proyecto, db, studio, edge functions) |
| schema.sql | Schema completo de la base de datos (profiles, signals, alerts, positions, transactions, watchlist, audit_logs) con RLS policies |
| create_audit_logs.sql | SQL especifico para crear tabla audit_logs |
| .temp/ | Archivos temporales del CLI de Supabase (version, project-ref, etc.) |

---

## CARPETA src/ (Next.js Frontend + Backend)

`
trademind/src/
`

| Archivo | Descripcion |
|---------|-------------|
| middleware.ts | Middleware de autenticacion Supabase SSR. Protege rutas, maneja redirecciones a login/dashboard |

---

### src/app/ (Rutas de Next.js App Router)

`
trademind/src/app/
`

| Archivo/Carpetas | Descripcion |
|-----------------|-------------|
| avicon.ico | Icono del navegador |
| globals.css | Estilos globales (Tailwind directives, custom properties) |
| layout.tsx | Layout raiz de la aplicacion (providers, fonts, meta tags) |
| page.tsx | Pagina de inicio (landing page) |
| live/page.tsx | Pagina de trading en tiempo real |

#### src/app/(auth)/ — Paginas de autenticacion

| Ruta | Descripcion |
|------|-------------|
| layout.tsx | Layout de autenticacion (fondo, centrado) |
| login/page.tsx | Formulario de login con Supabase Auth |
| 
egister/page.tsx | Formulario de registro con Supabase Auth |
| orgot-password/page.tsx | Formulario de recuperacion de password |

#### src/app/(dashboard)/ — Paginas del dashboard

| Ruta | Descripcion |
|------|-------------|
| layout.tsx | Layout del dashboard (sidebar + header) |
| dashboard/page.tsx | Pagina principal del dashboard (widgets de mercado, signals, portfolio) |
| dmin/page.tsx | Panel de administracion |
| nalysis/page.tsx | Pagina de analisis tecnico de symbols |
| lerts/page.tsx | Pagina de gestion de alertas |
| portfolio/page.tsx | Pagina de portafolio (posiciones, transactions) |
| screener/page.tsx | Pagina de screener de acciones |
| signals/page.tsx | Pagina de señales generadas por el sistema |
| settings/page.tsx | Pagina de configuracion de cuenta |

#### src/app/api/ — API Routes (Backend)

| Ruta | Descripcion |
|------|-------------|
| i/analyze/route.ts | Endpoint de analisis IA. Consulta Yahoo Finance + llama a Gemini/OpenAI para sugerencia de inversion. Fallback a reglas deterministas |
| lerts/check/route.ts | Endpoint para verificar alertas activas contra precios actuales. Marca alerts como triggered |
| market/candles/route.ts | Endpoint OHLCV. Obtiene velas de Yahoo Finance con mapeo de timeframe a interval |
| market/movers/route.ts | Endpoint de market movers (gainers, losers, most active) via Yahoo Finance screener |
| market/quote/route.ts | Endpoint de cotizacion en tiempo real de Yahoo Finance (precio, volumen, P/E, market cap) |
| signals/route.ts | CRUD de señales. GET lista señales del usuario, POST crea nueva senal en Supabase |
| 	rading/route.ts | Endpoint de trading. **(MOCK: genera señales aleatorias, no usar en prod)** |

#### src/app/auth/callback/route.ts

| Archivo | Descripcion |
|---------|-------------|
| 
oute.ts | Maneja el callback de autenticacion de Supabase ( OAuth, email confirmation) |

---

## CARPETA src/components/

`
trademind/src/components/
`

| Archivo | Descripcion |
|---------|-------------|
| providers.tsx | Provider wrapper (Supabase, theme, etc.) para toda la aplicacion |

### src/components/alerts/

| Archivo | Descripcion |
|---------|-------------|
| lerts-client.tsx | Componente cliente de alertas (CRUD, formulario, lista) |

### src/components/analysis/

| Archivo | Descripcion |
|---------|-------------|
| i-advisor.tsx | Componente de asesor IA (muestra sugerencia del endpoint /api/ai/analyze) |
| nalysis-client.tsx | Pagina cliente de analisis (buscador de symbols, chart, resultados) |
| candlestick-chart.tsx | Componente de grafico de velas japonesas (recharts) |
| quote-header.tsx | Cabecera de cotizacion (precio, cambio, rango del dia) |
| symbol-search.tsx | Componente de busqueda de symbols (autocomplete) |
| 	echnical-summary.tsx | Resumen de indicadores tecnicos (RSI, MA, MACD) |
| zesty-workspace.tsx | Componente de workspace Zesty (analisis avanzado) |

### src/components/auth/

| Archivo | Descripcion |
|---------|-------------|
| orgot-password-form.tsx | Formulario de recuperacion de password |
| login-form.tsx | Formulario de login |
| 
egister-form.tsx | Formulario de registro |

### src/components/dashboard/

| Archivo | Descripcion |
|---------|-------------|
| RealtimeChart.tsx | Grafico en tiempo real (integracion con datos de mercado) |
| SignalsPanel.tsx | Panel de señales activas en el dashboard |
| ctive-signals-widget.tsx | Widget de señales activas |
| market-calendar-widget.tsx | Widget de calendario de mercado (horarios, holidays) |
| market-movers-widget.tsx | Widget de market movers (gainers/losers) |
| portfolio-summary-widget.tsx | Widget de resumen de portafolio |
| watchlist-widget.tsx | Widget de watchlist |

### src/components/landing/

| Archivo | Descripcion |
|---------|-------------|
| FeatureGrid.tsx | Grid de funcionalidades de la landing page |
| HeroSection.tsx | Seccion hero de la landing page (titulo, CTA) |
| VisionSection.tsx | Seccion de vision del producto |

### src/components/layout/

| Archivo | Descripcion |
|---------|-------------|
| header.tsx | Header superior (logo, nav, user menu) |
| sidebar.tsx | Sidebar de navegacion lateral (menu de secciones) |

### src/components/market/

| Archivo | Descripcion |
|---------|-------------|
| market-status-badge.tsx | Badge de estado del mercado (abierto/cerrado) |
| market-ticker.tsx | Ticker de mercado (cinta de precios) |

### src/components/portfolio/

| Archivo | Descripcion |
|---------|-------------|
| portfolio-client.tsx | Pagina cliente de portafolio (posiciones, historial, P&L) |

### src/components/screener/

| Archivo | Descripcion |
|---------|-------------|
| screener-client.tsx | Pagina cliente de screener (filtros, tabla de resultados) |

### src/components/signals/

| Archivo | Descripcion |
|---------|-------------|
| signals-client.tsx | Pagina cliente de señales (lista, filtros, detalle) |

### src/components/ui/

| Archivo | Descripcion |
|---------|-------------|
| skeleton-card.tsx | Componente de skeleton loading (placeholder animado) |

---

## CARPETA src/lib/ (Utilidades y clientes)

`
trademind/src/lib/
`

| Archivo | Descripcion |
|---------|-------------|
| chart-ranges.ts | Mapeo de rangos de tiempo a configuraciones de Yahoo Finance |
| indicators.ts | Calculo de indicadores tecnicos (RSI, SMA, EMA, MACD, Bollinger) |
| market-data.ts | Utilidades de datos de mercado |
| market-schedule.ts | Horarios de mercado (apertura, cierre, holidays) |
| supabase-test.ts | Script de prueba de conectividad con Supabase (INSERT/SELECT/DELETE) |
| utils.ts | Utilidades generales (formatters, helpers) |
| yahoo-finance.ts | Wrapper de yahoo-finance2 para datos de mercado |

### src/lib/ai/

| Archivo | Descripcion |
|---------|-------------|
| mcp-client.ts | Cliente MCP (Model Context Protocol). **(PARCIAL/SIN USAR)** |

### src/lib/supabase/

| Archivo | Descripcion |
|---------|-------------|
| client.ts | Cliente Supabase para lado del cliente (browser) |
| server.ts | Clientes Supabase para server-side (createClient + createAdminClient con cookies) |

---

## CARPETA src/store/

| Archivo | Descripcion |
|---------|-------------|
| marketStore.ts | Store global de datos de mercado (Zustand o similar). Estado de precios, symbols, charts |

---

## CARPETA src/types/

| Archivo | Descripcion |
|---------|-------------|
| index.ts | Tipos exportados (re-exports) |
| market.ts | Interfaces de tipos de mercado (Candle, Quote, Signal, Alert, Position, etc.) |

---

## CARPETA quant-engine/ (Microservicio Python)

`
trademind/quant-engine/
`

| Archivo | Descripcion |
|---------|-------------|
| .env | Variables de entorno locales del quant-engine |
| .env.example | Plantilla de variables (QC_USER_ID, QC_API_TOKEN, SUPABASE_URL, etc.) |
| main.py | Servidor FastAPI. Endpoints: MCP tools (get_market_regime, calculate_var, check_graham_filters), ML (extract_features, predict_direction), workflow/analyze |
| 
isk_models.py | Modelos de riesgo: HMM regime detection, GARCH VaR 95%, ARIMA prediction |
| ml_pipeline.py | Pipeline ML: PCA de dimensionalidad, Lasso/Ridge feature selection |
| graham_filters.py | Filtros de Graham: P/E < 15, Debt/Asset < 0.50, Margin of Safety |
| lean_integration.py | Integracion con QuantConnect LEAN. **(PENDIENTE: no ejecuta backtest real)** |
| 
equirements.txt | Dependencias Python (numpy, pandas, yfinance, sklearn, hmmlearn, arch, statsmodels, fastapi, uvicorn, python-dotenv) |
| start.bat | Script de inicio del servidor FastAPI en Windows |
| 	est_hmm.py | Script de prueba para modelos HMM, ARIMA, GARCH |
| 	est_graham.py | Script de prueba para filtros de Graham |

### quant-engine/agents/

| Archivo | Descripcion |
|---------|-------------|
| __init__.py | Init del modulo agents |
| graph.py | Workflow secuencial de analisis: Research Manager (Graham) -> Technical Analyst (HMM+ARIMA) -> Risk Manager (GARCH) -> Decision Node |

---

## CARPETA qc-workspace/ (QuantConnect)

`
trademind/qc-workspace/
`

| Archivo/Carpetas | Descripcion |
|-----------------|-------------|
| lean.json | Configuracion de QuantConnect LEAN |
| TradeMindCRT/ | Algoritmo personalizado TradeMind CRT |
| TradeMindCRT/main.py | Algoritmo QCAlgorithm (SMA 200 + volatilidad como filtro) |
| TradeMindCRT/config.json | Configuracion del algoritmo |
| TradeMindCRT/research.ipynb | Notebook de investigacion del algoritmo |
| data/ | Datos historicos descargados de QuantConnect |
| data/alternative/ | Datos alternativos (interest rates, SEC filings, earnings) |
| data/cfd/ | Datos CFD (XAUUSD, DE30EUR de OANDA) |
| data/crypto/ | Datos de criptomonedas (BTC, ETH, LTC de Coinbase, Binance, etc.) |
| data/cryptofuture/ | Datos de futuros de crypto (Binance, Bybit, dYdX) |
| data/equity/ | Datos de acciones (USA, India) |
| data/forex/ | Datos de forex (EUR/USD, GBP/USD de FXCM, OANDA) |
| data/future/ | Datos de futuros (CME, CBOT, ICE, NYMEX, Eurex) |
| data/futureoption/ | Datos de opciones sobre futuros |
| data/index/ | Datos de indices (S&P 500, N225, NIFTY50) |
| data/indexoption/ | Datos de opciones sobre indices |
| data/market-hours/ | Base de datos de horarios de mercados |
| data/option/ | Datos de opciones de acciones |
| data/symbol-properties/ | Propiedades de symbols (tipos, multipliers) |

---

## CARPETA reports/

| Archivo | Descripcion |
|---------|-------------|
| zesty-symbol-health-smoke.json | Resultados de pruebas de salud de symbols |

---

## CARPETA scripts/

| Archivo | Descripcion |
|---------|-------------|
| udit-zesty-symbols.mjs | Script de auditoria de symbols Zesty |

---

## RESUMEN DE TECNOLOGIAS

| Area | Tecnologia |
|------|-----------|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, recharts |
| **Backend** | Next.js API Routes, FastAPI (Python quant-engine) |
| **Base de datos** | Supabase (PostgreSQL) |
| **Autenticacion** | Supabase Auth (Email, OAuth) |
| **Datos de mercado** | yahoo-finance2 (Yahoo Finance), Alpha Vantage (configurada), Finnhub (configurada) |
| **IA/ML** | Google Gemini, OpenAI GPT, sklearn (PCA, Lasso, Ridge), hmmlearn, arch (GARCH), statsmodels (ARIMA) |
| **Trading algoritmico** | QuantConnect LEAN (algoritmo TradeMindCRT) |
| **Deploy** | Vercel |
| **Indicadores tecnicos** | Implementacion propia (RSI, SMA, EMA, MACD, Bollinger) |
| **Estado global** | marketStore (Zustand o similar) |

---

## FLUJO DE DATOS PRINCIPAL

`
Usuario (Frontend)
    |
    v
[Next.js Pages/Components]
    |
    +---> /api/market/*  ---> yahoo-finance2 (datos de mercado)
    |
    +---> /api/ai/analyze ---> Gemini/OpenAI (analisis IA)
    |                         + yahoo-finance2 (contexto)
    |
    +---> /api/signals   ---> Supabase (CRUD de senales)
    |
    +---> /api/alerts/check ---> Supabase + /api/market/quote
    |
    +---> /api/trading   ---> MOCK (datos aleatorios)
    |
    +---> /api/market/*  ---> Supabase (datos persistentes)

[quant-engine Python]
    |-- HMM regime detection
    |-- ARIMA prediction
    |-- GARCH VaR calculation
    |-- Graham filters
    |-- PCA/Lasso ML pipeline
    |-- QuantConnect LEAN export
`
