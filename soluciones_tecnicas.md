# Soluciones Técnicas y Conocimientos Adquiridos (TradeMind)

Este documento centraliza los problemas técnicos complejos encontrados durante el desarrollo y sus respectivas soluciones, sirviendo como base de conocimiento para futuras interacciones y agentes de IA que trabajen en este repositorio.

## 1. Problema de Autenticación en Producción (Vercel + Next.js App Router + Supabase SSR)

### Síntoma
Un usuario inicia sesión correctamente (se crean las cookies `sb-*-auth-token` en el navegador) y el `middleware.ts` valida el token con éxito (permitiendo el acceso a rutas protegidas como `/dashboard`). Sin embargo, cuando el cliente (ej. `TechnicalSummary.tsx`) hace una petición `fetch('POST', '/api/signals')`, el servidor devuelve un error `401 Unauthorized` porque el objeto `user` aparece como nulo o da error en la ruta API. Esto ocurre únicamente al desplegar en **Vercel** (modo live), no en modo de desarrollo local.

### Causa Raíz
Existen interacciones complejas y a veces impredecibles entre el ruteo de Next.js en Vercel, la manipulación de cabeceras en el `middleware.ts` y la lectura del `CookieStore` dentro de las **Route Handlers** (Rutas de API).
Si el `middleware.ts` llega a manipular, interceptar o refrescar la sesión, o si Vercel fragmenta el paso de las cookies por la capa Edge, la función `cookies().getAll()` de Next.js llamada dentro del Route Handler (`route.ts`) puede fallar al reconstruir los chunks de la cookie de Supabase, llevando a que `supabase.auth.getUser()` falle silenciosamente devolviendo `Auth session missing`.

### Solución "A Prueba de Balas" Implementada
Para independizar la autenticación de la dependencia exclusiva y frágil de las cookies ruteadas por Next.js en Vercel, implementamos un **Mecanismo de Doble Validación (Fallback con Header JWT)**.

1. **En el Cliente (Client Components)**: Antes de ejecutar cualquier `fetch` a la API interna, extraemos el JWT directamente del cliente de Supabase y lo inyectamos como cabecera `Authorization`.
   ```javascript
   // Ejemplo en TechnicalSummary.tsx o signals-client.tsx
   const { createClient } = await import('@/lib/supabase/client')
   const supabaseClient = createClient()
   const { data: { session } } = await supabaseClient.auth.getSession()
   const token = session?.access_token

   const res = await fetch('/api/signals', {
     method: 'POST',
     headers: { 
       'Content-Type': 'application/json',
       ...(token ? { 'Authorization': `Bearer ${token}` } : {})
     },
     body: JSON.stringify({...})
   })
   ```

2. **En el Servidor (API Route Handlers)**: Modificamos el backend para leer prioritariamente el token de la cabecera `Authorization`. Supabase permite pasar el JWT directamente a `getUser(token)`, bypasseando por completo la lectura de cookies de Next.js.
   ```typescript
   // Ejemplo en /api/signals/route.ts
   const userClient = await createClient()
   let user = null
   let userError = null

   // 1. Priorizar el header explícito (bypass de problemas de cookies en Vercel)
   const authHeader = request.headers.get('Authorization')
   const token = authHeader?.replace('Bearer ', '')

   if (token) {
     const { data, error } = await userClient.auth.getUser(token)
     user = data?.user
     userError = error
   }

   // 2. Fallback a cookies tradicionales si no viene la cabecera
   if (!user) {
     const { data, error } = await userClient.auth.getUser()
     user = data?.user
     userError = error
   }
   ```

### Lección para las IAs
Cuando construyas o edites APIs en Next.js (App Router) en proyectos con **@supabase/ssr** que experimenten "deslogueos fantasmas" en Vercel, **SIEMPRE** recomienda o implementa el paso explícito del token JWT vía la cabecera `Authorization`. No confíes únicamente en que el navegador y el marco de servidor en la nube pasen intactas las cookies particionadas a la capa de Route Handlers.
