# FASES_F0_F6.md

## Mensaje para Antigravity — Modo Codificación

Actúa como agente senior full-stack, DevOps y quant engineer. Debes trabajar directamente sobre el repo `cataldo89/trademind` y dejar el proyecto listo para producción en Vercel, con el frontend Next.js, Supabase, quant-engine Python/FastAPI, modelos SARIMA/ARIMA/GARCH/HMM/PCA/Lasso/Graham y conexión real con QuantConnect/LEAN.

No declares nada como terminado si no fue implementado, probado y validado por comandos reales.

---

# F0 — Auditoría inicial obligatoria

Antes de modificar código, leer en este orden:

1. `ANTIGRAVITY_CONTEXT.md`
2. `AGENTS.md`
3. `ESTADO_ACTUAL_PROYECTO.md`
4. `ESTRUCTURA_PROYECTO.md`
5. `soluciones_tecnicas.md`
6. `README.md`
7. `package.json`
8. `src/app/api/trading/route.ts`
9. `src/lib/ai/mcp-client.ts`
10. `src/app/api/signals/route.ts`
11. `quant-engine/main.py`
12. `quant-engine/risk_models.py`
13. `quant-engine/graham_filters.py`
14. `quant-engine/ml_pipeline.py`
15. `quant-engine/lean_integration.py`
16. `quant-engine/agents/graph.py`

Crear o actualizar un archivo `FASES_F0_F6.md` con checklist real de avance.

Validar primero:

