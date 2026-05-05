# TradeMind SaaS

TradeMind es un SaaS de trading e inversión AI-Native enfocado en proveer señales cuantitativas explicables con protección algorítmica, inspirándose en los principios de inversión de Benjamin Graham. 

El objetivo es conectar el análisis financiero tradicional con capacidades modernas de machine learning y LLMs (Model Context Protocol), integrando todo bajo una arquitectura web de alto rendimiento.


## Stack Tecnológico

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, Recharts.
- **Backend UI:** Next.js API Routes.
- **Base de Datos & Auth:** Supabase (PostgreSQL, Auth, RLS).
- **Quant-Engine (Microservicio):** Python, FastAPI, yfinance, scikit-learn, hmmlearn, arch, statsmodels.
- **Backtesting:** QuantConnect LEAN (en progreso).
- **Despliegue:** Vercel.
- **IA:** Google Gemini 2.5 (análisis natural).

## Estado Actual
*(Para más detalles, consulta `ESTADO_ACTUAL_PROYECTO.md`)*

El proyecto tiene implementados varios modelos de riesgo (HMM, GARCH, PCA) y un backend de usuario funcional en Next.js. Sin embargo, **existen brechas críticas** en la integración final:
- `/api/trading` está actualmente operando como un **MOCK** (usa datos aleatorios).
- La conexión con QuantConnect LEAN está **PENDIENTE** (`run_lean_backtest()` no ejecuta).
- El cliente MCP existe pero no está totalmente integrado.
- Algunas API Routes en Edge Runtime representan un **RIESGO** de compatibilidad con Supabase SSR.

Para el contexto completo para IAs, por favor leer `ANTIGRAVITY_CONTEXT.md` y `AGENTS.md`.

## Ejecución Local

### 1. Iniciar el Frontend (Next.js)

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev
```
La aplicación estará disponible en `http://localhost:3000`.

### 2. Iniciar el Quant-Engine (Python)

```bash
cd quant-engine

# Crear entorno virtual e instalar dependencias
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
pip install -r requirements.txt

# Iniciar servidor FastAPI
./start.bat # En Windows
# O manualmente: uvicorn main:app --reload --port 8000
```
La API cuantitativa estará en `http://localhost:8000`.

## Variables de Entorno Requeridas

Debes crear un archivo `.env.local` en la raíz del proyecto (basado en `.env.example`):

```env
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key

# Opcionales / Recomendados para IA y Datos
GEMINI_API_KEY=tu_gemini_key
ALPHA_VANTAGE_API_KEY=tu_alpha_vantage_key
```

Adicionalmente en `quant-engine/.env`:
```env
QC_USER_ID=tu_quantconnect_user_id
QC_API_TOKEN=tu_quantconnect_api_token
QUANT_ENGINE_SECRET=tu_secreto_interno
QUANT_ENGINE_AUTH_DISABLED=false
QUANT_ENGINE_ALLOWED_ORIGINS=http://localhost:3000,https://trademind-cv.vercel.app
```

> **NOTA SOBRE SEGURIDAD:** En producción, si `QUANT_ENGINE_SECRET` no está configurado, la aplicación fallará explícitamente. Para entornos locales, puedes saltar la seguridad usando `QUANT_ENGINE_AUTH_DISABLED=true`.
