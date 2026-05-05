---
title: "TradeMind — Contexto canónico para Antigravity"
status: "operational-source-of-truth"
owner: "Carlos / TradeMind"
created_at: "2026-05-04"
recommended_path: "ANTIGRAVITY_CONTEXT.md"
editable_by: "human-or-agent-with-evidence"
purpose: "Orientar a Antigravity para estabilizar el full stack sin confundir visión futura con estado real del código."
---

# TradeMind — Contexto canónico para Antigravity

## 0. Instrucción principal para la IA

Este archivo debe leerse antes de modificar el repositorio.

La regla base es simple:

> No afirmar que algo está implementado, probado o funcional si no existe evidencia directa en código, logs, tests o ejecución CLI.

TradeMind tiene una base técnica útil, pero hoy mezcla cuatro capas que deben mantenerse separadas:

1. Visión del producto.
2. Estado real del código.
3. Plan futuro.
4. Memoria operativa de agentes IA.

El problema principal no es falta de ideas. El problema es que varias IAs han tratado planes, mocks y esqueletos como si fueran implementación real. Este archivo busca corregir eso.

---

## 1. Objetivo real de TradeMind

TradeMind no debe entenderse solo como una landing page, ni solo como un dashboard financiero, ni solo como un simulador.

El objetivo real es construir un full stack SaaS de trading/inversión que ayude a tomar mejores decisiones mediante:

- Datos reales de mercado.
- Señales algorítmicas explicables.
- Validación cuantitativa.
- Filtros de prudencia tipo Benjamin Graham.
- Simulación/backtesting en QuantConnect LEAN.
- Interfaz clara para evitar decisiones impulsivas.
- Persistencia, autenticación y trazabilidad en Supabase.
- Despliegue estable en Vercel.

La visión futura es una plataforma AI-Native, pero la prioridad inmediata no es agregar más capas de IA. La prioridad inmediata es estabilizar lo existente, eliminar mocks críticos y cerrar el ciclo real:

```text
Dato real -> análisis cuantitativo -> señal explicable -> persistencia -> simulación/backtest -> validación -> UI
```

---

## 2. Cómo leer los documentos actuales del repo

El repo ya tiene varios archivos `.md`, pero no todos tienen el mismo nivel de autoridad.

### 2.1 `AGENTS.md`

Usar como fuente principal para reglas de deploy y Vercel.

Contiene:

- Proyecto Vercel oficial: `trademind-cv`.
- Scope/equipo de Vercel.
- Reglas para no crear proyectos nuevos.
- Variables de entorno obligatorias.
- Advertencia sobre versión moderna de Next.js.

Debe seguir existiendo.

Recomendación: agregar una línea al inicio indicando que Antigravity debe leer también este archivo:

```md
@ANTIGRAVITY_CONTEXT.md
```

o, si Antigravity no soporta imports, agregar una instrucción textual:

```md
Antes de modificar código, leer ANTIGRAVITY_CONTEXT.md.
```

### 2.2 `CLAUDE.md`

Actualmente solo contiene:

```md
@AGENTS.md
```

Eso está bien como wrapper mínimo.

Recomendación: dejarlo simple, pero apuntarlo indirectamente al nuevo contexto mediante `AGENTS.md`.

### 2.3 `GEMINI.md`

Es útil como visión futura, pero no debe tratarse como estado real del código.

Contiene ideas correctas como:

- MCP.
- LangGraph o agentes.
- PCA, Lasso, Ridge.
- ARIMA/SARIMA.
- GARCH.
- HMM.
- QuantConnect.
- Graham.
- SHAP/LIME.

Problema: parte de ese contenido está redactado como si debiera existir o como si ya estuviera estabilizado. Para Antigravity debe quedar claro:

> `GEMINI.md` es roadmap/visión técnica, no auditoría del estado real.

### 2.4 `MEMORY.md`

Mezcla filosofía, memoria histórica y estado parcial. Es útil para entender el estilo del producto, pero no debe usarse como fuente técnica definitiva.

Problemas detectados:

- Declara Alpha Vantage y Finnhub como “listas en configuración”, pero el estado auditado indica que esas integraciones no existen como implementación real.
- Habla de Supabase Realtime como dirección deseada, pero debe validarse si realmente está operativo extremo a extremo.
- Puede inducir a una IA a creer que hay más madurez técnica de la que existe.

Uso correcto:

- Leer para entender la identidad del producto.
- No usar para afirmar implementación.
- Verificar siempre contra código real.

### 2.5 `ESTRUCTURA_PROYECTO.md`

