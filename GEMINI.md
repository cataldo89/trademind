# TradeMind SaaS 2026 - Guía de Desarrollo "Agent-First"

Esta guía define la arquitectura, convenciones de código y estándares de seguridad para la evolución de TradeMind hacia una plataforma SaaS "AI-Native", basada en principios de finanzas cuantitativas y la psicología de inversión de Benjamin Graham.

## 1. Arquitectura AI-Native e Interoperabilidad

- **Single Pane of AI**: La interfaz de usuario debe priorizar el lenguaje natural y el uso de "Artifacts" dinámicos en lugar de dashboards estáticos. El objetivo es lograr una orquestación de inteligencia fluida.
- **MCP (Model Context Protocol)**: Todos los recursos clave (estado de la cartera, señales de Candle Range Theory - CRT) deben exponerse como herramientas a través de un servidor MCP nativo.
- **Infraestructura de Agentes**: Utilizar LangGraph (o LangGraph.js) para establecer un clúster multi-agente con memoria persistente y estados de ejecución. Roles sugeridos: `Research Manager`, `Technical Analyst`, `Risk Manager`.
- **Edge AI**: Las APIs de señales en tiempo real deben configurarse para ejecutarse en el borde (Edge Runtime) para garantizar la mínima latencia.

## 2. Núcleo Cuantitativo y Algorítmico (Pipeline DS/ML)

Todo nuevo módulo cuantitativo debe implementarse o integrarse respetando los siguientes estándares:
- **Reducción de Ruido**: Uso estricto de PCA (Análisis de Componentes Principales) o Autoencoders antes de pasar la data a los modelos predictivos, para filtrar señales espurias.
- **Selección de Factores**: Aplicar regularización Lasso (L1) y Ridge (L2) para descartar indicadores técnicos redundantes.
- **Predicción y Riesgo**:
  - Modelos ARIMA/SARIMA para la predicción de dirección del mercado.
  - Modelos GARCH(1,1) para la estimación dinámica de volatilidad y el cálculo de VaR (Value at Risk).
- **Detección de Regímenes**: Utilizar Hidden Markov Models (HMM) para clasificar el régimen de mercado (Bull, Bear, Sideways) y ajustar la agresividad operativa en consecuencia.

## 3. Capa de Simulación y Validación (QuantConnect)

- **Sincronización con LEAN**: Se debe mantener una abstracción clara (puente de datos) para exportar las señales generadas en el SaaS hacia QuantConnect, posibilitando simulaciones de papel y backtesting.
- **Calibración Dinámica**: Implementar Algoritmos Genéticos (GA) para optimizar en segundo plano los hiperparámetros de las señales CRT específicos por activo.

## 4. Psicología de Graham y UX Predictiva

- **Margin of Safety**: Codificar filtros duros obligatorios (ej. Debt-to-Asset < 1.10, P/E moderado) basados en Benjamin Graham. Ninguna señal de compra debe generarse si no se aprueba este filtro.
- **Nudges de Disciplina**: La UI debe intervenir proactivamente para mitigar sesgos (anti-FOMO, anti-revenge trading).
- **Modo "Mr. Market"**: Implementar un modo de visualización que oculte las fluctuaciones de precio a corto plazo y resalte únicamente métricas de valor intrínseco.
- **Explainable AI (XAI)**: Toda recomendación del sistema debe ir acompañada de una justificación transparente (usando SHAP o LIME subyacente), por ejemplo: "Señal de compra: 40% atribuido a liquidez histórica".

## 5. Reglas de Código y Seguridad

- **Tipado Estricto**: TypeScript debe utilizarse de forma estricta. Todo modelo de datos debe ser validado con Zod en la capa de API.
- **Variables de Entorno**: Segregar las claves (OpenAI, Gemini, Supabase, QuantConnect) y nunca exponer secretos del servidor al cliente.
- **Latencia**: Cualquier cálculo pesado que exceda 1 segundo debe encolarse de manera asíncrona o procesarse en Python, devolviendo un estado o utilizando WebSockets/Server-Sent Events para actualizar el cliente.
