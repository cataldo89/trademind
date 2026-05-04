from typing import TypedDict

# Define agent state
class AgentState(TypedDict):
    symbol: str
    graham_passed: bool
    graham_reason: str
    market_regime: str
    ml_prediction: float
    var_95: float
    final_decision: str
    xai_explanation: str

def research_manager(state: AgentState):
    from graham_filters import check_margin_of_safety
    passed, reason = check_margin_of_safety(state["symbol"])
    state["graham_passed"] = passed
    state["graham_reason"] = reason
    return state

def technical_analyst(state: AgentState):
    from risk_models import detect_regime, predict_direction_arima
    regime = detect_regime(state["symbol"])
    prediction = predict_direction_arima(state["symbol"])
    state["market_regime"] = regime
    state["ml_prediction"] = prediction["expected_return"]
    return state

def risk_manager(state: AgentState):
    from risk_models import calculate_var_garch
    var_data = calculate_var_garch(state["symbol"], "1D")
    state["var_95"] = var_data["var_1d_95"]
    return state

def decision_node(state: AgentState):
    if not state.get("graham_passed", False):
        decision = "EVITAR / VENDER"
        explanation = f"Rechazado por filtro Graham: {state.get('graham_reason', 'Desconocido')}"
    elif state.get("ml_prediction", 0) > 0.01 and state.get("var_95", 1) < 0.05:
        decision = "COMPRAR CON CAUTELA"
        explanation = f"Señal alcista validada. Régimen: {state.get('market_regime', 'Desconocido')}. Riesgo VaR 1D: {state.get('var_95', 1)*100}%."
    else:
        decision = "MANTENER"
        explanation = "Las condiciones no justifican aumentar la exposición según el umbral de riesgo GARCH."
        
    state["final_decision"] = decision
    state["xai_explanation"] = explanation
    return state

def run_analysis_workflow(symbol: str):
    # Vanilla Python Workflow Execution (Reemplazo de LangGraph por incompatibilidad con Python 3.8)
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