Sirve como mapa general del repositorio, pero contiene descripciones que no siempre coinciden con el código actual.

Ejemplo crítico:

- Describe `graham_filters.py` con `Debt/Asset < 0.50`.
- El código real usa rechazo cuando `debt_to_asset > 1.10`.

Uso correcto:

- Útil para ubicar carpetas y archivos.
- No usar como evidencia final de comportamiento.
- Verificar rutas reales antes de modificar.

### 2.6 `ESTADO_ACTUAL_PROYECTO.md`

Es el documento más cercano a una auditoría real del estado técnico.

Debe tratarse como base inicial de gaps, pero no reemplaza la lectura directa de código.

Afirma:

- HMM implementado.
- GARCH implementado.
- ARIMA parcialmente implementado, pero con confianza hardcodeada.
- PCA/Lasso implementados de forma básica.
- `run_pca_autoencoder` no es autoencoder.
- Graham tiene parámetros discutibles.
- `/api/trading` es mock.
- QuantConnect está al 30%.
- Testing/CI está al 0%.
- LangGraph no existe realmente.
- `mcp-client.ts` existe pero no se usa.

Uso correcto:

- Punto de partida para estabilización.
- Debe actualizarse solo cuando se compruebe con código y ejecución.

### 2.7 `soluciones_tecnicas.md`

Es una base de conocimiento útil para errores ya resueltos.

Debe respetarse especialmente para:

- Problemas de autenticación en Vercel.
- Supabase SSR.
- Paso explícito de JWT por header `Authorization`.
- Fallback de cookies en Route Handlers.

Uso correcto:

- Mantener este patrón cuando se toquen rutas autenticadas.
- No revertir la solución de doble validación sin pruebas.

### 2.8 `README.md`

El README actual no parece corresponder a TradeMind: contiene documentación de Supabase CLI.

Acción recomendada:

- Reemplazarlo por un README real de TradeMind, pero no como primera tarea.
- Priorizar primero estabilización técnica.
- Luego generar README final basado en estado real verificado.

---

## 3. Estado real verificado del repo

Esta sección consolida el estado observado por lectura directa de archivos del repo.

No significa que todo haya sido ejecutado en terminal. Significa que existe evidencia estática en código.

---

## 4. Stack principal detectado

### 4.1 Frontend / Backend Next.js

`package.json` indica un proyecto:

- Next.js 16.2.4.
- React 19.2.4.
- TypeScript.
- Tailwind.
- Supabase.
- Gemini SDK.
- Yahoo Finance.
- Recharts.
- Lightweight Charts.
- Zustand.

