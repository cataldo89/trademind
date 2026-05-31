# Quant Jobs

## Objetivo

Desacoplar los calculos pesados del `quant-engine` del ciclo HTTP de Next.js/Vercel. La app debe funcionar hoy con el motor local Ryzen/RTX expuesto por Cloudflare Tunnel, pero el contrato debe permitir migrar el worker a GPU cloud sin cambiar el frontend.

## Alcance

- `POST /api/quant/jobs` encola trabajos.
- `GET /api/quant/jobs` consulta estado y eventos.
- Supabase mantiene `quant_jobs` y `quant_job_events`.
- Workers locales o cloud consumen `claim_next_quant_job` y completan con `complete_quant_job`.

## Sustento arquitectonico

- *Software Architecture: The Hard Parts*, capitulos 11 y 12: workflows distribuidos, ownership de estado y sagas para operaciones que no caben en una transaccion local.
- *Web Scalability for Startup Engineers*, capitulo 7: procesamiento asincrono para descargar trabajo lento del request web.

## Contrato de entrada

```json
{
  "kind": "workflow_analyze",
  "symbol": "AAPL",
  "market": "US",
  "timeframe": "1D",
  "input": {},
  "idempotencyKey": "workflow_analyze:AAPL:US:1D:2026-05-31"
}
```

`kind` valido: `workflow_analyze`, `sentiment_scan`, `backtest`.

## Contrato de salida

`POST /api/quant/jobs` responde `202 Accepted`:

```json
{
  "success": true,
  "deduped": false,
  "job": {
    "id": "uuid",
    "kind": "workflow_analyze",
    "symbol": "AAPL",
    "market": "US",
    "status": "queued",
    "result": null,
    "error_code": null,
    "error_message": null
  }
}
```

## Estados y errores

Estados validos: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `expired`.

La UI no debe interpretar errores internos del worker. Solo debe renderizar `status`, `result`, `error_code` y `error_message` normalizados por el BFF.

## Persistencia/telemetria

- `quant_jobs.status`: estado auditable.
- `quant_jobs.attempts`: reintentos reales.
- `quant_jobs.lease_owner`: worker local/cloud que tomo el trabajo.
- `quant_job_events`: bitacora visual para validar que el proceso existio.

## Criterios de aceptacion

- El dashboard no espera modelos ARIMA/SARIMA/HMM/GARCH dentro de un request largo.
- Un job duplicado por idempotencia devuelve el trabajo existente.
- El worker local y el futuro worker cloud usan las mismas funciones SQL.
- Una falla del worker se registra como `failed`, no como `undefined` en React.

## Pruebas obligatorias

- `npm run test:contracts`
- `npm run typecheck`
- Test futuro de worker: reclamar, completar y fallar un job sin romper idempotencia.
