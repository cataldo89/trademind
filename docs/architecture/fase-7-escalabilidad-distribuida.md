# Fase 7 - Escalabilidad Distribuida

Estado: implementacion incremental con base en `supabase/migrations/002_quant_jobs_and_market_cache.sql`, `/api/quant/jobs`, `src/lib/api/market-data-cache.ts` y specs SDD bajo `specs/`.

Fuentes bibliograficas locales usadas:

- `Biblioteca_Asesoria_SaaS_Quant/documentos full stack/Software_Architecture_The_Hard_Parts_Neal_Ford_OReilly.pdf`
- `Biblioteca_Asesoria_SaaS_Quant/documentos full stack/building-micro-frontends-distributed-systems-for-the-frontend-2.pdf`
- `Biblioteca_Asesoria_SaaS_Quant/documentos full stack/Web Scalability for Startup Engineers.pdf`

Nota de saneamiento: `FASES_CHECKLIST.md` no existe en la raiz actual. Si aparece de nuevo, debe moverse a `docs/archive/` o reemplazarse por este documento como Fase 7 viva. Los `SKILL.md` y `SECURITY.md` detectados pertenecen a `node_modules/` y no se versionan.

### [TM-001] - Cola Durable Para Quant-Engine
- **Evidencia Tecnica Activa:** `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` seccion P1.3 indica que `quant-engine` no escala como request sincrono; `LLM_CONTEXT.md` define Fase 0 con Cloudflare Tunnel efimero hacia `127.0.0.1:8000`.
- **Sustento Bibliografico:** *Software Architecture: The Hard Parts*, caps. 11-12: separar workflow, ownership de datos y transacciones distribuidas para reducir acoplamiento temporal entre servicios.
- **Implementacion Fase 0 (Hoy):** Next.js encola en `quant_jobs` via `/api/quant/jobs`; el motor local Ryzen/RTX reclama trabajo con `claim_next_quant_job`, procesa FastAPI/Python fuera del ciclo HTTP del usuario y finaliza con `complete_quant_job`.
- **Migracion a Fase 1 (Manana):** Un worker cloud GPU consume las mismas funciones SQL y escribe el mismo contrato `result/error/status`; el frontend y BFF no cambian porque solo observan `quant_jobs`.
- **Mecanismo Anti-Alucinacion (Telemetria):** `quant_jobs.status`, `quant_jobs.attempts`, `quant_jobs.lease_owner`, `quant_jobs.completed_at` y `quant_job_events` muestran visualmente si el trabajo fue encolado, tomado, completado o fallado.

### [TM-002] - BFF Estable Para Procesos Largos
- **Evidencia Tecnica Activa:** `ESTADO_ACTUAL_PROYECTO.md` seccion 5 advierte que modelos descargan datos y entrenan en request; el runbook P1.3 documenta timeouts/503 cuando el workflow sincrono se demora.
- **Sustento Bibliografico:** *Building Micro-Frontends*, patron BFF: el cliente conversa con un contrato orientado a la experiencia y no con detalles volatiles del backend.
- **Implementacion Fase 0 (Hoy):** `/api/quant/jobs` devuelve `202 Accepted` con `job.id` y contrato normalizado. El dashboard puede usar polling optimizado cada 3-5 segundos o Supabase Realtime sobre `quant_jobs` sin congelar componentes.
- **Migracion a Fase 1 (Manana):** El BFF mantiene el mismo shape y solo cambia el productor/consumidor del job. La UI conserva `queued/running/succeeded/failed` y no conoce si el calculo ocurrio en laptop, VM GPU o contenedor.
- **Mecanismo Anti-Alucinacion (Telemetria):** Cada pantalla puede mostrar el ultimo `quant_job_events.message`; si el job no pasa de `queued/running`, hay evidencia concreta de atasco y no una respuesta inventada por IA.

### [TM-003] - Cache De Series Temporales Yahoo
- **Evidencia Tecnica Activa:** `docs/runbooks/problemas-escalamiento-errores-frontend-backend.md` P1.1/P1.2 documenta fan-out de quotes y riesgo de 429; `LLM_CONTEXT.md` registra que Yahoo/yfinance ya produjo 429.
- **Sustento Bibliografico:** *Web Scalability for Startup Engineers*, cache y escalabilidad lineal: evitar recomputar y redescargar datos compartidos entre usuarios y workers.
- **Implementacion Fase 0 (Hoy):** `market_data_cache` guarda payload OHLCV por `symbol/market/range/provider` con `expires_at`; Next y Python deben consultar cache antes de pedir Yahoo Chart API y refrescar de forma controlada.
- **Migracion a Fase 1 (Manana):** La misma tabla puede ser reemplazada o respaldada por Redis/managed cache sin cambiar el contrato de lectura; Supabase queda como auditoria y fallback durable.
- **Mecanismo Anti-Alucinacion (Telemetria):** `market_data_cache.fetched_at`, `expires_at` y `provider` prueban si el worker uso datos frescos o cacheados, evitando conclusiones opacas sobre datos inexistentes.

Implementado en esta iteracion: `src/app/api/market/candles/route.ts` usa `getDurableMarketData()` para consultar `market_data_cache` despues del cache en memoria y antes de Yahoo. Si Yahoo falla y existe payload stale, se devuelve stale como degradacion controlada sin cambiar el contrato visual del frontend.

### [TM-004] - Contrato De Error Que Muere En El BFF
- **Evidencia Tecnica Activa:** `LLM_CONTEXT.md` exige no exponer detalles internos y el runbook P2.1 marca riesgo de `details: String(error)` en respuestas al cliente.
- **Sustento Bibliografico:** *Building Micro-Frontends*, aislamiento de fallas por capa: el BFF traduce fallas internas en estados de UI estables.
- **Implementacion Fase 0 (Hoy):** `/api/quant/jobs` responde errores genericos (`Failed to enqueue/load`) y guarda detalle operacional en logs/eventos; los componentes solo reciben `status`, `result`, `error_code` y `error_message` ya controlados.
- **Migracion a Fase 1 (Manana):** Workers cloud pueden fallar por GPU, red o proveedor, pero esos detalles quedan encapsulados en eventos y codigos, no en `undefined` dentro de React.
- **Mecanismo Anti-Alucinacion (Telemetria):** `quant_jobs.error_code`, `quant_jobs.error_message` y `quant_job_events.metadata` permiten auditar causa sin depender del render del cliente.

### [TM-005] - SDD Como Contrato De Migracion Local A Nube
- **Evidencia Tecnica Activa:** `docs/sdd-status.md` registraba SDD parcial y ausencia de `specs/`; `LLM_CONTEXT.md` exige no afirmar funcionalidad sin evidencia de codigo, logs, tests o CLI.
- **Sustento Bibliografico:** *Software Architecture: The Hard Parts*, cap. 1: decisiones arquitectonicas y fitness functions; *Building Micro-Frontends*, capitulos de limites y contratos; *Web Scalability for Startup Engineers*, cap. 4: API-first/coding to contract.
- **Implementacion Fase 0 (Hoy):** Se crean specs versionadas para jobs, cache y BFF. Cada mejora local queda vinculada a contrato, estados, telemetria y pruebas obligatorias.
- **Migracion a Fase 1 (Manana):** La nube reemplaza ubicacion fisica de workers/cache, no el contrato. Las specs gobiernan que puede cambiar sin romper frontend ni datos.
- **Mecanismo Anti-Alucinacion (Telemetria):** `specs/README.md`, `docs/contracts.md`, `docs/sdd-status.md` y `npm run test:contracts` prueban que cada contrato documentado tiene archivo y validacion asociada.
