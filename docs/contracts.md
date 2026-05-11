# TradeMind - Contratos de datos

## Senales

- `market` valido: `US` o `CL`.
- `EQUITY` solo se acepta como alias legado y se normaliza a `US`.
- `type` valido: `BUY`, `SELL`, `HOLD`.
- `/api/trading` devuelve `persisted: true` solo si Supabase confirma el insert en `signals`.
- Si la persistencia falla, `/api/trading` devuelve `success: false`, `persisted: false` y status HTTP no exitoso.

## Orden virtual

Frontend envia una intencion, no escribe contabilidad directamente:

```json
{
  "side": "BUY",
  "symbol": "AAPL",
  "market": "US",
  "amount": 100,
  "price": 200,
  "source": "signal",
  "signalId": "uuid-opcional"
}
```

Backend llama RPC `execute_virtual_trade`, que bloquea el perfil del usuario, valida saldo, inserta posicion, descuenta balance, inserta transaccion y cancela la senal si corresponde.

## Cierre de posicion

`POST /api/portfolio/positions/:id/close` recibe precio de cierre. Backend llama RPC `close_virtual_position`, bloquea posicion/perfil, marca posicion cerrada, reintegra proceeds al balance e inserta transaccion `SELL`.

## Quotes

- Clientes deben agrupar simbolos unicos por pantalla.
- Endpoint: `/api/market/quote?symbols=AAPL,MSFT,NVDA&market=US`.
- Limite actual: 50 simbolos por request.
- Respuesta: objeto para un simbolo, array para multiples simbolos.
- API aplica cache server-side corta y rate limit por IP.

## Alertas

- `POST /api/alerts/check` es solo para cron autorizado.
- Requiere `Authorization: Bearer $CRON_SECRET` o header `x-cron-secret`.
- Usa service role solo despues de validar el secreto.
- Agrupa quotes por mercado/simbolo y devuelve metricas: `checked`, `triggered`, `failed`, `durationMs`.

## Quant-engine

- Next.js no ejecuta ML pesado dentro de Vercel.
- Next.js llama FastAPI externo/local via `QUANT_ENGINE_URL`.
- Header interno: `X-TradeMind-Quant-Secret`.
- En produccion faltas de `QUANT_ENGINE_URL` o `QUANT_ENGINE_SECRET` son errores de configuracion explicitos.
- FastAPI mantiene cache TTL por simbolo/endpoint con `QUANT_ENGINE_CACHE_TTL_SECONDS`.