# BFF Frontend Contracts

## Objetivo

Blindar los componentes React contra cambios, timeouts o fallas del `quant-engine`. El BFF de Next.js debe traducir detalles internos a contratos pequenos, estables y renderizables.

## Alcance

- API routes bajo `src/app/api`.
- Componentes dashboard/screener/analysis que consumen respuestas cuantitativas.
- Contratos compartidos en `docs/contracts.md`.

## Sustento arquitectonico

- *Building Micro-Frontends*, seccion del patron BFF: un backend orientado a la experiencia reduce acoplamiento entre cliente y servicios internos.
- *Building Micro-Frontends*, capitulos de comunicacion/composicion: los limites del frontend se prueban por contrato, no por detalles de implementacion.

## Contrato de salida minimo para procesos largos

```json
{
  "success": true,
  "job": {
    "id": "uuid",
    "status": "queued",
    "result": null,
    "error_code": null,
    "error_message": null
  },
  "events": []
}
```

## Estados y errores

El cliente solo puede depender de:

- `success`
- `status`
- `result`
- `error_code`
- `error_message`
- `events[].message`

El BFF no debe exponer stack traces, errores de libreria, URLs efimeras de Cloudflare ni detalles de credenciales.

### Sentimiento FinBERT

`POST /api/quant/sentiment` distingue tres estados:

- `applied: true`: sentimiento nuevo aplicado o cache fresco confirmado por quant-engine.
- `applied: false` + `staleCacheIgnored: true`: `Error de conexion con el motor`; el frontend muestra error y no recalcula como si hubiera sentimiento vigente.
- `degraded: true` con `processed > 0`: lote parcial; el frontend muestra warning.

La UI no debe convertir `Quant engine request failed` en un estado exitoso ni usar cache obsoleto para tranquilizar al asesor.

El MVP de sentimiento multi-fuente usa `POST /quant/sentiment/update` en FastAPI. El BFF no expone claves de Finnhub/Marketaux; solo devuelve estado de actualizacion y lee features desde `news_sentiment` mediante `/api/quant/sentiment/features`.

### Screener IPO reciente

Cuando `/api/quant/scan` retorna `recent_ipo_fallback=true`, el frontend debe renderizarlo como analisis parcial valido, no como `PENDIENTE` ni `HOLD` por falta de datos. Los campos esperados son `indicatorMode='recent_ipo_short_history'` y `historyCandles`.

### Senales

Las pantallas de senales consumen `/api/signals`. La ruta BFF consulta `public.signals` por `user_id`, ordena por `created_at` y no aplica filtros ocultos de `expires_at` ni status. El frontend puede agrupar o mostrar `status === 'active'`, pero no debe reemplazar el contrato con queries Supabase paralelas.

## Estrategia de actualizacion UI

Fase 0:

- Polling optimizado cada 3 a 5 segundos sobre `GET /api/quant/jobs?id=...`.
- Reusar `quant_job_events` para mensajes de progreso.
- Evitar spinners infinitos: si `status` queda `running` mas alla del lease esperado, mostrar estado degradado.

Fase 1:

- Supabase Realtime sobre `quant_jobs` y `quant_job_events`, o SSE desde el BFF si se necesita gateway propio.
- El shape de datos no cambia.

## Criterios de aceptacion

- Ningun componente cliente accede a propiedades anidadas sin fallback.
- Las fallas del quant-engine terminan en `failed` o `partial`, nunca en excepciones de render.
- El usuario puede ver si un job esta pendiente, corriendo, terminado o fallado.

## Pruebas obligatorias

- `npm run test:contracts`
- `npm run typecheck`
- Test futuro de UI: respuesta `failed` renderiza mensaje y no rompe dashboard.
