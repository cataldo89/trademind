from typing import Any, Dict, TypedDict

# Define agent state
class AgentState(TypedDict, total=False):
    symbol: str
    graham_passed: bool
    graham_reason: str
    market_regime: str
    ml_prediction: float
    var_95: float
    action: str
    label: str
    confidence: int
    xai_explanation: str
    youtube_signal: str
    youtube_reason: str
    market_data_quality: Dict[str, Any]
    provider_fallback: Dict[str, Any]
    signal_quality: Dict[str, Any]
    robust_backtest: Dict[str, Any]
    portfolio_risk: Dict[str, Any]
    data_status: str

def market_data_quality_analyst(state: AgentState):
    from provider_fallback import resolve_provider_fallback

    fallback = resolve_provider_fallback(
        symbol=state["symbol"],
        market="US",
        timeframe="1d",
        range_="2y",
        required_use="ml",
    )
    quality = fallback.get("selected_quality") or {}
    state["provider_fallback"] = fallback
    state["market_data_quality"] = quality
    state["data_status"] = "usable" if quality.get("usable_for_ml") else "insufficient"
    return state

def apply_data_quality_block(state: AgentState):
    quality = state.get("market_data_quality") or {}
    reason = quality.get("recommendation") or "Datos de mercado insuficientes para ML."
    score = quality.get("quality_score", 0)
    state["graham_passed"] = False
    state["graham_reason"] = "No evaluado: datos de mercado insuficientes."
    state["market_regime"] = "Unknown"
    state["ml_prediction"] = 0.0
    state["var_95"] = 0.0
    state["youtube_signal"] = "NEUTRAL"
    state["youtube_reason"] = "Blocked by market_data_quality"
    state["news_sentiment"] = "NEUTRAL"
    state["news_articles"] = []
    state["action"] = "HOLD"
    state["label"] = "Sin conclusion / datos insuficientes"
    state["confidence"] = 0
    provider = (state.get("provider_fallback") or {}).get("selected_provider")
    provider_text = f" Provider seleccionado: {provider}." if provider else ""
    state["xai_explanation"] = f"Analisis bloqueado por market_data_quality (score {score}): {reason}{provider_text}"
    state["error_reason"] = state["xai_explanation"]
    state["data_status"] = "insufficient"
    state = apply_signal_quality(state)
    state = apply_robust_backtest(state)
    state = apply_portfolio_risk(state)
    return state

def apply_signal_quality(state: AgentState):
    from signal_quality import evaluate_signal_quality

    quality = state.get("market_data_quality") or {}
    fallback = state.get("provider_fallback") or {}
    signal = evaluate_signal_quality(
        symbol=state["symbol"],
        market="US",
        selected_provider=fallback.get("selected_provider") or quality.get("provider"),
        market_data_quality=quality,
        technical_indicators={
            "market_regime": state.get("market_regime"),
            "youtube_signal": state.get("youtube_signal"),
        },
        ml_prediction=state.get("ml_prediction", 0.0),
        risk_metrics={"var_95": state.get("var_95", 0.0)},
        graham_result={"passed": state.get("graham_passed"), "reason": state.get("graham_reason")},
        sentiment_result={"sentiment": state.get("news_sentiment", "NEUTRAL")},
        workflow_action=state.get("action", "HOLD"),
        workflow_confidence=int(state.get("confidence", 0) or 0),
        reasons=[state.get("xai_explanation", "")],
    )
    state["signal_quality"] = signal
    state["action"] = signal["final_action"]
    state["confidence"] = signal["final_confidence"]
    if signal["signal_status"] in {"BLOCKED", "CONFLICTED", "WEAK"}:
        state["label"] = {
            "BLOCKED": "Sin conclusion / senal bloqueada",
            "CONFLICTED": "Mantener / senal contradictoria",
            "WEAK": "Mantener / senal debil",
        }.get(signal["signal_status"], state.get("label", "MANTENER"))
    state["xai_explanation"] = f"{state.get('xai_explanation', '')} Signal quality: {signal['explanation']}".strip()
    if signal["signal_status"] == "BLOCKED":
        state["error_reason"] = state["xai_explanation"]
        state["data_status"] = "insufficient"
    return state

def apply_robust_backtest(state: AgentState):
    from robust_backtest import run_robust_backtest

    fallback = state.get("provider_fallback") or {}
    backtest = run_robust_backtest(
        symbol=state["symbol"],
        market="US",
        provider=fallback.get("selected_provider"),
        timeframe="1d",
        normalized_dataset=fallback.get("selected_dataset") or [],
        market_data_quality=state.get("market_data_quality") or {},
        signal_quality=state.get("signal_quality") or {},
        strategy_type="buy_and_hold",
        strategy_params={},
        fees=0.0005,
        slippage=0.0005,
    )
    state["robust_backtest"] = backtest
    status = backtest.get("backtest_status")
    if status in {"BLOCKED", "FAILED"}:
        state["action"] = "HOLD"
        state["confidence"] = 0 if status == "BLOCKED" else min(int(state.get("confidence", 0) or 0), 40)
        state["label"] = "Mantener / backtest no robusto"
    elif status == "WEAK":
        state["confidence"] = min(int(state.get("confidence", 0) or 0), 60)
        if state.get("action") == "BUY":
            state["label"] = "Comprar no confirmado / backtest debil"
    state["xai_explanation"] = f"{state.get('xai_explanation', '')} Robust backtest: {backtest.get('explanation')}".strip()
    return state

