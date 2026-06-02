from trade_execution_guard import evaluate_trade_execution_guard


GOOD_QUALITY = {"status": "OK", "usable_for_ml": True, "quality_score": 90}
BAD_QUALITY = {"status": "FAILED", "usable_for_ml": False, "quality_score": 0}
OK_SIGNAL = {"signal_status": "OK", "final_action": "BUY", "final_confidence": 80}
HOLD_SIGNAL = {"signal_status": "WEAK", "final_action": "HOLD", "final_confidence": 35}
BLOCKED_SIGNAL = {"signal_status": "BLOCKED", "final_action": "HOLD", "final_confidence": 0}
OK_BACKTEST = {"backtest_status": "OK", "usable_for_decision": True}
FAILED_BACKTEST = {"backtest_status": "FAILED", "usable_for_decision": False}
OK_PORTFOLIO = {
    "portfolio_risk_status": "OK",
    "action_allowed": True,
    "max_position_size": 1000,
    "suggested_position_size": 500,
}
BLOCKED_PORTFOLIO = {"portfolio_risk_status": "BLOCKED", "action_allowed": False}


def guard(**kwargs):
    params = {
        "user_id": "u1",
        "symbol": "AAPL",
        "market": "US",
        "side": "BUY",
        "requested_amount": 100,
        "current_price": 100,
        "signal_quality": OK_SIGNAL,
        "robust_backtest": OK_BACKTEST,
        "portfolio_risk": OK_PORTFOLIO,
        "market_data_quality": GOOD_QUALITY,
        "selected_provider": "yahoo-chart",
        "account_equity": 10000,
        "cash_balance": 5000,
        "idempotency_key": "idem-1",
        "source": "signal",
    }
    params.update(kwargs)
    return evaluate_trade_execution_guard(**params)


def test_buy_valid_all_guards_ok_allowed():
    result = guard()

    assert result["execution_status"] == "ALLOWED"
    assert result["action_to_execute"] == "BUY"
    assert result["approved_amount"] == 100


def test_buy_insufficient_cash_blocked():
    result = guard(cash_balance=50)

    assert result["execution_status"] == "BLOCKED"
    assert "cash_balance insufficient for BUY" in result["blocking_reasons"]


def test_buy_signal_blocked():
    result = guard(signal_quality=BLOCKED_SIGNAL)

    assert result["execution_status"] == "BLOCKED"
    assert "signal_quality.signal_status=BLOCKED" in result["blocking_reasons"]


def test_buy_portfolio_blocked():
    result = guard(portfolio_risk=BLOCKED_PORTFOLIO)

    assert result["execution_status"] == "BLOCKED"
    assert "portfolio_risk.portfolio_risk_status=BLOCKED" in result["blocking_reasons"]


def test_buy_amount_over_allowed_requires_confirmation():
    result = guard(requested_amount=1200)

    assert result["execution_status"] == "REQUIRES_CONFIRMATION"
    assert result["confirmation_required"] is True
    assert result["approved_amount"] == 1000


def test_sell_with_existing_position_allowed():
    result = guard(
        side="SELL",
        requested_amount=1000,
        requested_quantity=10,
        current_position={"symbol": "AAPL", "quantity": 10},
        source="manual",
        signal_quality=HOLD_SIGNAL,
    )

    assert result["execution_status"] == "ALLOWED"
    assert result["action_to_execute"] == "SELL"


def test_sell_without_position_blocked():
    result = guard(side="SELL", requested_quantity=10, source="manual")

    assert result["execution_status"] == "BLOCKED"
    assert "current_position required for SELL" in result["blocking_reasons"]


def test_invalid_price_blocked():
    result = guard(current_price=0)

    assert result["execution_status"] == "BLOCKED"
    assert "current_price must be positive" in result["blocking_reasons"]


def test_missing_idempotency_key_blocked():
    result = guard(idempotency_key=None)

    assert result["execution_status"] == "BLOCKED"
    assert "idempotency_key is required" in result["blocking_reasons"]


def test_invalidzzz_blocked():
    result = guard(
        symbol="INVALIDZZZ",
        market_data_quality=BAD_QUALITY,
        signal_quality=BLOCKED_SIGNAL,
        robust_backtest=FAILED_BACKTEST,
        portfolio_risk=BLOCKED_PORTFOLIO,
    )

    assert result["execution_status"] == "BLOCKED"
    assert "market_data_quality.usable_for_ml=false" in result["blocking_reasons"]


def test_manual_hold_good_data_requires_confirmation():
    result = guard(source="manual", signal_quality=HOLD_SIGNAL)

    assert result["execution_status"] == "REQUIRES_CONFIRMATION"
    assert "Manual BUY is not backed by a BUY signal; confirmation required." in result["warnings"]


def test_workflow_hold_blocks_buy():
    result = guard(source="workflow", signal_quality=HOLD_SIGNAL)

    assert result["execution_status"] == "BLOCKED"
    assert "Derived BUY requires signal_quality OK/BUY" in result["blocking_reasons"]