```bash
npm install
npm run lint
npm run typecheck
npm run build
cd quant-engine
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m compileall .

No avanzar a producción si estos comandos fallan.

F1 — Producción Vercel sin romper proyecto oficial

El proyecto Vercel oficial es:

Proyecto: trademind-cv
Scope: cataldo89-1519s-projects
URL: https://trademind-cv.vercel.app

Reglas obligatorias:

No crear proyecto nuevo en Vercel.
No usar otro scope.
No desplegar sin verificar .vercel/project.json.
No usar --yes si no está confirmado el proyecto correcto.

Validar:

type .vercel\project.json
vercel link --project trademind-cv --scope cataldo89-1519s-projects
vercel env pull .env.local
npm run verify
vercel deploy --prod --project trademind-cv --scope cataldo89-1519s-projects

Variables obligatorias en Vercel:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
ALPHA_VANTAGE_API_KEY=
QUANT_ENGINE_URL=
QUANT_ENGINE_SECRET=
QUANT_ENGINE_AUTH_DISABLED=false

Si QUANT_ENGINE_URL no existe en producción, /api/trading debe responder error controlado y no simular señales.

F2 — Reparar /api/trading como orquestador real

Archivo principal:

src/app/api/trading/route.ts

Objetivo:

Convertir /api/trading en un endpoint real que llame al quant-engine, reciba señal cuantitativa, valide resultado y persista en Supabase.

Debe hacer:

Validar symbol.
Validar usuario si la señal se guardará por usuario.
Llamar a mcpClient.runWorkflow(symbol).
Recibir:
acción: BUY, SELL, HOLD
confianza
explicación
régimen HMM
retorno esperado ARIMA/SARIMA
VaR GARCH
resultado Graham
estado QuantConnect si aplica
Persistir señal en tabla signals o ai_signals, según schema real.
Eliminar cualquier uso de Math.random().
No devolver señal ficticia si falla el motor cuantitativo.

Respuesta mínima esperada:

{
  "success": true,
  "signal": {
    "symbol": "AAPL",
    "action": "HOLD",
    "label": "MANTENER",
    "confidence": 62,
    "price": 190.25,
    "reasoning": "Explicación cuantitativa",
    "models": {
      "graham": {},
      "hmm": {},
      "garch": {},
      "arima": {},
      "sarima": {},
      "quantconnect": {}
    }
  }
}

Si falla:

{
  "success": false,
  "status": "quant_engine_unavailable",
  "message": "Quant engine is unavailable or not configured."
}
F3 — Robustecer quant-engine

Archivos:

quant-engine/main.py
quant-engine/risk_models.py
quant-engine/graham_filters.py
quant-engine/ml_pipeline.py
quant-engine/agents/graph.py

Mantener FastAPI con seguridad:

QUANT_ENGINE_SECRET=
QUANT_ENGINE_AUTH_DISABLED=false
QUANT_ENGINE_ALLOWED_ORIGINS=http://localhost:3000,https://trademind-cv.vercel.app

Validar header:

X-TradeMind-Quant-Secret

Agregar endpoints mínimos:

GET  /health
POST /workflow/analyze
POST /mcp/tools/get_market_regime
POST /mcp/tools/calculate_var
POST /mcp/tools/check_graham_filters
POST /ml/predict_direction
POST /ml/predict_sarima
POST /lean/backtest

Agregar manejo robusto:

ticker inválido
datos vacíos de yfinance
NaN
errores de statsmodels
errores de arch
errores de hmmlearn
timeout
respuesta normalizada
F4 — Implementar SARIMA y ordenar ARIMA/MARIMA

Archivo sugerido:

quant-engine/time_series_models.py

Mover o complementar lógica desde risk_models.py.

Implementar:

predict_direction_arima(symbol: str)
predict_direction_sarima(symbol: str)
predict_direction_marima(symbols: list[str])

Criterio:

ARIMA: univariado simple.
SARIMA: estacionalidad básica con SARIMAX.
MARIMA: si no existe MARIMA formal en librería estándar, implementarlo como modelo multivariable tipo VARMAX o dejarlo documentado como not_implemented sin mentir.

No hardcodear confianza fija 0.55.

La confianza debe derivarse de validación mínima, por ejemplo:

error histórico rolling
dirección acertada
estabilidad del forecast
cantidad de datos disponibles

Respuesta esperada:

{
  "model": "SARIMA",
  "symbol": "AAPL",
  "expected_return": 0.012,
  "predicted_price": 192.4,
  "last_price": 190.1,
  "confidence": 0.61,
  "diagnostics": {
    "samples": 252,
    "order": [1,1,1],
    "seasonal_order": [1,1,1,5],
    "validation_method": "rolling_backtest"
  }
}
F5 — QuantConnect / LEAN real

Archivo principal:

quant-engine/lean_integration.py

Actualmente no basta con lean whoami. Debe ejecutar backtest real.

Implementar:

Validar CLI:
lean --version
lean whoami
Validar credenciales:
QC_USER_ID=
QC_API_TOKEN=
Crear workspace LEAN si no existe.
Exportar algoritmo a carpeta controlada.
Ejecutar backtest:
lean backtest
Capturar:
stdout
stderr
exit code
statistics
result json
equity curve si existe
Exponer endpoint:
POST /lean/backtest

Payload:

{
  "symbol": "AAPL",
  "parameters": {
    "rsi_period": 14,
    "var_threshold": 0.05
  }
}

Respuesta:

{
  "success": true,
  "status": "completed",
  "statistics": {
    "sharpe_ratio": null,
    "drawdown": null,
    "net_profit": null,
    "win_rate": null
  },
  "raw_path": "..."
}

Si LEAN no está instalado o autenticado:

{
  "success": false,
  "status": "lean_not_ready",
  "message": "Lean CLI is not installed or authenticated."
}

No afirmar QuantConnect funcional si no existe backtest ejecutado y parseado.

F6 — Tests, verificación final y deploy

Agregar tests mínimos.

Frontend / Next.js:

npm run lint
npm run typecheck
npm run build
npm run verify

Python:

cd quant-engine
python -m compileall .
python -m pytest

Crear si no existen:

quant-engine/tests/test_graham_filters.py
quant-engine/tests/test_risk_models.py
quant-engine/tests/test_time_series_models.py
quant-engine/tests/test_lean_integration.py

Tests mínimos:

ticker inválido no rompe API
Graham rechaza P/E inválido
Graham rechaza Debt/Asset > 0.50
ARIMA devuelve respuesta normalizada
SARIMA devuelve respuesta normalizada o error controlado
MARIMA/VARMAX no miente si no hay datos suficientes
GARCH devuelve VaR válido
HMM devuelve régimen o Unknown
LEAN devuelve lean_not_ready si no está configurado
/api/trading no genera señal aleatoria
/api/trading falla controlado si QUANT_ENGINE_URL falta

Deploy final:

npm run verify
vercel deploy --prod --project trademind-cv --scope cataldo89-1519s-projects

Al finalizar, actualizar FASES_F0_F6.md con:

[OK] Implementado
[OK] Probado
[OK] Build exitoso
[OK] Deploy producción
[URL] https://trademind-cv.vercel.app
Resultado esperado final

El repo debe quedar con:

Next.js build limpio.
Vercel producción apuntando a trademind-cv.
/api/trading sin mocks.
mcp-client.ts usando QUANT_ENGINE_URL y QUANT_ENGINE_SECRET.
quant-engine con auth interna.
Graham corregido con Debt/Asset máximo 0.50.
ARIMA sin confianza hardcodeada.
SARIMA implementado.
MARIMA/VARMAX implementado o declarado honestamente como no disponible.
QuantConnect/LEAN con diagnóstico real y backtest real si CLI/credenciales existen.
Tests mínimos.
README y docs actualizados sin afirmar funcionalidades falsas.

No cierres la tarea si falta evidencia de ejecución.