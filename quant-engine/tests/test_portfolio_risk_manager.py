from portfolio_risk_manager import evaluate_portfolio_risk


OK_SIGNAL = {"signal_status": "OK", "final_action": "BUY", "final_confidence": 80, "confidence_level": "HIGH"}
BLOCKED_SIGNAL = {"signal_status": "BLOCKED", "final_action": "HOLD", "final_confidence": 0}
OK_BACKTEST = {"backtest_status": "OK", "usable_for_decision": True, "max_drawdown": -0.05}
WEAK_BACKTEST = {"backtest_status": "WEAK", "usable_for_decision": False, "max_drawdown": -0.05}
FAILED_BACKTEST = {"backtest_status": "FAILED", "usable_for_decision": False}


def assess(**kwargs):
    return evaluate_portfolio_risk(symbol="AAPL", market="US", current_price=100, **kwargs)


def test_buy_ok_with_balanced_portfolio():
    result = assess(
        final_action="BUY",
        signal_quality=OK_SIGNAL,
        robust_backtest=OK_BACKTEST,
        portfolio_positions=[{"symbol": "MSFT", "market_value": 1000, "market": "US"}],
        cash_balance=5000,
        account_equity=10000,
        risk_profile="balanced",
    )

    assert result["portfolio_risk_status"] == "OK"
    assert result["action_allowed"] is True
    assert result["suggested_position_size"] > 0


def test_buy_insufficient_cash_blocked():
    result = assess(final_action="BUY", signal_quality=OK_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=[], cash_balance=0, account_equity=10000)

    assert result["portfolio_risk_status"] == "BLOCKED"


def test_buy_exceeds_max_position_warning_or_blocked():
    result = assess(
        final_action="BUY",
        signal_quality=OK_SIGNAL,
        robust_backtest=OK_BACKTEST,
        portfolio_positions=[{"symbol": "AAPL", "market_value": 1200}],
        cash_balance=5000,
        account_equity=10000,
        max_position_pct=0.10,
    )

    assert result["portfolio_risk_status"] in {"WARNING", "BLOCKED"}


def test_signal_blocked_blocks_buy():
    result = assess(final_action="BUY", signal_quality=BLOCKED_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=[], cash_balance=5000, account_equity=10000)

    assert result["portfolio_risk_status"] == "BLOCKED"


def test_failed_backtest_blocks_buy():
    result = assess(final_action="BUY", signal_quality=OK_SIGNAL, robust_backtest=FAILED_BACKTEST, portfolio_positions=[], cash_balance=5000, account_equity=10000)

    assert result["portfolio_risk_status"] == "BLOCKED"


def test_weak_backtest_warns_and_reduces_size():
    ok = assess(final_action="BUY", signal_quality=OK_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=[], cash_balance=5000, account_equity=10000)
    weak = assess(final_action="BUY", signal_quality=OK_SIGNAL, robust_backtest=WEAK_BACKTEST, portfolio_positions=[], cash_balance=5000, account_equity=10000)

    assert weak["portfolio_risk_status"] == "WARNING"
    assert weak["suggested_position_size"] < ok["suggested_position_size"]


def test_sell_with_existing_position_allowed():
    result = assess(final_action="SELL", signal_quality=OK_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=[{"symbol": "AAPL", "market_value": 1000}], cash_balance=0, account_equity=10000)

    assert result["action_allowed"] is True
    assert result["adjusted_action"] == "SELL"
    assert result["suggested_position_size"] == 1000


def test_sell_without_position_warning():
    result = assess(final_action="SELL", signal_quality=OK_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=[], cash_balance=0, account_equity=10000)

    assert result["portfolio_risk_status"] == "WARNING"


def test_missing_positions_warning_no_invention():
    result = assess(final_action="HOLD", signal_quality=OK_SIGNAL, robust_backtest=OK_BACKTEST, portfolio_positions=None, cash_balance=1000, account_equity=10000)

    assert result["portfolio_risk_status"] == "WARNING"
    assert "portfolio_positions unavailable" in " ".join(result["warnings"])


def test_invalidzzz_blocked():
    result = evaluate_portfolio_risk(symbol="INVALIDZZZ", final_action="BUY", signal_quality=BLOCKED_SIGNAL, robust_backtest=FAILED_BACKTEST, cash_balance=1000, account_equity=10000)

    assert result["portfolio_risk_status"] == "BLOCKED"
    assert result["adjusted_action"] == "HOLD"
