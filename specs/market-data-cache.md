# Market Data Cache

## Objetivo

Reducir llamadas repetidas a Yahoo Finance y evitar que usuarios concurrentes, screener, dashboard y quant-engine saturen proveedores externos o Supabase. La cache debe servir al modo local actual y quedar lista para sustituirse por Redis/servicio administrado en nube.

## Alcance

- `src/app/api/market/candles/route.ts`.
- `src/lib/api/memory-cache.ts` como cache caliente por proceso.
- `src/lib/api/market-data-cache.ts` como cache durable en Supabase.
- Tabla `market_data_cache`.

## Sustento arquitectonico

- *Web Scalability for Startup Engineers*, capitulo 6: cache para escalar lecturas y evitar recomputacion.
- *Web Scalability for Startup Engineers*, capitulo 5: proteger la capa de datos evitando fan-out y consultas repetidas.

## Contrato de entrada

Clave durable:

```text
symbol + market + range + provider
```

Ejemplos:

```text
AAPL + US + range:1D + yahoo-chart
AAPL + US + timeframe:1d + yahoo-chart
```

## Contrato de salida

El endpoint publico conserva el shape existente:

```json
{
  "data": [
    { "time": 1710000000, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1200000 }
  ]
}
```

Para rangos visuales conserva:

```json
{
  "data": [],
  "range": "1D",
  "requestedRange": "1D",
  "interval": "1m",
  "fallback": false
}
```

## Estados y errores

- Si Supabase cache no esta configurado, la ruta sigue funcionando con cache en memoria.
- Si Yahoo falla y existe payload stale, se devuelve stale como degradacion controlada.
- Si Yahoo falla y no existe stale, la API responde error estable `Failed to fetch candles`.

## Persistencia/telemetria

`market_data_cache.fetched_at`, `expires_at`, `provider` y `source_etag` permiten auditar si una serie vino de proveedor, cache fresca o fallback stale.

## Criterios de aceptacion

- La UI no cambia contrato.
- Las lecturas repetidas de candles consultan memoria primero y Supabase durable despues.
- La migracion a Redis/cloud cache no cambia el contrato del endpoint.
- No se introduce ningun secreto en cliente.

## Pruebas obligatorias

- `npm run test:contracts`
- `npm run typecheck`
- Prueba futura con Supabase local: write/read/expire/stale.
