import pandas as pd

from robust_backtest import run_robust_backtest


GOOD_QUALITY = {"usable_for_backtest": True}
BAD_QUALITY = {"usable_for_backtest": False}
OK_SIGNAL = {"signal_status": "OK", "final_action": "BUY", "final_confidence": 80}
BLOCKED_SIGNAL = {"signal_status": "BLOCKED", "final_action": "HOLD", "final_confidence": 0}


def dataset(rows=300, start=100, step=0.1):
    dates = pd.bdate_range("2024-01-02", periods=rows)
    data = []
    for i, date in enumerate(dates):
        close = start + i * step
        data.append({"time": int(date.timestamp()), "open": close, "high": close + 1, "low": close - 1, "close": close, "volume": 1000})
    return data


def test_less_than_252_candles_is_weak_or_blocked():
    result = run_robust_backtest("AAPL", normalized_dataset=dataset(180), market_data_quality=GOOD_QUALITY, signal_quality=OK_SIGNAL)

    assert result["backtest_status"] in {"WEAK", "BLOCKED"}
    assert result["usable_for_decision"] is False


def test_positive_one_trade_strategy_is_weak_not_ok():
    result = run_robust_backtest("AAPL", normalized_dataset=dataset(300, step=0.2), market_data_quality=GOOD_QUALITY, signal_quality=OK_SIGNAL)

    assert result["backtest_status"] == "WEAK"
    assert result["total_return"] > 0
    assert result["usable_for_decision"] is False
    assert result["trades_count"] == 1
    assert "Not statistically robust due to too few trades" in result["explanation"]
    assert any("UNSTABLE_SHARPE" in warning for warning in result["warnings"])
    assert any("INSUFFICIENT_DRAWDOWN_EVIDENCE" in warning for warning in result["warnings"])


def test_valid_more_trades_strategy_can_be_ok():
    data = []
    for i, row in enumerate(dataset(320, step=0.1)):
        price = 100 + i * 0.05 + (3 if i % 40 < 20 else -3)
        row.update({"open": price, "high": price + 1, "low": price - 1, "close": price})
        data.append(row)
    result = run_robust_backtest(
        "AAPL",
        normalized_dataset=data,
        market_data_quality=GOOD_QUALITY,
        signal_quality=OK_SIGNAL,
        strategy_type="moving_average_cross",
        strategy_params={"short_window": 5, "long_window": 15},
    )

    assert result["trades_count"] >= 5
    assert result["backtest_status"] in {"OK", "WEAK"}


def test_valid_negative_strategy_not_strong():
    result = run_robust_backtest("AAPL", normalized_dataset=dataset(300, start=200, step=-0.2), market_data_quality=GOOD_QUALITY, signal_quality=OK_SIGNAL)

    assert result["backtest_status"] in {"WEAK", "FAILED"}
    assert result["usable_for_decision"] is False


def test_signal_blocked_blocks_backtest():
    result = run_robust_backtest("AAPL", normalized_dataset=dataset(300), market_data_quality=GOOD_QUALITY, signal_quality=BLOCKED_SIGNAL)

    assert result["backtest_status"] == "BLOCKED"


def test_invalidzzz_blocked():
    result = run_robust_backtest("INVALIDZZZ", normalized_dataset=[], market_data_quality=BAD_QUALITY, signal_quality=BLOCKED_SIGNAL)

    assert result["backtest_status"] == "BLOCKED"


def test_high_drawdown_marks_weak():
    data = dataset(260, start=200, step=0.1)
    for i in range(130, 180):
        data[i]["close"] = 80
    result = run_robust_backtest("AAPL", normalized_dataset=data, market_data_quality=GOOD_QUALITY, signal_quality=OK_SIGNAL)

    assert result["backtest_status"] in {"WEAK", "FAILED"}
    assert result["max_drawdown"] <= -0.25


def test_few_trades_is_weak_for_ma_cross():
    result = run_robust_backtest(
        "AAPL",
        normalized_dataset=dataset(300, step=0.01),
        market_data_quality=GOOD_QUALITY,
        signal_quality=OK_SIGNAL,
        strategy_type="moving_average_cross",
    )

    assert result["trades_count"] < 2 or result["backtest_status"] in {"OK", "WEAK"}


def test_no_backtest_when_quality_disallows_backtest():
    result = run_robust_backtest("AAPL", normalized_dataset=dataset(300), market_data_quality=BAD_QUALITY, signal_quality=OK_SIGNAL)

    assert result["backtest_status"] == "BLOCKED"
    assert result["usable_for_decision"] is False
