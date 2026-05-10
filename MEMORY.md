# TradeMind: Memoria Historica e Inspiracion Titanes

> ADVERTENCIA: este archivo representa memoria historica, filosofia de diseno y vision de producto. No es la fuente canonica del estado actual del codigo. Para realidad tecnica leer `ANTIGRAVITY_CONTEXT.md` y `ESTADO_ACTUAL_PROYECTO.md`. Para errores frontend/backend y escalamiento leer `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`.

## 1. Rol de este archivo

`MEMORY.md` conserva la identidad del producto y las decisiones historicas que explican por que TradeMind existe.

No usar este archivo para afirmar que una integracion esta implementada, probada o desplegada. La evidencia tecnica vive en:

- `ANTIGRAVITY_CONTEXT.md`
- `ESTADO_ACTUAL_PROYECTO.md`
- `ESTRUCTURA_PROYECTO.md`
- `soluciones_tecnicas.md`
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
- `SEGURIDAD.md`

## 2. Filosofia: Titanes + Pragmatismo

TradeMind se inspira en tres pilares:

1. Estetica y experiencia: democratizar herramientas de trading institucional con una UI premium, oscura, clara y disciplinada.
2. Escalabilidad y dominio: debajo de la interfaz debe existir un sistema robusto, tipado, auditable y preparado para volumen.
3. Pragmatismo moderno: preferir soluciones comprobables, modulares y mantenibles por sobre arquitectura aspiracional no validada.

## 3. Vision de producto

TradeMind busca convertirse en un SaaS de trading/inversion que conecte:

```text
Datos reales de mercado
-> analisis cuantitativo
-> senales explicables
-> persistencia Supabase
-> simulacion/backtest
-> validacion
-> UI anti-FOMO
```

La experiencia debe ayudar a tomar mejores decisiones, no incentivar impulsividad.

## 4. Estado narrativo actual

La base actual contiene:

- Frontend Next.js con dashboard, analisis, alertas, senales, portfolio y landing.
- Supabase para autenticacion, perfiles, senales, posiciones, transacciones y alertas.
- Yahoo Finance como integracion real principal de datos de mercado.
- Endpoint `/api/ai/analyze` con Gemini/OpenAI si hay claves y fallback deterministico.
- Quant-engine Python con modelos iniciales HMM, GARCH, ARIMA, Graham y PCA/Lasso.
- Estructura QuantConnect LEAN presente, pero no validada end-to-end.

Tambien existen brechas criticas documentadas:

- `/api/trading` puede devolver exito aunque no persista senales por desalineacion `market`.
- Supabase schema/migraciones requieren normalizacion.
- Compras virtuales no son atomicas.
- Market data necesita batching, cache y rate limits.
- `npm run lint` falla.

## 5. Arquitectura Zesty

La categorizacion de simbolos ocurre principalmente en `src/lib/market-data.ts`, alimentando el flujo Zesty en componentes de analisis.

`ZestyWorkspace` agrupa activos por categorias de inversion y funciona como espacio principal de exploracion de simbolos.

## 6. Directivas para agentes IA

- Si editas UI, mantener la calidad visual, modo oscuro, claridad de informacion y disciplina anti-FOMO.
- Si editas backend, verificar contratos con Supabase y no esconder errores de persistencia.
- Si editas datos de mercado, evitar fan-out y preferir batch/cache.
- Si editas trading o senales, leer primero el runbook de escalamiento.
- Si editas seguridad, secretos, scripts o deploy, leer `SEGURIDAD.md`.
- Si una idea viene de `GEMINI.md`, tratarla como vision hasta verificar implementacion real.

## 7. Documentos relacionados

| Necesidad | Leer |
|---|---|
| Reglas operativas | `AGENTS.md` |
| Realidad canonica | `ANTIGRAVITY_CONTEXT.md` |
| Estado tecnico | `ESTADO_ACTUAL_PROYECTO.md` |
| Mapa de archivos | `ESTRUCTURA_PROYECTO.md` |
| Problemas resueltos | `soluciones_tecnicas.md` |
| Escalamiento frontend/backend | `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` |
| Seguridad | `SEGURIDAD.md` |
| Roadmap aspiracional | `GEMINI.md` |