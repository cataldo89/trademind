# TradeMind: Memoria Central e "Inspiración Titanes"

> **ADVERTENCIA:** Este archivo representa la memoria histórica, la filosofía de diseño y la visión del producto. **NO ES LA FUENTE CANÓNICA DEL ESTADO ACTUAL DEL CÓDIGO**. Para ver qué funciona realmente, lee `ESTADO_ACTUAL_PROYECTO.md`.

Este archivo (`MEMORY.md`) actúa como la memoria central para cualquier IA (Agent) que trabaje en este repositorio. Define el estado del arte del proyecto, hacia dónde vamos y, lo más importante, la filosofía fundamental bajo la cual está construido.

## Filosofía: Inspiración "Titanes" + "Fazt Tech Pragmatism"

El desarrollo de TradeMind se rige por las lecciones de tres pilares:
1. **Estética y Experiencia (La Visión de Jobs)**: Democratizamos el trading institucional mediante un diseño *premium*, interfaces de cristal (*glassmorphism*), tipografía cuidada y un modo oscuro pulido. No aceptamos "cajas beige".
2. **Escalabilidad y Dominio (El Motor de Gates)**: Debajo de la hermosa interfaz, el código maneja alto volumen y procesamiento concurrente, replicando el dominio absoluto del software.
3. **Pragmatismo Moderno (La Filosofía Fazt Tech)**: Priorizamos la Experiencia del Desarrollador (DX) y la separación de conceptos. Usamos tipado estricto (TypeScript), estado ligero (Zustand), y desacoplamos completamente la lógica pesada (IA) delegándola a Next.js API Routes y funciones Server-Side. Además, maximizamos las capacidades modernas de bases de datos utilizando Supabase Realtime (WebSockets) en lugar de hacer polling ineficiente desde el cliente.

## Estado del Arte Actual (Full Stack)

- **Frontend**: Next.js (App Router), React, Tailwind CSS (configurado con variables para un modo oscuro elegante).
- **Backend/Base de Datos**: Supabase (PostgreSQL), integrado con llaves públicas y de *service role* en `.env.local`.
- **APIs Financieras**: Alpha Vantage y Finnhub: planeadas en configuración (aún no operativas end-to-end).
- **Componentes Base**: Existen estructuras en `src/components/` para análisis, dashboard, layout, alertas y señales, pero aún falta inyectarles los datos en tiempo real y la lógica de IA algorítmica.

## Qué es lo que viene (Roadmap Inmediato)

1. **Flujo y Espacio de Trabajo Zesty (Implementado y en iteración)**: Se implementó un `ZestyWorkspace` que agrupa automáticamente los más de 400 activos de inversión en categorías exactas basadas en los antecedentes de Zesty (ej. IA, ETFs Apalancados, Semiconductores, Biotecnología). Este es el flujo de trabajo principal de análisis.
2. **Rediseño Arquitectónico Visual**: Descomponer la Landing Page en componentes de alto impacto (Hero, Features, Vision) aplicando la filosofía de los "Titanes".
3. **Monitoreo en Tiempo Real**: Refinar la fiabilidad de `CandlestickChart` y la ingesta de velas para la nueva organización categórica.
4. **Algoritmo de Trading con IA Automático (Visión/Mocks)**: Existe un endpoint `/api/ai/analyze` integrado con Google Gemini 2.5 que usa reglas básicas y datos públicos. El siguiente paso aspiracional es implementar **RAG (Retrieval-Augmented Generation)** subiendo documentos financieros locales como fuente de verdad para el agente, replicando el comportamiento experto de un NotebookLM. Actualmente esto es una visión, no una implementación activa validada contra el motor cuantitativo.
5. **Infraestructura Cloud CI/CD**: Despliegue gestionado mediante Vercel y Supabase. Se han implementado soluciones a prueba de balas para el manejo de JWTs y fallos de autenticación entre Next.js y Supabase.

## Arquitectura de Datos Zesty
- La categorización de los símbolos ocurre en `src/lib/market-data.ts`, la cual se alimenta de los símbolos en `ZESTY_SYMBOLS` pero los devuelve mapeados según las categorías exactas de los PDFs de antecedentes.
- El componente principal de análisis técnico es `ZestyWorkspace`, que divide la UI en: Panel de Categorías, Panel de Símbolos, y Gráfico en Tiempo Real.

## Directivas para Agentes IA
- Si editas la UI, asegúrate de mantener animaciones sutiles y estilos de *Glassmorphism* y gradientes oscuros.
- Si editas el backend o la IA algorítmica, asegúrate de que el código sea eficiente, no bloqueante, y documentado de forma que la modularidad no se pierda.
- **Nunca asumas** que un componente simple de React es suficiente: TradeMind busca la perfección técnica y visual.
