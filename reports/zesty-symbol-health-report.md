# Reporte de Cobertura y Salud de Activos (Screener)

Generado el: 15/6/2026, 19:56:44 (Eastern Time)
Fuente: Yahoo Finance (Llamadas en vivo a API)

## Resumen Ejecutivo

| Métrica | Valor | Descripción |
|---|---|---|
| **Total Activos Declarados** | 473 | Cantidad total en el arreglo `ZESTY_SYMBOLS` |
| **Total Activos Únicos** | 473 | Excluyendo duplicados |
| **Total Activos Válidos** | 433 | Tienen Quote y Candles de 1M suficientes (>=10) |
| **Total Activos Normalizados** | 1 | Requieren sustitución de punto por guión (ej. `BRK.B` -> `BRK-B`) |
| **Total Activos Sin Quote** | 24 | Yahoo no los reconoce o no tienen cotización |
| **Total Activos Sin Velas Suficientes** | 16 | Tienen Quote pero no historial de velas (>10) |
| **Total Activos Duplicados** | 0 | Declarados múltiples veces |

---

## Duplicados Detectados
No se detectaron símbolos duplicados.

---

## Activos Normalizados (Puntos a Guiones)
Los siguientes activos requieren ser mapeados a formato de guión en Yahoo Finance:
- `BF.B` -> normalizado como `BF-B` en Yahoo

---

## Listado de Símbolos Problemáticos (Inválidos o Datos Insuficientes)
Estos símbolos causarán fallas o se saltarán en el motor cuántico, por lo que deberían limpiarse o revisarse:

| Símbolo | Nombre | Categoría | Tipo | Subtipo | Razón de Falla |
|---|---|---|---|---|---|
| `AMOMX` | AQR Momentum Fund | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `CHILE` | Banco de Chile | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `BSANTANDER` | Banco Santander-Chile | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CAMPOS` | Sociedad de Inversiones Campos Chilenos S.A. | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIBPDCCHA` | BTG Deuda Corporativa Chile | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIBTETFMP` | BTG ETF Renta Fija Chile Mediano Plazo | `chile` | ETF | Estándar | Sin Quote (Error: Desconocido) |
| `CFIETFCC` | Singular Chile Corporativo | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIETFCD` | Singular Chile Corta Duracion | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIETFLP` | Singular Chile Largo Plazo | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIETFRFLP` | BTG ETF Renta Fija Chile Largo Plazo | `chile` | ETF | Estándar | Sin Quote (Error: Desconocido) |
| `CFIFALCDCG` | Falcom Deuda Corporativa Chile | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIFALCDCW` | Falcom Deuda Corporativa Chile - Serie W | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIFALCFIW` | Falcom Chilean Fixed Income | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIFALCTAC` | Falcom Tactical Chilean Equities | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIFYNSADB` | Fynsa Deuda Chile | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFIMDCHA` | Moneda deuda Chile, FI | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CFMTOEEQUB` | Toesca Chile Equities FM | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CHWAF` | Chilwa Minerals Ltd Ordinary Fully Paid | `chile` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `DAY` | Ceridian HCM Holding | `otros` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CMA` | Comerica | `otros` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `CLDL` | Direxion Daily Cloud Computing Bull 2X Shares | `otros` | ETF | Apalancado | Velas insuficientes (Contadas: 0) |
| `QQAD` | Direxion Daily Concentrated Qs Bear 1X Shares | `otros` | ETF | Inverso | Sin Quote (Error: Desconocido) |
| `XXCH` | Direxion Daily MSCI Emerging Markets ex China Bull 2X | `otros` | ETF | Apalancado | Velas insuficientes (Contadas: 0) |
| `OOTO` | Direxion Daily Travel & Vacation Bull 2X Shares | `otros` | ETF | Apalancado | Velas insuficientes (Contadas: 0) |
| `FTEXX` | Fidelity Municipal Money Market Fund | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 1) |
| `FSHX` | Fidelity Spartan International Index Fund | `otros` | ETF | Estándar | Sin Quote (Error: Desconocido) |
| `FRXIX` | Fidelity Spartan Real Estate Index Fund | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `FSTMX` | Fidelity Spartan Total Index | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `FLHK` | Franklin FTSE Hong Kong ETF | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `EWRI` | Guggenheim Russell 1000 Equal Weight ETF | `otros` | ETF | Estándar | Sin Quote (Error: Desconocido) |
| `ICP` | iShares Cohen & Steers REIT ETF | `otros` | ETF | Estándar | Sin Quote (Error: Desconocido) |
| `IBTE` | iShares iBonds Dec 2024 Term Treasury ETF | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `KALL` | KraneShares MSCI All China Index ETF | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `AFTY` | Pacer CSOP FTSE China A50 ETF | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `PARA` | Paramount Global-Class B | `otros` | Acción | Ordinaria | Sin Quote (Error: Desconocido) |
| `SWRXX` | Schwab Total Stock Market Index | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `SPCX` | Space Exploration Technologies Corp. Class A | `acciones-pop` | Acción | Ordinaria | Velas insuficientes (Contadas: 2) |
| `TWOK` | SPDR Russell 2000 | `otros` | Acción | Ordinaria | Velas insuficientes (Contadas: 0) |
| `VDAIX` | Vanguard Dividend Appreciation Index Fund | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |
| `VTWSX` | Vanguard Total World Stock Index | `otros` | ETF | Estándar | Velas insuficientes (Contadas: 0) |

---

## Recomendaciones para la Limpieza del Universo

1. **Eliminar Duplicados**: Limpiar los símbolos duplicados del archivo `market-data.ts`.
2. **Normalización por Defecto**: Asegurarse de que el backend de Next.js y el motor de Python siempre reemplacen `.` por `-` para todas las llamadas a Yahoo Finance de forma automática (esto ya está implementado en las funciones de normalización pero debe asegurarse en el flujo completo).
3. **Remover Símbolos Inexistentes**: Eliminar del archivo `src/lib/market-data.ts` los símbolos listados arriba que devuelven error de Quote, ya que corresponden a activos deslistados o mal escritos en las fuentes originales.
4. **Pestañas del Screener**: Utilizar solo la lista de símbolos válidos para evitar llamadas innecesarias a Yahoo Finance.
