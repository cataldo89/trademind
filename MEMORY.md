# TradeMind: Memoria Historica e Inspiracion Titanes

> ADVERTENCIA: este archivo representa memoria historica, filosofia de diseno y vision de producto. No es la fuente canonica del estado actual del codigo. Para realidad tecnica leer `LLM_CONTEXT.md` y `ESTADO_ACTUAL_PROYECTO.md`. Para errores frontend/backend y escalamiento leer `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`.

## 1. Rol de este archivo

`MEMORY.md` conserva la identidad del producto y las decisiones historicas que explican por que TradeMind existe.

No usar este archivo para afirmar que una integracion esta implementada, probada o desplegada. La evidencia tecnica vive en:

- `LLM_CONTEXT.md`
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
- Endpoint `/api/ai/analyze` con proveedores LLM configurados si hay claves y fallback deterministico.
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
- Si una idea viene de `LLM.md`, tratarla como vision hasta verificar implementacion real.

## 7. Documentos relacionados

| Necesidad | Leer |
|---|---|
| Reglas operativas | `AGENTS.md` |
| Realidad canonica | `LLM_CONTEXT.md` |
| Estado tecnico | `ESTADO_ACTUAL_PROYECTO.md` |
| Mapa de archivos | `ESTRUCTURA_PROYECTO.md` |
| Problemas resueltos | `soluciones_tecnicas.md` |
| Escalamiento frontend/backend | `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` |
| Seguridad | `SEGURIDAD.md` |
| Roadmap aspiracional | `LLM.md` |

## 8. Memoria operativa 2026-05-25

- El quant-engine funciona localmente en `http://127.0.0.1:8000` y se expone a Vercel por Cloudflare Tunnel.
- Arranque recomendado: `npm run quant:start` para local; `npm run quant:start:vercel` para actualizar Vercel y desplegar.
- Mientras no exista tunel nombrado de Cloudflare, `trycloudflare.com` puede cambiar al reiniciar.
- El motor Python no debe depender solo de `yfinance`; usa Yahoo Chart API para velas en modelos HMM/GARCH/ARIMA.
- El proyecto esta parcialmente alineado con SDD, pero necesita carpeta formal `specs/` para completar la disciplina.
