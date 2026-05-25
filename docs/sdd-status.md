# TradeMind - Estado SDD

Fecha: 2026-05-25

## Diagnostico

TradeMind esta parcialmente alineado con SDD (Spec-Driven Development), pero no usa todavia una estructura SDD formal completa.

Evidencia de alineacion:

- `docs/contracts.md` define contratos de datos para senales, ordenes, alertas, quotes y quant-engine.
- `LLM_CONTEXT.md` actua como fuente canonica para agentes y separa vision, realidad tecnica y brechas.
- `ESTADO_ACTUAL_PROYECTO.md` registra estado tecnico verificable.
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` documenta incidentes, causas raiz y criterios de cierre.
- `tests/integration/*.test.mjs` valida contratos criticos.

Brecha contra SDD formal:

- No existe una carpeta `specs/` versionada por feature.
- No hay plantilla estandar de especificacion con problema, contrato, flujo, criterios de aceptacion y pruebas.
- Algunas decisiones viven en memoria/runbooks en vez de specs por dominio.

## Regla desde ahora

Los cambios funcionales deben partir de un contrato o spec breve antes de implementarse. Si el cambio toca APIs, Supabase, quant-engine, trading, portfolio o alertas, actualizar al menos uno de estos documentos:

- `docs/contracts.md`
- `ESTADO_ACTUAL_PROYECTO.md`
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
- un futuro archivo bajo `specs/`

## Proxima normalizacion recomendada

Crear `specs/` con esta estructura:

```text
specs/
  quant-engine-cloudflare.md
  screener-ranking.md
  virtual-trading.md
  alerts-cron.md
```

Cada spec debe incluir:

- objetivo
- alcance
- contrato de entrada/salida
- errores esperados
- criterios de aceptacion
- pruebas obligatorias