def apply_portfolio_risk(state: AgentState):
    from portfolio_risk_manager import evaluate_portfolio_risk

    portfolio = evaluate_portfolio_risk(
        symbol=state["symbol"],
        market="US",
        final_action=state.get("action", "HOLD"),
        signal_quality=state.get("signal_quality") or {},
        robust_backtest=state.get("robust_backtest") or {},
        current_price=None,
        portfolio_positions=None,
        cash_balance=None,
        account_equity=None,
        risk_profile="balanced",
    )
    state["portfolio_risk"] = portfolio
    if portfolio.get("portfolio_risk_status") == "BLOCKED":
        state["action"] = "HOLD"
        state["confidence"] = 0
        state["label"] = "Mantener / riesgo de cartera bloquea"
    elif portfolio.get("portfolio_risk_status") == "WARNING":
        state["confidence"] = min(int(state.get("confidence", 0) or 0), 60)
    state["xai_explanation"] = f"{state.get('xai_explanation', '')} Portfolio risk: {portfolio.get('explanation')}".strip()
    return state

def quality_allows_ml(quality: Dict[str, Any]) -> bool:
    return bool(quality.get("usable_for_ml")) and int(quality.get("quality_score") or 0) >= 60

def research_manager(state: AgentState):
    from graham_filters import check_margin_of_safety
    passed, reason = check_margin_of_safety(state["symbol"])
    state["graham_passed"] = passed
    state["graham_reason"] = reason
    return state

def technical_analyst(state: AgentState):
    try:
        from risk_models import detect_regime
        from time_series_models import predict_direction_arima
        regime = detect_regime(state["symbol"])
        prediction = predict_direction_arima(state["symbol"])
        state["market_regime"] = regime
        state["ml_prediction"] = prediction["expected_return"]
    except Exception as e:
        state["market_regime"] = "Desconocido"
        state["ml_prediction"] = 0
    return state

def risk_manager(state: AgentState):
    try:
        from risk_models import calculate_var_garch
        var_data = calculate_var_garch(state["symbol"], "1D")
        state["var_95"] = var_data.get("var_1d_95", 1)
    except Exception as e:
        state["var_95"] = 1
    return state

def youtube_analyst(state: AgentState):
    import os
    enabled = os.getenv("QUANT_ENGINE_ENABLE_YT", "false").lower() == "true"
    if not enabled:
        state["youtube_signal"] = "NEUTRAL"
        state["youtube_reason"] = "disabled"
        return state

    try:
        from youtuber_strategies import aggregate_youtube_signals
        yt_data = aggregate_youtube_signals(state["symbol"])
        state["youtube_signal"] = yt_data["overall"]
        state["youtube_reason"] = yt_data["reasons"]
    except Exception as e:
        state["youtube_signal"] = "NEUTRAL"
        state["youtube_reason"] = str(e)
    return state

def news_analyst(state: AgentState):
    try:
        from sentiment_models import get_cached_sentiment, analyze_sentiment_batch
        # Intentar desde cache primero
        sent = get_cached_sentiment(state["symbol"])
        if not sent:
            # Forzar análisis en vivo para este símbolo
            sent_dict = analyze_sentiment_batch([state["symbol"]])
            sent = sent_dict.get(state["symbol"])

        if sent:
            state["news_sentiment"] = sent.get("sentiment", "NEUTRAL")
            state["news_articles"] = sent.get("texts", [])
        else:
            state["news_sentiment"] = "NEUTRAL"
            state["news_articles"] = []
    except Exception as e:
        state["news_sentiment"] = "ERROR"
        state["news_articles"] = [f"Error leyendo noticias: {str(e)}"]
    return state

