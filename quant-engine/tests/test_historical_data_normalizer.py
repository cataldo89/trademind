import pandas as pd

from historical_data_normalizer import normalize_historical_dataset
from provider_fallback import resolve_provider_fallback


def normalize(raw, provider="test", metadata=None):
    return normalize_historical_dataset(
        symbol="AAPL",
        provider=provider,
        market="US",
        timeframe="1d",
        raw_dataset=raw,
        metadata=metadata or {},
    )


def yahoo_rows():
    return [
        {"date": "2024-01-02", "Open": 100, "High": 101, "Low": 99, "Close": 100.5, "Volume": 1000},
        {"date": "2024-01-03", "Open": 101, "High": 102, "Low": 100, "Close": 101.5, "Volume": 1200},
    ]


def test_normalizes_valid_yahoo_dataset():
    result = normalize(yahoo_rows(), "yahoo-chart")

    assert result["normalization_status"] in {"OK", "WARNING"}
    assert result["row_count"] == 2
    assert set(result["normalized_dataset"][0].keys()) == {"time", "open", "high", "low", "close", "volume"}
    assert isinstance(result["normalized_dataset"][0]["time"], int)


def test_normalizes_stooq_column_names():
    result = normalize(
        [{"Date": "2024-01-02", "Open": "100.1", "High": "101.2", "Low": "99.3", "Close": "100.4", "Volume": "1000"}],
        "stooq",
    )

    assert result["row_count"] == 1
    assert result["normalized_dataset"][0]["open"] == 100.1


def test_normalizes_yfinance_date_index():
    frame = pd.DataFrame(
        {"Open": [100], "High": [101], "Low": [99], "Close": [100.5], "Volume": [1000]},
        index=pd.DatetimeIndex(["2024-01-02"], name="Date"),
    )
    result = normalize(frame, "yfinance")

    assert result["normalization_status"] in {"OK", "WARNING"}
    assert result["row_count"] == 1


def test_sorts_disordered_dataset():
    result = normalize(list(reversed(yahoo_rows())))
    times = [row["time"] for row in result["normalized_dataset"]]

    assert times == sorted(times)


def test_removes_exact_duplicates():
    row = yahoo_rows()[0]
    result = normalize([row, dict(row)])

    assert result["row_count"] == 1
    assert any(warning["code"] == "DUPLICATE_ROWS_REMOVED" for warning in result["warnings"])


def test_converts_string_prices():
    result = normalize([{"time": "2024-01-02", "open": "100", "high": "101", "low": "99", "close": "100.5", "volume": "1000"}])

    assert result["normalized_dataset"][0]["close"] == 100.5


def test_adj_close_ambiguous_warning():
    result = normalize(
        [{"time": "2024-01-02", "open": 100, "high": 101, "low": 99, "close": 100.5, "Adj Close": 100.4, "volume": 1000}],
        metadata={},
    )

    assert result["adjusted_status"] == "unknown"
    assert any(warning["code"] == "ADJUSTMENT_AMBIGUOUS" for warning in result["warnings"])


def test_invalid_without_date_fails():
    result = normalize([{"open": 100, "high": 101, "low": 99, "close": 100.5, "volume": 1000}])

    assert result["normalization_status"] == "FAILED"
    assert any(issue["code"] == "MISSING_TIME_COLUMN" for issue in result["issues"])


def test_invalid_without_ohlcv_fails():
    result = normalize([{"time": "2024-01-02", "close": 100.5}])

    assert result["normalization_status"] == "FAILED"
    assert any(issue["code"] == "MISSING_OHLCV_COLUMNS" for issue in result["issues"])


def test_invalidzzz_stays_blocked_after_normalization():
    result = resolve_provider_fallback(
        "INVALIDZZZ",
        providers=[
            {"name": "yahoo-chart", "kind": "ohlcv", "configured": True, "fetch": lambda *_args: pd.DataFrame()},
        ],
    )

    assert result["final_status"] == "FAILED"
    assert result["usable_for_ml"] is False
