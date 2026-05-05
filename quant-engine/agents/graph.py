from typing import TypedDict

# Define agent state
class AgentState(TypedDict):
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

def research_manager(state: AgentState):
    from graham_filters import check_margin_of_safety
    passed, reason = check_margin_of_safety(state["symbol"])
    state["graham_passed"] = passed
    state["graham_reason"] = reason
    return state

def technical_analyst(state: AgentState):
    try:
        from risk_models import detect_regime, predict_direction_arima
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

def decision_node(state: AgentState):
    var_95 = state.get("var_95", 1)
    ml_pred = state.get("ml_prediction", 0)
    graham_passed = state.get("graham_passed", False)
    
    # Base confidence calculation
    confidence = 50
    
    if not graham_passed:
        action = "SELL"
        label = "EVITAR / VENDER"
        explanation = f"Rechazado por filtro Graham: {state.get('graham_reason', 'Desconocido')}"
        # High confidence if var is also high or prediction is negative
        if var_95 > 0.05 or ml_pred < 0:
            confidence = 85
        else:
            confidence = 65
    elif ml_pred > 0.01 and var_95 < 0.05:
        action = "BUY"
        label = "COMPRAR CON CAUTELA"
        explanation = f"Señal alcista validada. Régimen: {state.get('market_regime', 'Desconocido')}. Riesgo VaR 1D: {var_95*100:.2f}%."
        confidence = 75 + int((0.05 - var_95) * 200) # Boost confidence based on low risk
        confidence = min(confidence, 95)
    else:
        action = "HOLD"
        label = "MANTENER"
        explanation = "Las condiciones no justifican aumentar la exposición según el umbral de riesgo GARCH o modelos ML."
        confidence = 50
        
    # Penalize confidence if regime is unknown or data is faulty
    if state.get('market_regime') == "Desconocido" or var_95 == 1:
        confidence = min(confidence, 30)
        explanation += " (Datos incompletos, confianza reducida)."

    state["action"] = action
    state["label"] = label
    state["confidence"] = confidence
    state["xai_explanation"] = explanation
    return state

def run_analysis_workflow(symbol: str):
    # Vanilla Python Workflow Execution
    state: AgentState = {"symbol": symbol}
    
    # 1. Research Manager
    state = research_manager(state)
    
    # 2. Technical Analyst
    state = technical_analyst(state)
    
    # 3. Risk Manager
    state = risk_manager(state)
    
    # 4. Decision Node
    state = decision_node(state)
    
    return state
