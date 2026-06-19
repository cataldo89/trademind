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

- Para rutas, URLs, puertos, repo oficial, Vercel y Cloudflare, la unica fuente canonica es `LLM_CONTEXT.md` seccion `0.0 Rutas y direcciones canonicas`.
- El quant-engine funciona localmente en `http://127.0.0.1:8000` y se expone a Vercel por Cloudflare Tunnel.
- Arranque recomendado: `npm run quant:start` para local; `npm run quant:start:vercel` para actualizar Vercel y desplegar.
- Mientras no exista tunel nombrado de Cloudflare, `trycloudflare.com` puede cambiar al reiniciar.
- No copiar una URL concreta de `trycloudflare.com` a archivos de memoria; solo usar `QUANT_ENGINE_URL` como variable canonica.
- El motor Python no debe depender solo de `yfinance`; usa Yahoo Chart API para velas en modelos HMM/GARCH/ARIMA.
- El proyecto esta parcialmente alineado con SDD, pero necesita carpeta formal `specs/` para completar la disciplina.

## 9. Memoria operativa 2026-06-02 (Caché en Supabase y Nueva Política GRANT)

- **Falla Crítica Descubierta y Resuelta:** El escáner (Screener) en Producción sufría tiempos de carga inaceptables (varios minutos) al cambiar de menú porque la tabla `market_data_cache` no existía en Supabase (la migración 002 no había sido aplicada). Esto forzaba a Next.js a recalcular el 100% de los activos desde Yahoo Finance y fallar silenciosamente en los writes a la BD en cada recarga de pantalla. Al aplicar el SQL de creación de tabla manualmente en producción, el rendimiento volvió a ser óptimo.
- **Cambio de Arquitectura Supabase (Mayo 2026):** Se comprobó en Producción que las nuevas tablas creadas en el esquema `public` ya no están expuestas por defecto a la Data API (PostgREST/supabase-js). Toda nueva tabla creada REQUIERE ejecutar explícitamente `GRANT ALL PRIVILEGES ON TABLE public.<nombre> TO service_role, anon, authenticated;`. Si se omite, la aplicación (incluyendo Next.js) sufrirá fallos silenciosos por permisos denegados.
- **Optimización de Caché de Memoria (Junio 2026):** Se refactorizó la lógica en `src/app/api/quant/scan/route.ts` para usar llaves de caché de memoria individuales (por símbolo) en lugar de una única llave por lote de categoría (`scan:quotes:...` y `scan:candles:...`). Esto previene que al cambiar de categoría se invalide todo el caché, reutilizando instantáneamente los datos de símbolos comunes ya consultados y solucionando un bug donde `candlesMap` quedaba vacío tras un hit de caché de lote.

## 10. Memoria operativa 2026-06-16 (Asesor Financiero y Navegación del Screener)

- **Mejora de UX en Screener (ML Cards):** Las tarjetas del ranking rápido (Machine Learning/LightGBM) ahora son completamente clicables (`Link` de Next.js) y enlazan al `/analysis` preservando el estado transaccional (símbolo, score, acción sugerida y justificaciones traducidas de la señal). Esto soluciona la desconexión entre el screening predictivo y la visualización detallada del activo.
- **Simplificación del Lenguaje de la IA:** El Asesor Financiero (Gemini/OpenAI) se reconfiguró para no abrumar al inversor retail con siglas técnicas como 'RSI', 'MACD', 'FinBERT' o scores abstractos ('decisión 35'). El prompt ahora exige traducir los hallazgos a español natural ('mercado estable', 'sentimiento de noticias positivo', 'acumulación progresiva').
- **Robustez de Fallback en Análisis de IA:** Si un activo no posee historial suficiente de velas (por ejemplo, IPOs recientes), el Asesor de IA ya no asume un HOLD estático por error técnico, sino que utiliza el workflow del quant-engine como fuente principal de verdad de la señal técnica.

