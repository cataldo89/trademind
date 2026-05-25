
<!-- BEGIN:github-repository-rules -->
# GitHub Repository Rules

- Repositorio GitHub oficial: `cataldo89/trademind`.
- Solo subir cambios a `https://github.com/cataldo89/trademind.git`.
- No usar, recrear, pushear ni referenciar `cataldo89/trademind-push`; es un duplicado que debe eliminarse.
- Rutas, URLs y puertos canonicos viven en `LLM_CONTEXT.md` seccion `0.0 Rutas y direcciones canonicas`. Si este archivo u otro documento contradice esa tabla, corregir el documento que contradice.
<!-- END:github-repository-rules -->
<!-- BEGIN:nextjs-agent-rules -->
# PUERTA DE ENTRADA UNIVERSAL PARA CUALQUIER AGENTE IA

**ANTES DE ESCRIBIR CÓDIGO O PROPONER CAMBIOS, DEBES LEER EN ORDEN:**
1. `LLM_CONTEXT.md` (Fuente maestra de la realidad)
2. `ESTADO_ACTUAL_PROYECTO.md` (Estado técnico)
3. `ESTRUCTURA_PROYECTO.md` (Mapa del repositorio)
4. `soluciones_tecnicas.md` (Problemas ya resueltos)
5. `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` (Errores frontend/backend y riesgos de escalamiento)
6. `SEGURIDAD.md` (Secretos, credenciales, service role y pre-push)

**Aclaración:** Este archivo (`AGENTS.md`) contiene reglas operativas (ej. Deploy en Vercel), pero NO contiene el estado técnico completo. No asumas funcionalidad real basado solo en los nombres de archivos.

## Roles documentales

- `AGENTS.md`: reglas operativas, GitHub oficial, Vercel y orden obligatorio de lectura.
- `LLM_CONTEXT.md`: fuente operativa maestra para agentes IA.
- `ESTADO_ACTUAL_PROYECTO.md`: auditoría técnica actual del código y brechas reales.
- `ESTRUCTURA_PROYECTO.md`: mapa del repositorio; inventario no equivale a funcionalidad.
- `soluciones_tecnicas.md`: runbooks de problemas ya resueltos y patrones obligatorios.
- `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md`: fallas actuales frontend/backend, causas de backend y riesgos de escalamiento SaaS.
- `SEGURIDAD.md`: secretos, credenciales, service role, scripts y checklist pre-push.
- `MEMORY.md`: memoria histórica y filosofía del producto, no fuente técnica final.
- `LLM.md`: visión futura y roadmap aspiracional AI-native, no auditoría del estado real.
- `README.md`: entrada pública y guía de ejecución.

## Reglas de ejecución local, VS Code y pruebas visuales

1. El entorno de trabajo principal del proyecto es VS Code.

2. Todas las pruebas visuales, navegación agentiva, validaciones con navegador y revisiones de UI deben ejecutarse siempre contra el frontend local fijo:

   http://localhost:3000

3. El frontend corresponde a Next.js y debe levantarse con:

   npm run dev

4. Antes de ejecutar npm run dev, verificar si http://localhost:3000 ya está activo.

5. Si http://localhost:3000 ya está activo y corresponde a este mismo proyecto, reutilizar ese servidor. No abrir otro servidor, dashboard, preview ni puerto alternativo.

6. Si http://localhost:3000 está ocupado por otro proceso que no corresponde al proyecto, informar el conflicto antes de cambiar de puerto.

7. No usar puertos alternativos como 3001, 3002, 5173 u otros salvo autorización explícita del usuario.

8. No crear nuevos dashboards locales, previews externos, proyectos Vercel temporales ni vistas duplicadas para validar cambios visuales.

9. Playwright, browser automation, pruebas visuales o navegación agentiva deben apuntar siempre a:

   http://localhost:3000

10. El quant-engine debe ejecutarse separado y mantenerse fijo en:

   http://127.0.0.1:8000

11. No mezclar el servidor frontend Next.js con el servidor quant-engine.

12. Para cambios visuales o funcionales:
   - Primero validar en http://localhost:3000.
   - Luego ejecutar las validaciones que correspondan.
   - Solo después desplegar al proyecto oficial de Vercel definido en AGENTS.md, si aplica.

13. Si una tarea requiere abrir navegador en vivo, debe reutilizar la instancia local existente del proyecto y no levantar otro dashboard.

14. Si el agente no puede confirmar qué servidor está activo, debe revisar procesos/puertos antes de iniciar otro.

15. Esta regla aplica a cualquier agente IA que trabaje en el repositorio, independiente de la herramienta o modelo utilizado.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:vercel-project-rules -->
# Vercel Deploy Rules — TradeMind CV

**PROYECTO VERCEL OFICIAL:** `trademind-cv` (ID: `prj_1Sqjg0370DyliHgMI0FcVe2jpG3I`)
**EQUIPO:** `cataldo89-1519s-projects`
**URL canonica de produccion:** https://trademind-cv-ten.vercel.app

## REGLAS PARA DEPLOY

### Antes de hacer deploy SIEMPRE:
1. Verificar que `.vercel/project.json` existe y contiene `"projectName":"trademind-cv"`
2. Si el projectName es diferente, ENLIZAR primero:
   ```bash
   vercel link --project trademind-cv --scope cataldo89-1519s-projects
   ```
3. Deploy con el flag `--project trademind-cv`:
   ```bash
   vercel deploy --prod --project trademind-cv --scope cataldo89-1519s-projects
   ```
4. Después de cada cambio funcional, corrección de bug o ajuste visual solicitado por el usuario, desplegar SIEMPRE a Vercel para que los cambios queden reflejados en producción.

### NUNCA:
- NO crear nuevos proyectos de Vercel
- NO usar `vercel deploy --prod --yes` sin verificar el projectName primero
- NO usar `vercel link` sin `--project trademind-cv`
- NO desplegar sin verificar el projectName en `.vercel/project.json`
- NO dejar cambios funcionales solo en local cuando el usuario espera verlos en `trademind-cv-ten.vercel.app`

### Si el deploy falla:
1. Verificar `.vercel/project.json` → debe ser `"projectName":"trademind-cv"`
2. Si es diferente, ejecutar `vercel link --project trademind-cv --scope cataldo89-1519s-projects`
3. Reintentar deploy

### Variables de entorno obligatorias:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `QUANT_ENGINE_URL` (producción si `/api/trading` debe usar quant-engine)
- `QUANT_ENGINE_SECRET` (producción si quant-engine requiere autenticación interna)
<!-- END:vercel-project-rules -->
