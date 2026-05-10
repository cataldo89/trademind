# Soluciones Tecnicas y Conocimientos Adquiridos - TradeMind

Este documento centraliza problemas tecnicos complejos encontrados durante el desarrollo y sus soluciones o patrones obligatorios. Para brechas actuales no resueltas, leer tambien `ESTADO_ACTUAL_PROYECTO.md` y `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`.

## 0. Lectura previa obligatoria

Antes de modificar auth, Supabase, Vercel, Route Handlers, service role, deploy o rutas que conecten frontend/backend, leer:

1. `AGENTS.md`
2. `ANTIGRAVITY_CONTEXT.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`
5. `SEGURIDAD.md`

## 1. Problema de autenticacion en produccion (Vercel + Next.js App Router + Supabase SSR)

### Sintoma

Un usuario inicia sesion correctamente y se crean cookies `sb-*-auth-token` en el navegador. El `middleware.ts` valida el token y permite entrar a rutas protegidas como `/dashboard`. Sin embargo, cuando un Client Component hace `fetch` a una API interna como `POST /api/signals`, el servidor devuelve `401 Unauthorized` porque el objeto `user` llega nulo o `supabase.auth.getUser()` falla dentro del Route Handler.

Esto ocurre especialmente en Vercel y puede no reproducirse en desarrollo local.

### Causa raiz

Existen interacciones fragiles entre Next.js App Router, Vercel, middleware, cookies particionadas de Supabase y `@supabase/ssr`. Si el middleware refresca sesion o Vercel fragmenta cookies, el Route Handler puede no reconstruir bien la sesion desde `cookies().getAll()`, generando errores tipo `Auth session missing`.

### Solucion implementada

Se implemento un mecanismo de doble validacion con fallback por header JWT.

En el cliente:

```typescript
const { createClient } = await import('@/lib/supabase/client')
const supabaseClient = createClient()
const { data: { session } } = await supabaseClient.auth.getSession()
const token = session?.access_token

const res = await fetch('/api/signals', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
})
```

En el servidor:

```typescript
const userClient = await createClient()
let user = null
let userError = null

const authHeader = request.headers.get('Authorization')
const token = authHeader?.replace('Bearer ', '')

if (token) {
  const { data, error } = await userClient.auth.getUser(token)
  user = data?.user
  userError = error
}

if (!user) {
  const { data, error } = await userClient.auth.getUser()
  user = data?.user
  userError = error
}
```

### Leccion para IAs

Cuando edites APIs Next.js con `@supabase/ssr`, no confies solo en cookies. Mantener el header `Authorization: Bearer` como fallback evita deslogueos fantasma en Vercel.

No revertir este patron sin prueba en Vercel y evidencia de que auth sigue funcionando.

## 2. Problema detectado de escalamiento frontend/backend pendiente de solucion

### Sintoma esperado

El frontend puede mostrar que una senal de trading se genero correctamente, pero la senal no aparece despues en la pantalla `/signals` ni queda persistida en Supabase.

### Causa raiz detectada

`src/app/api/trading/route.ts` intenta insertar en `signals` con:

```typescript
market: 'EQUITY'
```

pero `supabase/schema.sql` define:

```sql
market TEXT NOT NULL CHECK (market IN ('US', 'CL'))
```

Ademas, el error de insert se captura y no cambia la respuesta final, por lo que `/api/trading` puede devolver `success: true` aunque la persistencia haya fallado.

### Estado

No resuelto en codigo durante esta actualizacion documental. Queda registrado como P0 en:

```text
docs/runbooks/problemas-escalamiento-errores-frontend-backend.md
```

### Accion recomendada

- Normalizar `market` a `US` o `CL` antes de insertar.
- Devolver `persisted: false` o `success: false` si Supabase rechaza la persistencia.
- Agregar test de integracion que confirme que una senal generada aparece luego en `/api/signals`.

## 3. Operaciones financieras virtuales deben ser atomicas

### Problema

Compras simuladas desde `signals-client.tsx`, `technical-summary.tsx` y `portfolio-client.tsx` ejecutan multiples writes desde cliente. Este patron no escala porque puede dejar balance, posiciones y transacciones inconsistentes.

### Regla obligatoria futura

Toda operacion financiera simulada debe moverse a una API route o RPC Supabase atomica.

Contrato recomendado:

```text
Frontend envia intencion de orden
Backend valida usuario, saldo y precio
Transaccion atomica:
  insertar position
  insertar transaction
  actualizar profiles.virtual_balance
  actualizar signal opcional
Backend devuelve newBalance y IDs creados
```

## 4. Alertas y cron deben tener contrato seguro

### Problema

`/api/alerts/check` no valida `CRON_SECRET`, usa cliente dependiente de cookies y hace N requests de quote.

### Regla obligatoria futura

- Proteger con `CRON_SECRET`.
- Usar service role solo dentro de ruta protegida.
- Paginar alertas.
- Batch de simbolos para quotes.
- Registrar metricas de ejecucion.

## 5. Mapa de documentos relacionados

| Tema | Documento principal |
|---|---|
| Reglas operativas y deploy | `AGENTS.md` |
| Realidad tecnica actual | `ESTADO_ACTUAL_PROYECTO.md` |
| Separacion vision/realidad | `ANTIGRAVITY_CONTEXT.md` |
| Errores frontend/backend y escalamiento | `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` |
| Seguridad y secretos | `SEGURIDAD.md` |
| Vision futura | `GEMINI.md` |
| Memoria historica | `MEMORY.md` |