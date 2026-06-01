# TradeMind Specs

Estado: estructura SDD viva desde 2026-05-31.

Cada cambio que toque API routes, Supabase, quant-engine, trading, portfolio, alertas, datos de mercado o contratos de UI debe actualizar una spec antes o junto con el codigo.

## Specs activas

| Spec | Dominio | Estado |
|---|---|---|
| `quant-jobs.md` | Jobs asincronos y migracion local -> nube | Activa |
| `market-data-cache.md` | Cache durable de Yahoo/series temporales | Activa |
| `market-data-quality.md` | Skill transversal de calidad OHLCV y guardrails ML/backtest | Activa |
| `bff-frontend-contracts.md` | Contratos BFF para evitar fallas en cliente | Activa |

## Plantilla minima

```text
# Nombre

## Objetivo
## Alcance
## Contrato de entrada
## Contrato de salida
## Estados y errores
## Persistencia/telemetria
## Criterios de aceptacion
## Pruebas obligatorias
```
