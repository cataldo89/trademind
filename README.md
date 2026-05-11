# TradeMind SaaS

TradeMind es un SaaS de trading e inversion AI-native enfocado en senales cuantitativas explicables, persistencia auditada y una experiencia anti-FOMO inspirada en principios de Benjamin Graham.

El objetivo operativo es conectar:

```text
Datos reales de mercado -> analisis cuantitativo -> senal explicable -> persistencia -> backtest -> UI
```

## Documentacion maestra

Antes de modificar el proyecto, leer:

| Documento | Uso |
|---|---|
| `AGENTS.md` | Reglas operativas, GitHub oficial, Vercel y orden obligatorio |
| `ANTIGRAVITY_CONTEXT.md` | Fuente canonica para agentes IA |
| `ESTADO_ACTUAL_PROYECTO.md` | Estado tecnico auditado |
| `ESTRUCTURA_PROYECTO.md` | Mapa del repositorio |
| `soluciones_tecnicas.md` | Problemas resueltos y patrones obligatorios |
| `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` | Errores frontend/backend y riesgos de escalamiento SaaS |
| `SEGURIDAD.md` | Secretos, credenciales, service role y pre-push |
| `GEMINI.md` | Roadmap aspiracional |
| `MEMORY.md` | Memoria historica y filosofia |
| `CLAUDE.md` | Wrapper para Claude |

## Stack tecnologico

- Frontend/backend: Next.js 16.2.4 App Router, React 19.2.4, TypeScript.
- UI: Tailwind CSS, Recharts, Lightweight Charts.
- Base de datos y auth: Supabase PostgreSQL, Auth y RLS.
- Datos de mercado: Yahoo Finance mediante `yahoo-finance2`.
- IA narrativa: Gemini/OpenAI si hay claves, con fallback deterministico.
- Quant-engine: Python FastAPI, yfinance, scikit-learn, hmmlearn, arch, statsmodels.
- Backtesting: QuantConnect LEAN en progreso.
- Deploy: Vercel, proyecto oficial `trademind-cv`.

## Estado actual resumido

Consulta `ESTADO_ACTUAL_PROYECTO.md` para detalle. Resumen al 2026-05-10:

- `npm run typecheck` pasa.
- `npm run lint` pasa sin errores bloqueantes; quedan warnings no criticos de imports/variables sin uso.
- `/api/trading` llama a quant-engine, normaliza `market` a `US`/`CL` y devuelve `persisted: true` solo con insert confirmado.
- `supabase/migrations/000_initial_schema.sql` consolida schema, RLS, policies y RPCs financieras.
- Las operaciones financieras virtuales pasan por RPCs transaccionales (`execute_virtual_trade`, `close_virtual_position`).
- Market data usa batching en pantallas principales, cache server-side y rate limit basico en APIs.
- Quant-engine se consume por HTTP con `QUANT_ENGINE_URL` + `QUANT_ENGINE_SECRET`; en produccion no cae a localhost y el FastAPI incluye cache TTL.
- QuantConnect LEAN existe en estructura, pero el backtest end-to-end aun no esta validado.

Para errores donde el frontend parece fallar por backend, leer:

```text
docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
```

## Ejecucion local

### 1. Instalar dependencias frontend

```bash
npm install
```

### 2. Iniciar Next.js

```bash
npm run dev
```

La app queda en:

```text
http://localhost:3000
```

### 3. Iniciar quant-engine

```bash
cd quant-engine
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

La API cuantitativa queda en:

```text
http://localhost:8000
```

## Validacion local

```bash
npm run typecheck
npm run lint
npm run build
```

Estado conocido:

```text
npm run typecheck -> pasa
npm run lint -> pasa con warnings no bloqueantes
npm run test:contracts -> pasa
```

## Supabase y migraciones

Para un entorno nuevo, aplicar las migraciones versionadas del repo con Supabase CLI:

```bash
supabase db reset
```

La migracion inicial `supabase/migrations/000_initial_schema.sql` crea tablas, indices, RLS, policies idempotentes y RPCs financieras. `supabase/schema.sql` se mantiene como snapshot aplicable equivalente.

Si aplicas contra una base remota, usa el flujo oficial de Supabase CLI para linkear el proyecto y ejecutar/pushear migraciones. No edites manualmente tablas en Dashboard sin reflejar el cambio en `supabase/migrations/`.

## Variables de entorno

Crear `.env.local` desde `.env.example`. No subir `.env.local` a GitHub.

Variables principales de Next/Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=secreto_para_vercel_cron

GEMINI_API_KEY=tu_gemini_key
OPENAI_API_KEY=tu_openai_key
OPENAI_MODEL=gpt-4o-mini
GEMINI_MODEL=gemini-2.5-flash

QUANT_ENGINE_URL=http://127.0.0.1:8000
QUANT_ENGINE_SECRET=tu_secreto_interno
QUANT_ENGINE_CACHE_TTL_SECONDS=300
QUANT_ENGINE_AUTH_DISABLED=false
```

Variables de scripts/mantenimiento:

```env
DATABASE_URL=replace-with-postgres-connection-string
SUPABASE_PROJECT_REF=tu_project_ref
SUPABASE_ACCESS_TOKEN=replace-with-supabase-access-token
SUPABASE_URL=tu_supabase_url
SUPABASE_ANON_KEY=tu_supabase_anon_key
```

Variables de quant-engine:

```env
QC_USER_ID=tu_quantconnect_user_id
QC_API_TOKEN=replace-with-quantconnect-api-token
QUANT_ENGINE_SECRET=tu_secreto_interno
QUANT_ENGINE_CACHE_TTL_SECONDS=300
QUANT_ENGINE_AUTH_DISABLED=false
QUANT_ENGINE_ALLOWED_ORIGINS=http://localhost:3000,https://trademind-cv.vercel.app
```

## Seguridad

- Nunca subir `.env.local`, `.env.production`, tokens, service role o connection strings reales.
- Antes de push, revisar `SEGURIDAD.md`.
- Repositorio oficial: `https://github.com/cataldo89/trademind.git`.
- No usar ni referenciar el duplicado `cataldo89/trademind-push`.
