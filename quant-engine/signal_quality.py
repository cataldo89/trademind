from __future__ import annotations

from typing import Any, Dict, List, Optional


def _clamp(value: float, low: int = 0, high: int = 100) -> int:
    return int(max(low, min(high, round(value))))


def _confidence_level(confidence: int) -> str:
    if confidence >= 70:
        return "HIGH"
    if confidence >= 50:
        return "MEDIUM"
    return "LOW"


def evaluate_signal_quality(
    symbol: str,
    market: str = "US",
    selected_provider: Optional[str] = None,
    market_data_quality: Optional[Dict[str, Any]] = None,
    technical_indicators: Optional[Dict[str, Any]] = None,
    ml_prediction: Any = None,
    risk_metrics: Optional[Dict[str, Any]] = None,
    graham_result: Optional[Dict[str, Any]] = None,
    sentiment_result: Optional[Dict[str, Any]] = None,
    workflow_action: str = "HOLD",
    workflow_confidence: int = 0,
    reasons: Optional[List[str]] = None,
) -> Dict[str, Any]:
    quality = market_data_quality or {}
    technical = technical_indicators or {}
    risk = risk_metrics or {}
    graham = graham_result or {}
    sentiment = sentiment_result or {}
    reasons = reasons or []

    supporting: List[str] = []
    contradicting: List[str] = []
    blocking: List[str] = []
    warnings: List[str] = []

    quality_score = int(quality.get("quality_score") or 0)
    usable_for_ml = bool(quality.get("usable_for_ml"))
    usable_for_chart = bool(quality.get("usable_for_chart"))

    if not usable_for_ml:
        blocking.append("market_data_quality.usable_for_ml=false")
    if quality_score < 60:
        blocking.append(f"market_data_quality.quality_score={quality_score} < 60")
    if usable_for_chart and not usable_for_ml:
        warnings.append("Datos aptos solo para grafico; BUY/SELL prohibido.")

    action = str(workflow_action or "HOLD").upper()
    confidence = _clamp(int(workflow_confidence or 0))
    signal_score = confidence

    ml_value = ml_prediction.get("expected_return") if isinstance(ml_prediction, dict) else ml_prediction
    try:
        ml_value = float(ml_value or 0)
    except Exception:
        ml_value = 0.0

    var_95 = risk.get("var_95", risk.get("var_1d_95", risk.get("var")))
    try:
        var_95 = float(var_95 if var_95 is not None else 0)
    except Exception:
        var_95 = 0.0
    high_risk = var_95 >= 0.05 or bool(risk.get("high_risk"))

    sentiment_label = str(sentiment.get("sentiment") or sentiment.get("label") or "NEUTRAL").upper()
    graham_passed = graham.get("passed", graham.get("graham_passed"))
    graham_reason = str(graham.get("reason") or graham.get("graham_reason") or "")

    if ml_value > 0.01:
        supporting.append("ML positivo")
        signal_score += 10
    elif ml_value < -0.01:
        contradicting.append("ML negativo")
        signal_score -= 10

    if high_risk:
        contradicting.append(f"Riesgo alto VaR={var_95}")
        signal_score -= 25
    elif var_95 > 0:
        supporting.append(f"Riesgo controlado VaR={var_95}")
        signal_score += 5

    if graham_passed is False:
        contradicting.append(f"Graham negativo: {graham_reason or 'sin margen de seguridad'}")
        signal_score -= 15
    elif graham_passed is True:
        supporting.append("Graham positivo")
        signal_score += 5

    if sentiment_label == "POSITIVE":
        if blocking:
            blocking.append("FinBERT positivo ignorado por mala calidad de datos")
        elif ml_value <= 0 and action != "BUY":
            warnings.append("FinBERT positivo no confirma tecnico/ML; no infla la senal.")
        else:
            supporting.append("FinBERT positivo")
            signal_score += 5
    elif sentiment_label == "NEGATIVE":
        contradicting.append("FinBERT negativo")
        signal_score -= 10

    if technical.get("macd_signal") in {"Cruce alcista", "Positivo"} or technical.get("momentum") == "bullish":
        supporting.append("Tecnico alcista")
    if technical.get("macd_signal") == "Cruce bajista" or technical.get("momentum") == "bearish":
        contradicting.append("Tecnico bajista")

    if action == "BUY" and high_risk:
        contradicting.append("Workflow BUY contradicho por riesgo alto")
    if action == "BUY" and graham_passed is False:
        contradicting.append("Workflow BUY contradicho por Graham negativo")

    if blocking:
        final_action = "HOLD"
        final_confidence = 0
        signal_status = "BLOCKED"
        signal_score = 0
    else:
        signal_score = _clamp(signal_score)
        if action == "BUY" and (high_risk or graham_passed is False or len(contradicting) >= 2):
            final_action = "HOLD"
            final_confidence = min(confidence, 49)
            signal_status = "CONFLICTED"
        elif action in {"BUY", "SELL"} and confidence >= 70 and supporting:
            final_action = action
            final_confidence = _clamp(signal_score)
            signal_status = "OK"
        elif action in {"BUY", "SELL"} and confidence >= 50:
            final_action = "HOLD" if contradicting else action
            final_confidence = min(_clamp(signal_score), 69)
            signal_status = "CONFLICTED" if contradicting else "WEAK"
        else:
            final_action = "HOLD"
            final_confidence = min(_clamp(signal_score), 49)
            signal_status = "WEAK"

    if not supporting and not blocking:
        warnings.append("Sin factores de soporte suficientes para oportunidad.")

    explanation = (
        f"{signal_status}: accion final {final_action} con confianza {final_confidence}. "
        f"Soporte={len(supporting)}, contradicciones={len(contradicting)}, bloqueos={len(blocking)}."
    )

    return {
        "symbol": symbol,
        "signal_status": signal_status,
        "final_action": final_action,
        "final_confidence": final_confidence,
        "confidence_level": _confidence_level(final_confidence),
        "signal_score": _clamp(signal_score),
        "supporting_factors": supporting,
        "contradicting_factors": contradicting,
        "blocking_reasons": blocking,
        "warnings": warnings,
        "explanation": explanation,
        "raw_diagnostics": {
            "market": market,
            "selected_provider": selected_provider,
            "workflow_action": action,
            "workflow_confidence": confidence,
            "quality_score": quality_score,
            "usable_for_ml": usable_for_ml,
            "ml_prediction": ml_value,
            "var_95": var_95,
            "graham_passed": graham_passed,
            "sentiment": sentiment_label,
            "reasons": reasons,
        },
    }
