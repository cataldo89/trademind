from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

import pandas as pd


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _empty_result(symbol: str, status: str, reason: str, warnings: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "symbol": symbol,
        "backtest_status": status,
        "usable_for_decision": False,
        "total_return": 0.0,
        "annualized_return": 0.0,
        "volatility": 0.0,
        "max_drawdown": 0.0,
        "sharpe_ratio": 0.0,
        "win_rate": 0.0,
        "trades_count": 0,
        "exposure_time": 0.0,
        "benchmark_return": 0.0,
        "warnings": warnings or [],
        "blocking_reasons": [reason],
        "explanation": reason,
        "raw_diagnostics": {},
    }


def _to_frame(dataset: Any) -> pd.DataFrame:
    frame = pd.DataFrame(list(dataset or []))
    if frame.empty:
        return frame
    for column in ("time", "open", "high", "low", "close", "volume"):
        if column in frame.columns:
            frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["time", "close"]).sort_values("time").drop_duplicates(subset=["time"])
    return frame.reset_index(drop=True)


def _max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    return float(drawdown.min()) if len(drawdown) else 0.0


def _positions_for_strategy(frame: pd.DataFrame, strategy_type: str, signal_quality: Dict[str, Any], params: Dict[str, Any]) -> pd.Series:
    strategy = (strategy_type or "buy_and_hold").lower()
    if strategy == "moving_average_cross":
        short = int(params.get("short_window", 20))
        long = int(params.get("long_window", 50))
        fast = frame["close"].rolling(short).mean()
        slow = frame["close"].rolling(long).mean()
        return (fast > slow).astype(float).fillna(0.0)
    if strategy == "signal_following":
        return pd.Series(1.0 if signal_quality.get("final_action") == "BUY" else 0.0, index=frame.index)
    return pd.Series(1.0, index=frame.index)


def run_robust_backtest(
    symbol: str,
    market: str = "US",
    provider: Optional[str] = None,
    timeframe: str = "1d",
    normalized_dataset: Optional[List[Dict[str, Any]]] = None,
    market_data_quality: Optional[Dict[str, Any]] = None,
    signal_quality: Optional[Dict[str, Any]] = None,
    strategy_type: str = "buy_and_hold",
    strategy_params: Optional[Dict[str, Any]] = None,
    initial_capital: float = 10_000.0,
    fees: float = 0.0,
    slippage: float = 0.0,
) -> Dict[str, Any]:
    quality = market_data_quality or {}
    signal = signal_quality or {}
    params = strategy_params or {}

    if not quality.get("usable_for_backtest"):
        return _empty_result(symbol, "BLOCKED", "market_data_quality.usable_for_backtest=false")
    if signal.get("signal_status") == "BLOCKED":
        return _empty_result(symbol, "BLOCKED", "signal_quality is BLOCKED")

    frame = _to_frame(normalized_dataset)
    row_count = int(len(frame))
    if row_count < 120:
        return _empty_result(symbol, "BLOCKED", f"Not enough normalized candles for backtest: {row_count}")

    warnings: List[str] = []
    blocking: List[str] = []
    if row_count < 252:
        warnings.append(f"Less than 252 daily candles ({row_count}); robustness is weak.")

    returns = frame["close"].pct_change().fillna(0.0)
    positions = _positions_for_strategy(frame, strategy_type, signal, params)
    shifted = positions.shift(1).fillna(0.0)
    trades = positions.diff().abs().fillna(positions.abs())
    cost = trades * (float(fees or 0.0) + float(slippage or 0.0))
    strategy_returns = shifted * returns - cost
    equity = (1.0 + strategy_returns).cumprod() * float(initial_capital or 10_000.0)

    total_return = float(equity.iloc[-1] / equity.iloc[0] - 1.0) if len(equity) > 1 else 0.0
    periods_per_year = 252 if timeframe.lower() in {"1d", "daily"} else 365
    annualized_return = float((1.0 + total_return) ** (periods_per_year / max(1, row_count)) - 1.0) if total_return > -1 else -1.0
    volatility = float(strategy_returns.std() * math.sqrt(periods_per_year)) if len(strategy_returns) > 1 else 0.0
    sharpe_ratio = float((strategy_returns.mean() / strategy_returns.std()) * math.sqrt(periods_per_year)) if strategy_returns.std() > 0 else 0.0
    max_drawdown = _max_drawdown(equity)
    trades_count = int((trades > 0).sum())
    exposure_time = float((positions > 0).mean()) if row_count else 0.0
    benchmark_return = float(frame["close"].iloc[-1] / frame["close"].iloc[0] - 1.0) if row_count > 1 else 0.0
    wins = strategy_returns[strategy_returns != 0] > 0
    win_rate = float(wins.mean()) if len(wins) else 0.0

    status = "OK"
    usable = True
    if row_count < 252:
        status = "WEAK"
        usable = False

    if trades_count < 5:
        warnings.append("Too few trades for statistically robust inference.")
        status = "WEAK"
    if trades_count < 3:
        usable = False
    if abs(sharpe_ratio) > 5 and (trades_count < 10 or volatility < 0.02):
        warnings.append("UNSTABLE_SHARPE: Sharpe ratio is unstable due to low variance or too few trades.")
        status = "WEAK" if status == "OK" else status
    if max_drawdown == 0 and trades_count < 5:
        warnings.append("INSUFFICIENT_DRAWDOWN_EVIDENCE: zero drawdown with too few trades is not robust evidence.")
        status = "WEAK" if status == "OK" else status

    if max_drawdown <= -0.25:
        warnings.append(f"High max drawdown: {max_drawdown:.2%}.")
        status = "WEAK"
    if sharpe_ratio < 0:
        warnings.append("Negative Sharpe ratio; strong signal not allowed.")
        status = "FAILED"
        usable = False
    if total_return < 0 and strategy_type != "signal_following":
        warnings.append("Negative total return.")
        status = "WEAK" if status != "FAILED" else status

    robustness_note = " Not statistically robust due to too few trades." if trades_count < 5 else ""
    explanation = (
        f"Backtest {status}: return {total_return:.2%}, Sharpe {sharpe_ratio:.2f}, "
        f"drawdown {max_drawdown:.2%}, trades {trades_count}.{robustness_note} "
        "Diagnostic only, not a promise of returns."
    )
    return {
        "symbol": symbol,
        "backtest_status": status,
        "usable_for_decision": bool(usable and status == "OK"),
        "total_return": total_return,
        "annualized_return": annualized_return,
        "volatility": volatility,
        "max_drawdown": max_drawdown,
        "sharpe_ratio": sharpe_ratio,
        "win_rate": win_rate,
        "trades_count": trades_count,
        "exposure_time": exposure_time,
        "benchmark_return": benchmark_return,
        "warnings": warnings,
        "blocking_reasons": blocking,
        "explanation": explanation,
        "raw_diagnostics": {
            "market": market,
            "provider": provider,
            "timeframe": timeframe,
            "row_count": row_count,
            "strategy_type": strategy_type,
            "fees": fees,
            "slippage": slippage,
        },
    }
