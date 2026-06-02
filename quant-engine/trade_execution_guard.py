from __future__ import annotations

from typing import Any, Dict, List, Optional


DERIVED_SOURCES = {"screener", "signal", "workflow", "analysis", "ai_advisor"}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _position_quantity(position: Optional[Dict[str, Any]]) -> float:
    if not position:
        return 0.0
    return _number(position.get("quantity", position.get("shares")))


def evaluate_trade_execution_guard(
    user_id: Optional[str],
    symbol: str,
    market: str = "US",
    side: str = "BUY",
    requested_amount: Optional[float] = None,
    requested_quantity: Optional[float] = None,
    current_price: Optional[float] = None,
    signal_quality: Optional[Dict[str, Any]] = None,
    robust_backtest: Optional[Dict[str, Any]] = None,
    portfolio_risk: Optional[Dict[str, Any]] = None,
    market_data_quality: Optional[Dict[str, Any]] = None,
    selected_provider: Optional[str] = None,
    account_equity: Optional[float] = None,
    cash_balance: Optional[float] = None,
    current_position: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
    source: str = "manual",
) -> Dict[str, Any]:
    symbol_upper = str(symbol or "").upper()
    side_upper = str(side or "").upper()
    source_value = str(source or "manual").lower()
    price = _number(current_price)
    amount = _number(requested_amount)
    quantity = _number(requested_quantity)
    cash = _number(cash_balance)
    equity = _number(account_equity)
    signal = signal_quality or {}
    backtest = robust_backtest or {}
    portfolio = portfolio_risk or {}
    quality = market_data_quality or {}

    blocking: List[str] = []
    warnings: List[str] = []
    guardrails: List[str] = []

    if not symbol_upper:
        blocking.append("symbol is required")
    if side_upper not in {"BUY", "SELL"}:
        blocking.append("side must be BUY or SELL")
    else:
        guardrails.append("SIDE_VALID")

    if not idempotency_key:
        blocking.append("idempotency_key is required")
    else:
        guardrails.append("IDEMPOTENCY_KEY_PRESENT")

    if price <= 0:
        blocking.append("current_price must be positive")
    else:
        guardrails.append("PRICE_VALID")

    if amount <= 0 and quantity <= 0:
        blocking.append("requested_amount or requested_quantity must be positive")

    effective_amount = amount if amount > 0 else quantity * price
    effective_quantity = quantity if quantity > 0 else (effective_amount / price if price > 0 else 0.0)

    if quality.get("status") == "FAILED":
        blocking.append("market_data_quality.status=FAILED")
    if quality.get("usable_for_ml") is False:
        blocking.append("market_data_quality.usable_for_ml=false")
    elif quality:
        guardrails.append("MARKET_DATA_QUALITY_ACCEPTED")
    else:
        warnings.append("market_data_quality missing; guard cannot fully audit data quality.")

    if signal.get("signal_status") == "BLOCKED":
        blocking.append("signal_quality.signal_status=BLOCKED")
    elif signal:
        guardrails.append("SIGNAL_NOT_BLOCKED")
    else:
        warnings.append("signal_quality missing; derived executions should provide it.")

    if backtest.get("backtest_status") in {"FAILED", "BLOCKED"}:
        blocking.append(f"robust_backtest.backtest_status={backtest.get('backtest_status')}")
    elif backtest:
        guardrails.append("BACKTEST_NOT_BLOCKED")
    else:
        warnings.append("robust_backtest missing; execution remains diagnostic.")

    if portfolio.get("portfolio_risk_status") == "BLOCKED":
        blocking.append("portfolio_risk.portfolio_risk_status=BLOCKED")
    if portfolio.get("action_allowed") is False:
        blocking.append("portfolio_risk.action_allowed=false")
    elif portfolio:
        guardrails.append("PORTFOLIO_RISK_ACCEPTED")
    else:
        warnings.append("portfolio_risk missing; sizing limits are incomplete.")

    max_allowed_amount = _number(portfolio.get("max_position_size"), 0.0)
    if max_allowed_amount <= 0 and side_upper == "BUY":
        suggested = _number(portfolio.get("suggested_position_size"), 0.0)
        max_allowed_amount = suggested if suggested > 0 else cash
    if side_upper == "SELL":
        position_qty = _position_quantity(current_position)
        max_allowed_amount = position_qty * price if position_qty > 0 and price > 0 else 0.0

    if side_upper == "BUY":
        if cash <= 0 or effective_amount > cash:
            blocking.append("cash_balance insufficient for BUY")
        else:
            guardrails.append("CASH_SUFFICIENT")
    elif side_upper == "SELL":
        if _position_quantity(current_position) <= 0:
            blocking.append("current_position required for SELL")
        else:
            guardrails.append("SELL_POSITION_EXISTS")

    requires_confirmation = False
    if side_upper == "BUY" and max_allowed_amount > 0 and effective_amount > max_allowed_amount:
        requires_confirmation = True
        warnings.append("requested_amount exceeds max_allowed_amount.")

    signal_action = str(signal.get("final_action") or "").upper()
    signal_status = str(signal.get("signal_status") or "").upper()
    if source_value == "manual":
        if side_upper == "BUY" and (signal_action != "BUY" or signal_status not in {"OK", "WEAK"}):
            requires_confirmation = True
            warnings.append("Manual BUY is not backed by a BUY signal; confirmation required.")
    elif source_value in DERIVED_SOURCES:
        if side_upper == "BUY" and (signal_action != "BUY" or signal_status != "OK"):
            blocking.append("Derived BUY requires signal_quality OK/BUY")

    if blocking:
        status = "BLOCKED"
        action_to_execute = "NONE"
        approved_amount = 0.0
        approved_quantity = 0.0
        confirmation_required = False
    elif requires_confirmation:
        status = "REQUIRES_CONFIRMATION"
        action_to_execute = side_upper
        approved_amount = min(effective_amount, max_allowed_amount) if max_allowed_amount > 0 else effective_amount
        approved_quantity = approved_amount / price if price > 0 else 0.0
        confirmation_required = True
    else:
        status = "ALLOWED"
        action_to_execute = side_upper
        approved_amount = effective_amount
        approved_quantity = effective_quantity
        confirmation_required = False
        guardrails.append("EXECUTION_ALLOWED")

    if status == "ALLOWED":
        explanation = f"Virtual {side_upper} allowed for {symbol_upper}; guardrails passed and no broker execution is attempted."
    elif status == "REQUIRES_CONFIRMATION":
        explanation = f"Virtual {side_upper} for {symbol_upper} requires explicit confirmation before execution."
    else:
        explanation = f"Virtual {side_upper} blocked for {symbol_upper}; guardrails failed."

    return {
        "execution_status": status,
        "action_to_execute": action_to_execute,
        "approved_amount": approved_amount,
        "approved_quantity": approved_quantity,
        "max_allowed_amount": max_allowed_amount,
        "price_used": price,
        "guardrails_passed": guardrails,
        "blocking_reasons": blocking,
        "warnings": warnings,
        "confirmation_required": confirmation_required,
        "explanation": explanation,
        "raw_diagnostics": {
            "user_id": user_id,
            "symbol": symbol_upper,
            "market": market,
            "side": side_upper,
            "requested_amount": amount,
            "requested_quantity": quantity,
            "effective_amount": effective_amount,
            "effective_quantity": effective_quantity,
            "selected_provider": selected_provider,
            "source": source_value,
            "account_equity": equity,
            "cash_balance": cash,
            "has_current_position": bool(current_position),
            "market_data_quality_status": quality.get("status"),
            "signal_status": signal.get("signal_status"),
            "backtest_status": backtest.get("backtest_status"),
            "portfolio_risk_status": portfolio.get("portfolio_risk_status"),
        },
    }
