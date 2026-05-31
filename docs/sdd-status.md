# TradeMind - Estado SDD

Fecha: 2026-05-31

## Diagnostico

TradeMind esta parcialmente alineado con SDD (Spec-Driven Development), pero no usa todavia una estructura SDD formal completa.

Evidencia de alineacion:

- `docs/contracts.md` define contratos de datos para senales, ordenes, alertas, quotes y quant-engine.
- `LLM_CONTEXT.md` actua como fuente canonica para agentes y separa vision, realidad tecnica y brechas.
- `ESTADO_ACTUAL_PROYECTO.md` registra estado tecnico verificable.
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` documenta incidentes, causas raiz y criterios de cierre.
- `tests/integration/*.test.mjs` valida contratos criticos.

Normalizacion aplicada el 2026-05-31:

- Se creo `specs/README.md` como indice SDD.
- Se creo `specs/quant-jobs.md` para el desacoplamiento local -> cloud del `quant-engine`.
- Se creo `specs/market-data-cache.md` para cache durable de Yahoo/series temporales.
- Se creo `specs/bff-frontend-contracts.md` para blindar React contra fallas de backend.

Brecha SDD vigente:

- Faltan specs por dominio para `virtual-trading`, `alerts-cron`, `screener-ranking` y `lean-backtests`.
- Falta generar tipos compartidos desde OpenAPI/Supabase de forma rutinaria en CI.
- Algunas decisiones historicas siguen en runbooks y deben migrarse gradualmente si vuelven a tocarse.

## Regla desde ahora

Los cambios funcionales deben partir de un contrato o spec breve antes de implementarse. Si el cambio toca APIs, Supabase, quant-engine, trading, portfolio o alertas, actualizar al menos uno de estos documentos:

- `docs/contracts.md`
- `ESTADO_ACTUAL_PROYECTO.md`
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
- un archivo bajo `specs/`

## Proxima normalizacion recomendada

Completar `specs/` con esta estructura:

```text
specs/
  virtual-trading.md
  alerts-cron.md
  screener-ranking.md
  lean-backtests.md
```

Cada spec debe incluir:

- objetivo
- alcance
- contrato de entrada/salida
- errores esperados
- criterios de aceptacion
- pruebas obligatorias