def decision_node(state: AgentState):
    quality = state.get("market_data_quality") or {}
    if quality and not quality_allows_ml(quality):
        return apply_data_quality_block(state)

    var_95 = state.get("var_95", 1)
    ml_pred = state.get("ml_prediction", 0)
    graham_passed = state.get("graham_passed", False)
    yt_signal = state.get("youtube_signal", "NEUTRAL")
    yt_reason = state.get("youtube_reason", "")

    # Base confidence calculation
    confidence = 50

    # Detect data errors or missing/incomplete fetches
    graham_reason = state.get('graham_reason', '')
    technical_missing = var_95 in (0, 1) and ml_pred == 0 and state.get('market_regime') in ("Unknown", "Desconocido")
    graham_inconclusive = "Error" in graham_reason or "Invalid" in graham_reason or "missing" in graham_reason
    is_error = technical_missing

    if is_error:
        action = "HOLD"
        label = "Sin conclusión / datos insuficientes"
        explanation = f"Análisis incompleto por fallo al obtener datos: {graham_reason}"
        confidence = 0
    elif not graham_passed and not graham_inconclusive:
        action = "SELL"
        label = "EVITAR / VENDER"
        explanation = f"Rechazado por filtro Graham: {graham_reason}"
        # High confidence if var is also high or prediction is negative
        if var_95 > 0.05 or ml_pred < 0:
            confidence = 85
        else:
            confidence = 65
    elif ml_pred > 0.01 and var_95 < 0.05:
        action = "BUY"
        label = "COMPRAR CON CAUTELA"
        explanation = f"Señal alcista validada. Régimen: {state.get('market_regime', 'Desconocido')}. Riesgo VaR 1D: {var_95*100:.2f}%."
        if graham_inconclusive:
            explanation += f" Filtro Graham no concluyente: {graham_reason}."
        confidence = 75 + int((0.05 - var_95) * 200) # Boost confidence based on low risk
        confidence = min(confidence, 95)
    else:
        action = "HOLD"
        label = "MANTENER"
        explanation = "Las condiciones no justifican aumentar la exposición según el umbral de riesgo GARCH o modelos ML."
        if graham_inconclusive:
            explanation += f" Filtro Graham no concluyente: {graham_reason}."
        confidence = 50

    # Apply Youtuber Strategy Modifiers
    if not is_error:
        if action == "BUY" and yt_signal == "BULLISH":
            label = "COMPRA FUERTE (Estrategias YT validadas)"
            explanation += f" Además, las estrategias de YouTube confirman tendencia alcista: {yt_reason}."
            confidence = min(confidence + 15, 99)
        elif action == "SELL" and yt_signal == "BEARISH":
            label = "VENTA FUERTE (Estrategias YT validadas)"
            explanation += f" Además, estrategias de YouTube confirman venta: {yt_reason}."
            confidence = min(confidence + 15, 99)
        elif action == "SELL" and yt_signal == "BULLISH":
            explanation += f" (Precaución: El análisis técnico de scalping/YT muestra una posible divergencia alcista a corto plazo: {yt_reason})."
            confidence = max(confidence - 15, 10)
        elif action == "BUY" and yt_signal == "BEARISH":
            explanation += f" (Precaución: El análisis técnico de scalping/YT muestra una posible divergencia bajista a corto plazo: {yt_reason})."
            confidence = max(confidence - 15, 10)
        elif action == "HOLD" and yt_signal != "NEUTRAL":
            explanation += f" Nota técnica YT: {yt_reason} ({yt_signal})."

        # Penalize confidence if regime is unknown or data is faulty
        if state.get('market_regime') == "Desconocido" or var_95 == 1:
            confidence = min(confidence, 30)
            explanation += " (Datos incompletos, confianza reducida)."

    state["action"] = action
    state["label"] = label
    state["confidence"] = confidence
    state["xai_explanation"] = explanation
    state = apply_signal_quality(state)
    state = apply_robust_backtest(state)
    state = apply_portfolio_risk(state)
    return state

def run_analysis_workflow(symbol: str):
    try:
        # Vanilla Python Workflow Execution
        state: AgentState = {"symbol": symbol}

        # 0. Data quality guardrail
        state = market_data_quality_analyst(state)
        if not quality_allows_ml(state.get("market_data_quality", {})):
            return apply_data_quality_block(state)

        # 1. Research Manager
        state = research_manager(state)

        # 2. Technical Analyst
        state = technical_analyst(state)

        # 3. Risk Manager
        state = risk_manager(state)

        # 3.5 YouTuber Analyst
        state = youtube_analyst(state)

        # 3.8 News Analyst (FinBERT)
        state = news_analyst(state)

        # 4. Decision Node
        state = decision_node(state)

        return state
    except Exception as e:
        import traceback
        err_msg = f"Error en ejecución del motor Python: {str(e)}"
        print(f"[ERROR] {err_msg}")
        traceback.print_exc()
        return {
            "symbol": symbol,
            "graham_passed": False,
            "graham_reason": f"Fallo interno: {str(e)}",
            "market_regime": "Unknown",
            "ml_prediction": 0.0,
            "var_95": 0.0,
            "youtube_signal": "NEUTRAL",
            "youtube_reason": "Workflow error",
            "action": "HOLD",
            "label": "Sin conclusión / datos insuficientes",
            "confidence": 0,
            "xai_explanation": err_msg,
            "error_reason": err_msg,
            "data_status": "incomplete"
        }
