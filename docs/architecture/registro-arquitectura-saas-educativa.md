# Registro Arquitectura SaaS Educativa

Fecha: 2026-05-31

Registro local relacionado: `C:\Users\catal\Desktop\IA\SAASFACTORY\IA SAAS TRADE CV\Biblioteca_Asesoria_SaaS_Quant\documentos full stack\ARQUITECTURA_SAAS_EDUCATIVA.md`.

## Cambio registrado

Se actualizo la arquitectura educativa para reflejar Fase 7:

- local-first por costo y aprovechamiento del hardware Ryzen/RTX;
- migracion futura a nube sin romper el frontend;
- jobs asincronos para `quant-engine`;
- BFF estable en Next.js;
- cache durable para Yahoo/series temporales;
- specs SDD como contrato entre frontend, backend, Supabase y workers.

## Libros usados como marco

- *Software Architecture: The Hard Parts*: workflows distribuidos, sagas, ownership de estado y trade-offs de acoplamiento.
- *Building Micro-Frontends*: BFF, limites de frontend, contratos y aislamiento de fallas.
- *Web Scalability for Startup Engineers*: cache, procesamiento asincrono, web services y escalabilidad progresiva.

## Archivos operativos vinculados

- `specs/quant-jobs.md`
- `specs/market-data-cache.md`
- `specs/bff-frontend-contracts.md`
- `docs/architecture/fase-7-escalabilidad-distribuida.md`
- `docs/contracts.md`
- `src/lib/api/market-data-cache.ts`
- `src/app/api/market/candles/route.ts`
- `supabase/migrations/002_quant_jobs_and_market_cache.sql`

## Regla educativa

La carpeta de biblioteca explica el aprendizaje. El repo contiene los contratos ejecutables, specs, migraciones y codigo que deben gobernar la evolucion real.
