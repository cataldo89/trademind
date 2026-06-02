from __future__ import annotations

from typing import Any, Dict, List, Optional


PROFILE_LIMITS = {
    "conservative": 0.05,
    "balanced": 0.10,
    "aggressive": 0.15,
}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _position_symbol(position: Dict[str, Any]) -> str:
    return str(position.get("symbol") or position.get("ticker") or "").upper()


def _position_value(position: Dict[str, Any]) -> float:
    value = position.get("market_value", position.get("value"))
    if value is not None:
        return _number(value)
    qty = _number(position.get("quantity", position.get("shares")))
    price = _number(position.get("price", position.get("current_price", position.get("avg_price"))))
    return qty * price


def evaluate_portfolio_risk(
    symbol: str,
    market: str = "US",
    user_id: Optional[str] = None,
    final_action: str = "HOLD",
    signal_quality: Optional[Dict[str, Any]] = None,
    robust_backtest: Optional[Dict[str, Any]] = None,
    current_price: Optional[float] = None,
    portfolio_positions: Optional[List[Dict[str, Any]]] = None,
    cash_balance: Optional[float] = None,
    account_equity: Optional[float] = None,
    risk_profile: str = "balanced",
    max_position_pct: Optional[float] = None,
    max_sector_pct: Optional[float] = None,
    max_market_pct: Optional[float] = None,
) -> Dict[str, Any]:
    symbol_upper = symbol.upper()
    action = str(final_action or "HOLD").upper()
    signal = signal_quality or {}
    backtest = robust_backtest or {}
    positions = portfolio_positions
    cash = _number(cash_balance, 0.0)
    equity = _number(account_equity, 0.0)
    price = _number(current_price, 0.0)
    profile = (risk_profile or "balanced").lower()
    max_position = float(max_position_pct if max_position_pct is not None else PROFILE_LIMITS.get(profile, PROFILE_LIMITS["balanced"]))

    warnings: List[str] = []
    blocking: List[str] = []
    concentration_risk = "LOW"
    liquidity_warning = None
    drawdown_warning = None
    correlation_warning = None

    if signal.get("signal_status") == "BLOCKED" and action == "BUY":
        blocking.append("signal_quality is BLOCKED")
    if backtest.get("backtest_status") in {"BLOCKED", "FAILED"} and action == "BUY":
        blocking.append(f"robust_backtest is {backtest.get('backtest_status')}")
    if backtest.get("backtest_status") == "WEAK" and action == "BUY":
        warnings.append("robust_backtest is WEAK; suggested size reduced.")

    if positions is None:
        warnings.append("portfolio_positions unavailable; portfolio risk uses cash/equity only.")
        positions = []

    if equity <= 0:
        position_values = [_position_value(position) for position in positions]
        equity = cash + sum(position_values)
    if equity <= 0:
        warnings.append("account_equity unavailable or zero; cannot size BUY robustly.")

    current_value = sum(_position_value(position) for position in positions if _position_symbol(position) == symbol_upper)
    current_exposure_pct = current_value / equity if equity > 0 else 0.0

    max_position_size = max(0.0, equity * max_position - current_value) if equity > 0 else 0.0
    suggested_position_size = 0.0
    projected_exposure_pct = current_exposure_pct

    if action == "BUY":
        if cash <= 0:
            blocking.append("cash_balance insufficient for BUY")
        base_fraction = max_position * 0.5
        if backtest.get("backtest_status") == "WEAK":
            base_fraction *= 0.5
        if signal.get("confidence_level") == "LOW" or _number(signal.get("final_confidence")) < 50:
            base_fraction *= 0.5
        suggested_position_size = min(max_position_size, cash, equity * base_fraction if equity > 0 else 0.0)
        if suggested_position_size <= 0:
            blocking.append("No available position capacity for BUY")
        if suggested_position_size < 25 and cash > 0:
            warnings.append("Suggested position size is below reasonable minimum.")
        projected_exposure_pct = (current_value + suggested_position_size) / equity if equity > 0 else 0.0
        if projected_exposure_pct > max_position * 1.25:
            blocking.append("Projected symbol exposure exceeds hard concentration limit.")
            concentration_risk = "HIGH"
        elif projected_exposure_pct > max_position:
            warnings.append("Projected symbol exposure exceeds max_position_pct.")
            concentration_risk = "MEDIUM"
    elif action == "SELL":
        if current_value > 0:
            suggested_position_size = current_value
            projected_exposure_pct = 0.0
        else:
            warnings.append("SELL requested but no existing position was provided.")
    else:
        suggested_position_size = 0.0

    if price <= 0 and action == "BUY":
        warnings.append("current_price unavailable; sizing returned as cash amount only.")

    if backtest.get("max_drawdown") is not None and _number(backtest.get("max_drawdown")) <= -0.25:
        drawdown_warning = "Backtest drawdown is high."
        warnings.append(drawdown_warning)

    same_market_value = sum(_position_value(position) for position in positions if str(position.get("market", market)).upper() == market.upper())
    market_pct = same_market_value / equity if equity > 0 else 0.0
    if max_market_pct is not None and action == "BUY" and market_pct > max_market_pct:
        warnings.append("Market exposure already exceeds max_market_pct.")

    status = "BLOCKED" if blocking else "WARNING" if warnings else "OK"
    action_allowed = status != "BLOCKED"
    adjusted_action = action if action_allowed else "HOLD"
    if action not in {"BUY", "SELL"}:
        adjusted_action = "HOLD"
        action_allowed = True

    explanation = (
        f"Portfolio risk {status}: action {action} adjusted to {adjusted_action}. "
        f"Current exposure {current_exposure_pct:.2%}, projected {projected_exposure_pct:.2%}, "
        f"suggested size {suggested_position_size:.2f}."
    )

    return {
        "symbol": symbol,
        "portfolio_risk_status": status,
        "action_allowed": action_allowed,
        "adjusted_action": adjusted_action,
        "max_position_size": max_position_size,
        "suggested_position_size": suggested_position_size,
        "current_exposure_pct": current_exposure_pct,
        "projected_exposure_pct": projected_exposure_pct,
        "concentration_risk": concentration_risk,
        "liquidity_warning": liquidity_warning,
        "drawdown_warning": drawdown_warning,
        "correlation_warning": correlation_warning,
        "blocking_reasons": blocking,
        "warnings": warnings,
        "explanation": explanation,
        "raw_diagnostics": {
            "user_id": user_id,
            "market": market,
            "risk_profile": profile,
            "max_position_pct": max_position,
            "max_sector_pct": max_sector_pct,
            "max_market_pct": max_market_pct,
            "cash_balance": cash,
            "account_equity": equity,
            "current_price": price,
            "positions_count": len(positions),
        },
    }