Scripts disponibles:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "audit:zesty": "node scripts/audit-zesty-symbols.mjs"
}
```

Problema:

- No existe script `test`.
- No existe script explícito `typecheck`.
- No existe CI visible.
- La calidad depende de `lint` y `build`, pero no de pruebas funcionales.

Acción recomendada:

- Agregar scripts:
  - `typecheck`.
  - `test`.
  - `test:api`.
  - `test:e2e` cuando corresponda.
  - `verify` como comando único.

Ejemplo recomendado:

```json
{
  "scripts": {
    "verify": "npm run lint && npm run typecheck && npm run build",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## 5. Estado de APIs Next.js

### 5.1 `/api/ai/analyze`

Archivo:

```text
src/app/api/ai/analyze/route.ts
```

Estado observado:

- Usa Yahoo Finance.
- Construye prompt financiero.
- Intenta Gemini si existe `GEMINI_API_KEY`.
- Si no, intenta OpenAI si existe `OPENAI_API_KEY`.
- Si no hay IA disponible, usa fallback determinístico por reglas simples.
- No aparece `export const runtime = 'edge'`, por lo que queda en runtime Node.js por defecto.

Riesgo:

- Es una ruta de análisis textual, no necesariamente un motor cuantitativo real.
- No parece conectarse al `quant-engine`.
- Puede generar recomendaciones narrativas sin validación contra backtest.
- Depende de datos de Yahoo Finance y titulares.

Acción recomendada:

- Mantenerla en Node.js salvo evidencia de compatibilidad Edge.
- Separar análisis narrativo de señal operativa.
- No permitir que esta ruta emita una recomendación de compra/venta final sin pasar por:
  - Graham.
  - Riesgo.
  - Régimen.
  - Validación o score cuantitativo.
  - Registro en audit log.

### 5.2 `/api/signals`

Archivo:

```text
src/app/api/signals/route.ts
```

Estado observado:

- Tiene `export const runtime = 'edge'`.
- Usa `createClient()` y `createAdminClient()` desde Supabase SSR.
- Valida usuario por header `Authorization` y fallback con cookies.
- Inserta señales en tabla `signals`.
- Filtra timeframes permitidos: `1D`, `5D`, `1M`.

Riesgo:

- El uso de `@supabase/ssr`, cookies y service role puede ser riesgoso en Edge.
- El propio documento auditado marcó `/api/signals` en Edge como riesgo alto.
- Se usa service role si existe `SUPABASE_SERVICE_ROLE_KEY`, aunque filtra por `user_id`. Esto puede funcionar, pero debe auditarse con cuidado porque service role bypassea RLS.

Acción recomendada:

- Evaluar mover `/api/signals` a Node.js.
- Mantener header JWT explícito.
- No romper el patrón descrito en `soluciones_tecnicas.md`.
- Agregar tests de:
  - GET sin auth.
  - GET con auth.
  - POST sin auth.
  - POST con token válido.
  - POST con timeframe inválido.
  - Inserción con `user_id` correcto.
  - Imposibilidad de leer señales de otro usuario.

### 5.3 `/api/trading`

Archivo:

```text
src/app/api/trading/route.ts
```

Estado observado:

- Es mock.
- Genera acción `BUY` o `SELL` con `Math.random()`.
- Genera confianza aleatoria.
- No inserta realmente en Supabase porque la línea está comentada.
- Comentarios indican “aquí se llamaría a AlphaVantage/OpenAI”, pero no existe implementación.

Este es un gap crítico.

Acción obligatoria:

- No usar `/api/trading` como fuente de señal real.
- Reemplazar `Math.random()` por pipeline real.
- O bien deshabilitar temporalmente la ruta con respuesta explícita:

```json
{
  "success": false,
  "status": "not_implemented",
  "message": "Trading engine is not connected to quant-engine yet."
}
```

Mejor solución:

- Convertir `/api/trading` en orquestador de señal.
- Debe llamar a una ruta interna tipo `/api/quant/analyze`.
- Debe persistir resultado en Supabase.
- Debe guardar inputs, outputs, modelo usado y evidencia.
- Debe devolver decisión con trazabilidad.

---

## 6. Estado del `quant-engine`

Ruta:

```text
quant-engine/
```

Tecnología:

- FastAPI.
- yfinance.
- pandas.
- numpy.
- scikit-learn.
- statsmodels.
- arch.
- hmmlearn.
- shap listado en requirements.
- python-dotenv.

### 6.1 `main.py`

Estado observado:

- Define FastAPI.
- Expone endpoints:
  - `/`
  - `/mcp/tools/get_market_regime`
  - `/mcp/tools/calculate_var`
  - `/mcp/tools/check_graham_filters`
  - `/ml/extract_features`
  - `/ml/predict_direction`
  - `/workflow/analyze`

Problemas:

- CORS está configurado con `allow_origins=["*"]`.
- No hay autenticación entre Next.js y FastAPI.
- No hay validación de secreto interno.
- No hay rate limiting.
- No hay logging estructurado.
- No hay manejo robusto de errores por endpoint.
- El endpoint `/mcp/tools/calculate_var` devuelve un objeto con `var_95`, pero `calculate_var_garch` ya devuelve un dict. El nombre puede inducir a mal uso.

Acción recomendada:

- Restringir CORS.
- Agregar header interno:

```text
X-TradeMind-Quant-Secret
```

- Validar contra `QUANT_ENGINE_SECRET`.
- Crear proxy desde Next.js en Node runtime para no exponer FastAPI directo al navegador.
- Mejorar shape de respuesta.

### 6.2 `risk_models.py`

Estado observado:

- `detect_regime(symbol)` descarga 5 años con yfinance.
- Calcula retornos logarítmicos.
- Entrena `GaussianHMM(n_components=3)`.
- Mapea estados por medias: Bear, Sideways, Bull.
- `calculate_var_garch(symbol, timeframe)` descarga 2 años.
- Calcula GARCH(1,1).
- Calcula VaR 95%.
- `predict_direction_arima(symbol)` usa ARIMA(1,1,1).
- Retorna `confidence: 0.55` hardcodeado.

Lo bueno:

- Hay lógica cuantitativa real básica.
- No todo es mock.
- HMM/GARCH/ARIMA existen como implementación inicial.

Problemas:

- Entrena modelos on-demand en cada llamada.
- No hay cache.
- No hay validación out-of-sample.
- No hay control de errores por datos insuficientes.
- `timeframe` se recibe pero casi no condiciona la lógica.
- La confianza ARIMA es fija.
- No hay evaluación de precisión direccional histórica.
- No hay test de estabilidad para tickers problemáticos.
- HMM mapea por media, pero no considera volatilidad para nombrar regímenes de forma robusta.

Acciones recomendadas:

- Agregar validación mínima de datos:
  - filas suficientes.
  - no NaN.
  - no retornos infinitos.
  - manejo de ticker inválido.
- Agregar cache por símbolo y periodo.
- Separar entrenamiento de inferencia.
- Agregar backtest rolling básico para ARIMA.
- Reemplazar confianza fija por métrica derivada de validación.
- Guardar outputs en Supabase o logs de auditoría.

### 6.3 `ml_pipeline.py`

Estado observado:

- `run_pca_autoencoder(symbol)` realmente ejecuta PCA.
- No hay autoencoder.
- Calcula `Ret` y `Vol`.
- PCA sobre dos features.
- `run_lasso_ridge()` ajusta Lasso y devuelve variables seleccionadas/descartadas.
- Ridge se importa, pero no se usa realmente.

Problemas:

- Nombre engañoso: `run_pca_autoencoder` no implementa autoencoder.
- PCA sobre solo dos variables tiene valor limitado.
- No hay validación de train/test.
- No hay pipeline para múltiples activos.
- `Ridge` no se aplica.
- No hay target financiero claro para Lasso.
- No hay control de overfitting.

Acciones recomendadas:

- Renombrar a `run_pca_features` si no se implementará autoencoder.
- Implementar autoencoder solo si hay dataset y justificación.
- Implementar PCA sobre canasta de activos o set amplio de indicadores.
- Separar:
  - `build_features`.
  - `fit_pca`.
  - `fit_lasso`.
  - `evaluate_feature_selection`.
- Agregar tests con datos sintéticos.
- Evitar prometer “IA avanzada” si solo existe PCA básico.

### 6.4 `graham_filters.py`

Estado observado:

- Usa yfinance.
- Extrae:
  - `trailingPE`.
  - `totalDebt`.
  - `totalAssets`.
- Rechaza si `P/E > 15`.
- Rechaza si `debt_to_asset > 1.10`.

Problema crítico:

Hay contradicción documental sobre Debt/Asset:

- Un documento habla de `Debt/Asset < 0.50`.
- Gemini habló de `Debt-to-Asset < 1.10`.
- El código rechaza solo si `Debt/Asset > 1.10`.

Esto significa que el filtro puede estar demasiado permisivo o conceptualmente mal definido.

Acción obligatoria:

- Carlos debe elegir criterio canónico.
- Hasta elegirlo, no usar Graham como filtro duro final de compra.
- Documentar umbral en un solo lugar.
- Agregar tests unitarios:

```text
PE alto -> rechazar
PE bajo -> continuar
Debt/Asset alto -> rechazar
sin totalAssets -> no aprobar automáticamente sin advertencia
ticker sin info -> error controlado
```

Recomendación técnica:

- Crear archivo:

```text
quant-engine/config/graham_rules.yml
```

o configuración equivalente TypeScript/Python compartida.

Ejemplo:

```yaml
graham:
  max_pe: 15
  max_debt_to_asset: 0.50
  require_positive_earnings: true
  require_data_completeness: true
```

### 6.5 `agents/graph.py`

Estado observado:

- No usa LangGraph real.
- Es workflow secuencial vanilla Python.
- Roles:
  - research_manager.
  - technical_analyst.
  - risk_manager.
  - decision_node.
- `decision_node` usa reglas fijas.

Problema:

- El archivo puede hacer creer que existe arquitectura multiagente real.
- No hay memoria persistente.
- No hay grafo.
- No hay estado versionado.
- No hay XAI real.
- No hay SHAP/LIME, solo explicación textual por regla.

Acción recomendada:

- Mantenerlo como `workflow.py` si no se implementa LangGraph.
- O implementar LangGraph realmente, pero solo después de estabilizar:
  - datos.
  - API.
  - tests.
  - QuantConnect.
- No priorizar LangGraph si todavía `/api/trading` es mock y LEAN no corre.

### 6.6 `lean_integration.py`

Estado observado:

- Lee `QC_USER_ID`.
- Lee `QC_API_TOKEN`.
- Genera un archivo de algoritmo LEAN.
- `run_lean_backtest()` está en `pass`.
- No autentica.
- No ejecuta backtest.
- No valida Lean CLI.
- No lee resultados.

Este es gap crítico.

Acción obligatoria:

- Implementar diagnóstico CLI:
  - `lean --version`
  - `lean whoami`
  - `lean init` si corresponde
  - validación de workspace
- Implementar backtest local real.
- Capturar stdout/stderr.
- Guardar resultado JSON.
- Parsear estadísticas principales.
- Devolver estado claro a Next.js.

No afirmar “QuantConnect funcional” hasta que exista evidencia de:

```text
lean whoami OK
lean backtest OK
resultado parseado OK
estadísticas devueltas al SaaS OK
```

---

## 7. Problemas de documentación y gobernanza

### 7.1 Problema raíz

El proyecto tiene demasiados documentos que dicen cosas distintas.

Ejemplos:

- `GEMINI.md` sugiere LangGraph como arquitectura objetivo.
- `ESTADO_ACTUAL_PROYECTO.md` dice que no existe LangGraph.
- `ESTRUCTURA_PROYECTO.md` describe Alpha Vantage y Finnhub como configuradas.
- Auditoría indica que no existen como integración real.
- Graham aparece con distintos umbrales.
- Antigravity declaró arquitectura 100% funcional pese a que QuantConnect falló y `/api/trading` sigue mock.

### 7.2 Regla nueva

A partir de este archivo:

- Visión futura va en `GEMINI.md` o roadmap.
- Estado real va en `ESTADO_ACTUAL_PROYECTO.md` o en un archivo generado.
- Memoria histórica va en `MEMORY.md`.
- Instrucciones de ejecución para agentes van aquí y en `AGENTS.md`.
- Ningún agente debe mezclar esos niveles.

### 7.3 Estructura recomendada

Crear en el repo:

```text
docs/
  product/
    charter.md
    scope-boundaries.md
  state/
    current-reality.md
    known-gaps.md
    roadmap-now-next-later.md
  architecture/
    system-map.md
    runtime-policy.md
    integration-contracts.md
  ai/
    antigravity-context.md
    read-order.md
    task-template.md
  runbooks/
    supabase-auth-vercel.md
    quantconnect-lean.md
    quant-engine-fastapi.md
  journal/
    2026-05-04-stabilization.md
```

Si se quiere mantener simple, usar por ahora solo:

```text
ANTIGRAVITY_CONTEXT.md
ESTADO_ACTUAL_PROYECTO.md
ESTRUCTURA_PROYECTO.md
AGENTS.md
soluciones_tecnicas.md
```

---

## 8. Brechas críticas por prioridad

## P0 — Bloqueantes

### P0.1 `/api/trading` es mock

Problema:

- Usa `Math.random()`.
- No llama al quant-engine.
- No guarda en Supabase.
- No valida señales.
- No integra Graham, HMM, GARCH, ARIMA ni QuantConnect.

Acción:

- Reemplazar por pipeline real o deshabilitar como no implementado.
- No mostrarlo en UI como trading real.

Criterio de aceptación:

- El endpoint debe devolver decisión basada en datos reales.
- Debe registrar inputs/outputs.
- Debe tener test.
- Debe rechazar ticker inválido.
- Debe no depender de aleatoriedad.

### P0.2 QuantConnect no está integrado de verdad

Problema:

- `run_lean_backtest()` está vacío.
- Solo se genera archivo.
- No existe ejecución real.

Acción:

- Implementar Lean CLI workflow.
- Validar credenciales.
- Ejecutar backtest.
- Parsear resultado.

Criterio de aceptación:

```text
lean whoami -> OK
lean backtest -> OK
resultados disponibles -> OK
SaaS puede leer resultado -> OK
```

### P0.3 Testing inexistente o insuficiente

Problema:

- No hay script test.
- No hay prueba de API.
- No hay prueba de quant-engine.
- No hay prueba de Supabase end-to-end.
- No hay CI.

Acción:

- Agregar tests mínimos.
- Agregar script `verify`.

Criterio de aceptación:

```bash
npm run verify
python -m pytest
```

deben pasar.

### P0.4 Fuente de verdad contradictoria

Problema:

- Documentos distintos dicen cosas distintas.
- Agentes pueden seguir construyendo sobre supuestos falsos.

Acción:

- Mantener este archivo como contexto operativo.
- Actualizar `AGENTS.md` para apuntar aquí.
- Marcar `GEMINI.md` como visión futura.
- Marcar `MEMORY.md` como memoria histórica, no estado real.
- Corregir README.

---

## P1 — Alto impacto

### P1.1 `mcp-client.ts` existe pero no está conectado

Problema:

- Define cliente MCP.
- Apunta a `http://127.0.0.1:8000`.
- No se observa integración fuerte desde rutas Next.js o UI.
- En producción Vercel, `127.0.0.1:8000` no resolverá salvo que el quant-engine esté desplegado en el mismo entorno, lo cual no es el caso normal.

Acción:

- Crear `QUANT_ENGINE_URL`.
- Crear route handler Node.js como proxy seguro.
- No llamar FastAPI directo desde el cliente.
- Agregar secreto interno.

Criterio de aceptación:

```text
Frontend -> Next.js API -> Quant Engine -> respuesta -> Supabase/UI
```

### P1.2 Edge Runtime en `/api/signals`

Problema:

- Ruta usa Supabase SSR y cookies.
- Ya hubo problemas de auth en Vercel.
- Edge puede complicar cookies y librerías.

Acción:

- Probar en Vercel.
- Si hay fallo, mover a Node.js.
- Mantener header JWT.

Criterio de aceptación:

- Login real en Vercel.
- Guardar señal real.
- Refrescar y ver señal persistida.
- No error 401 fantasma.

### P1.3 Graham tiene criterio no canónico

Problema:

- Umbral de deuda contradictorio.
- Puede aprobar activos que deberían rechazarse.

Acción:

- Definir reglas Graham.
- Centralizar configuración.
- Testear.

Criterio de aceptación:

- Un solo criterio documentado.
- Tests unitarios.
- UI muestra motivo de rechazo/aprobación.

### P1.4 FastAPI inseguro para producción

Problema:

- CORS abierto.
- Sin auth interna.
- Sin rate limiting.

Acción:

- Restringir `allow_origins`.
- Agregar `QUANT_ENGINE_SECRET`.
- Validar headers.
- Agregar logs.

### P1.5 Alpha Vantage / Finnhub aparecen como configurados, pero no implementados

Problema:

- Documentos los mencionan.
- Código principal usa Yahoo Finance.
- No hay integración real observada.

Acción:

- Decidir si serán parte del MVP.
- Si no, quitar de docs.
- Si sí, implementar wrappers y tests.

---

## P2 — Mejoras importantes después de estabilizar

### P2.1 Realtime real

Problema:

- La visión habla de tiempo real, WebSockets, SSE o Supabase Realtime.
- Debe validarse qué existe realmente.

Acción:

- Definir una estrategia:
  - Supabase Realtime para señales persistidas.
  - SSE para progreso de análisis.
  - Polling controlado solo si no hay alternativa.

### P2.2 Portfolio analytics

Problema:

- El dashboard y portfolio existen como módulos, pero el análisis de riesgo de cartera no está cerrado.

Acción:

- Calcular:
  - exposición por sector.
  - drawdown.
  - VaR de cartera.
  - correlación.
  - concentración.
  - rendimiento histórico.
  - riesgo por posición.

### P2.3 Screener real

Problema:

- Screener existe como UI/estructura.
- Falta validar backend real.

Acción:

- Crear endpoint de screener.
- Integrar filtros:
  - técnicos.
  - fundamentales.
  - Graham.
  - volatilidad.
  - liquidez.
  - market regime.

### P2.4 XAI real

Problema:

- `shap` está en requirements.
- No hay evidencia de SHAP/LIME real integrado.

Acción:

- Implementar solo cuando exista modelo entrenado/validado.
- Mientras tanto, usar explicación determinística honesta.

### P2.5 Autoencoder real

Problema:

- El nombre existe, pero no el modelo.

Acción:

- No implementar autoencoder hasta tener dataset claro.
- Si se mantiene PCA, renombrar para no engañar.

### P2.6 UX anti-FOMO / Graham

Problema:

- La visión es buena, pero no debe distraer de la estabilización.

Acción:

- Después de cerrar señales reales:
  - alertas de riesgo.
  - confirmaciones críticas.
  - modo Mr. Market.
  - explicación del margen de seguridad.

---

## 9. Plan de estabilización recomendado

## Fase 1 — Congelar verdad del proyecto

Objetivo:

Evitar que Antigravity siga construyendo sobre supuestos falsos.

Tareas:

1. Agregar este archivo al root como `ANTIGRAVITY_CONTEXT.md`.
2. Actualizar `AGENTS.md` para indicar lectura obligatoria.
3. Agregar nota al inicio de `GEMINI.md`:

```md
Este archivo describe la visión objetivo. No representa necesariamente el estado real implementado.
Antes de implementar, leer ANTIGRAVITY_CONTEXT.md y ESTADO_ACTUAL_PROYECTO.md.
```

4. Agregar nota al inicio de `MEMORY.md`:

```md
Este archivo contiene memoria y filosofía. No debe usarse como auditoría técnica final.
```

5. Reemplazar README cuando el estado técnico esté estabilizado.

Criterio de aceptación:

- Cualquier agente sabe qué archivo manda para cada tipo de verdad.

---

## Fase 2 — Verificación local mínima

Objetivo:

Que el repo tenga una forma clara de demostrar si funciona.

Tareas:

1. Agregar `npm run typecheck`.
2. Agregar `npm run verify`.
3. Crear tests mínimos para:
   - `/api/signals`.
   - `/api/trading`.
   - `mcp-client`.
4. Crear `pytest` para:
   - `graham_filters.py`.
   - `risk_models.py`.
   - `ml_pipeline.py`.
   - `lean_integration.py`.

Comandos mínimos:

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

```bash
cd quant-engine
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m pytest
```

Criterio de aceptación:

- No hay cambios funcionales sin `verify`.

---

## Fase 3 — Conectar Next.js con Quant Engine

Objetivo:

Cerrar el puente real entre SaaS y Python.

Arquitectura recomendada:

```text
Browser
  -> Next.js API Route Node.js
    -> FastAPI quant-engine
      -> yfinance/modelos/Graham
    -> Next.js API
  -> Supabase
  -> UI
```

Tareas:

1. Crear variable:

```text
QUANT_ENGINE_URL
QUANT_ENGINE_SECRET
```

2. Crear ruta:

```text
src/app/api/quant/analyze/route.ts
```

3. Esta ruta debe:
   - Validar usuario.
   - Validar ticker.
   - Llamar a FastAPI.
   - Manejar timeout.
   - Manejar errores.
   - Registrar audit log.
   - Devolver respuesta normalizada.

4. Modificar UI para llamar a Next.js, no a FastAPI directo.

Criterio de aceptación:

```bash
curl -X POST /api/quant/analyze -d '{"symbol":"SPY"}'
```

debe devolver:

```json
{
  "symbol": "SPY",
  "graham": {},
  "regime": {},
  "risk": {},
  "prediction": {},
  "decision": {},
  "evidence": {}
}
```

---

## Fase 4 — Reemplazar `/api/trading`

Objetivo:

Eliminar aleatoriedad y convertirlo en motor real o wrapper de señal.

Tareas:

1. Eliminar `Math.random()`.
2. Llamar a `/api/quant/analyze` o lógica interna.
3. Persistir señal real en Supabase.
4. Agregar estado:
   - `draft`.
   - `validated`.
   - `rejected`.
   - `backtested`.
5. Agregar explicación.
6. Agregar test.

Criterio de aceptación:

- Dos llamadas con el mismo input y datos congelados deben devolver resultado reproducible.
- No debe existir señal aleatoria.
- Si falla quant-engine, debe devolver error controlado.

---

## Fase 5 — Cerrar QuantConnect

Objetivo:

Validar si las señales sirven antes de confiar en ellas.

Tareas:

1. Validar Lean CLI:
   - instalado.
   - en PATH.
   - autenticado.
2. Implementar `run_lean_backtest`.
3. Crear estructura de proyecto LEAN compatible.
4. Exportar algoritmo.
5. Ejecutar backtest local.
6. Guardar resultados.
7. Parsear métricas.
8. Mostrar resumen en UI.

Métricas mínimas:

- CAGR.
- Sharpe.
- Max Drawdown.
- Win rate.
- Total trades.
- Profit/Loss.
- Exposure.
- Fees si aplica.

Criterio de aceptación:

- Un ticker puede pasar de señal a backtest.
- El resultado queda guardado.
- La UI muestra si el algoritmo fue rentable o no.
- No se afirma efectividad sin backtest.

---

## Fase 6 — Endurecimiento de producción

Objetivo:

Que Vercel, Supabase y Quant Engine funcionen como sistema.

Tareas:

1. Revisar runtimes:
   - rutas con Supabase SSR: preferir Node.js salvo prueba Edge.
   - rutas IA/quant: Node.js si usan librerías no Edge-compatible.
2. Rate limiting.
3. Logging estructurado.
4. Audit logs.
5. Manejo de errores.
6. Health checks:
   - `/api/health`
   - `/api/quant/health`
   - `/api/supabase/health`
7. Variables de entorno documentadas.
8. Deploy validado.

Criterio de aceptación:

```bash
npm run verify
vercel deploy --prod --project trademind-cv --scope cataldo89-1519s-projects
```

y pruebas manuales posteriores.

---

## 10. Checklist operativo para Antigravity

Antes de modificar código:

```text
[ ] Leer AGENTS.md
[ ] Leer ANTIGRAVITY_CONTEXT.md
[ ] Leer ESTADO_ACTUAL_PROYECTO.md
[ ] Leer soluciones_tecnicas.md
[ ] Identificar si la tarea toca Vercel, Supabase, Quant Engine o QuantConnect
[ ] Declarar qué archivos se van a modificar
[ ] No afirmar implementación sin prueba
```

Durante la implementación:

```text
[ ] No tocar .env con secretos
[ ] No crear proyecto nuevo en Vercel
[ ] No borrar fallback JWT Authorization
[ ] No usar Math.random() para señales
[ ] No exponer SUPABASE_SERVICE_ROLE_KEY al cliente
[ ] No exponer QUANT_ENGINE_SECRET al cliente
[ ] No usar 127.0.0.1 en producción salvo entorno local explícito
[ ] No marcar LangGraph como implementado si el workflow sigue siendo vanilla Python
[ ] No llamar Autoencoder a PCA
[ ] No afirmar QuantConnect funcional sin lean whoami + lean backtest
```

Después de implementar:

```text
[ ] Ejecutar npm run lint
[ ] Ejecutar npm run typecheck
[ ] Ejecutar npm run build
[ ] Ejecutar tests Python
[ ] Probar endpoint afectado con curl o script
[ ] Adjuntar salida de consola
[ ] Actualizar documentación solo con hechos comprobados
```

---

## 11. Definition of Done general

Una tarea no está terminada hasta cumplir:

```text
[ ] Código implementado
[ ] Sin mocks ocultos
[ ] Sin datos aleatorios
[ ] Manejo de errores
[ ] Test o prueba CLI
[ ] Evidencia de ejecución
[ ] Documentación actualizada
[ ] No rompe Vercel/Supabase/QuantConnect
```

Para tareas de señal/trading:

```text
[ ] Usa datos reales
[ ] Aplica filtro Graham o declara por qué no aplica
[ ] Calcula riesgo
[ ] Genera explicación
[ ] Persiste resultado
[ ] Puede backtestearse
[ ] Resultado reproducible
```

Para tareas QuantConnect:

```text
[ ] Lean CLI disponible
[ ] Credenciales válidas
[ ] Algoritmo exportado
[ ] Backtest ejecutado
[ ] Métricas parseadas
[ ] Resultado visible para SaaS
```

---

## 12. Prompt recomendado para iniciar Antigravity

Copiar y pegar:

```text
Trabaja en modo planificación primero.

Antes de modificar código, lee estos archivos en este orden:
1. AGENTS.md
2. ANTIGRAVITY_CONTEXT.md
3. ESTADO_ACTUAL_PROYECTO.md
4. soluciones_tecnicas.md
5. package.json
6. src/app/api/**
7. quant-engine/**
8. supabase/schema.sql si existe

Objetivo:
Estabilizar TradeMind como full stack real, no seguir agregando arquitectura aspiracional.

Reglas:
- No afirmes que algo está implementado si no lo verificaste en código o CLI.
- No uses Math.random() para señales.
- No marques QuantConnect como funcional sin lean whoami y lean backtest.
- No llames Autoencoder a PCA.
- No asumas que LangGraph existe si agents/graph.py sigue siendo workflow vanilla Python.
- Mantén las reglas de Vercel de AGENTS.md.
- Mantén el patrón de autenticación con Authorization Bearer documentado en soluciones_tecnicas.md.
- No expongas secretos al cliente.

Primera tarea:
Haz una auditoría de brechas ejecutable y crea un plan de estabilización por fases. Después implementa primero el P0 más crítico: reemplazar o deshabilitar /api/trading mock y preparar la integración real con quant-engine.
```

---

## 13. Recomendación final de gobierno documental

No conviene que este archivo reemplace todo.

Conviene que cumpla este rol:

```text
AGENTS.md                  -> reglas operativas/deploy
ANTIGRAVITY_CONTEXT.md     -> verdad operativa para agentes
ESTADO_ACTUAL_PROYECTO.md  -> auditoría técnica actual
ESTRUCTURA_PROYECTO.md     -> mapa de carpetas
GEMINI.md                  -> visión futura
MEMORY.md                  -> filosofía/memoria histórica
soluciones_tecnicas.md     -> errores resueltos y patrones técnicos
```

La mejora más importante es que ningún agente vuelva a confundir visión con implementación.

Si Antigravity va a trabajar de forma continua, este archivo debe estar en la raíz del repo y debe ser leído siempre antes de tocar código.
