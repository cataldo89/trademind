import pandas as pd

from market_data_quality import evaluate_market_data_quality


def make_dataset(rows=300, start="2024-01-02", adjusted=True):
    dates = pd.bdate_range(start=start, periods=rows)
    data = []
    for index, date in enumerate(dates):
        price = 100 + index * 0.1
        data.append(
            {
                "time": date.isoformat(),
                "open": price,
                "high": price + 1,
                "low": price - 1,
                "close": price + 0.2,
                "volume": 1_000_000 + index,
            }
        )
    return data, {"adjusted": adjusted, "provider_status": "ok"}


def assess(dataset, metadata=None):
    return evaluate_market_data_quality(
        symbol="AAPL",
        provider="test-provider",
        timeframe="1d",
        dataset=dataset,
        metadata=metadata or {"adjusted": True, "provider_status": "ok"},
    )


def codes(items):
    return {item["code"] for item in items}


def test_market_data_quality_accepts_good_dataset():
    dataset, metadata = make_dataset()
    result = assess(dataset, metadata)

    assert result["status"] == "OK"
    assert result["usable_for_chart"] is True
    assert result["usable_for_ta"] is True
    assert result["usable_for_ml"] is True
    assert result["usable_for_backtest"] is True
    assert result["quality_score"] >= 80


def test_market_data_quality_blocks_empty_dataset():
    result = assess([])

    assert result["status"] == "FAILED"
    assert result["usable_for_chart"] is False
    assert result["usable_for_ml"] is False
    assert "EMPTY_DATASET" in codes(result["blocking_errors"])
    assert "PROVIDER_SILENT_FAILURE" in codes(result["blocking_errors"])


def test_market_data_quality_allows_chart_but_blocks_ml_for_few_records():
    dataset, metadata = make_dataset(rows=10)
    result = assess(dataset, metadata)

    assert result["status"] == "WARNING"
    assert result["usable_for_chart"] is True
    assert result["usable_for_ta"] is False
    assert result["usable_for_ml"] is False
    assert "INSUFFICIENT_ML_HISTORY" in codes(result["warnings"])


def test_market_data_quality_detects_missing_dates():
    dataset, metadata = make_dataset(rows=180)
    sparse_dataset = [row for index, row in enumerate(dataset) if index % 3 != 0]
    result = assess(sparse_dataset, metadata)

    assert result["usable_for_ml"] is False
    assert "MISSING_DATES" in codes(result["issues"])


def test_market_data_quality_blocks_ml_for_null_volume():
    dataset, metadata = make_dataset(rows=180)
    for row in dataset:
        row["volume"] = None
    result = assess(dataset, metadata)

    assert result["usable_for_chart"] is True
    assert result["usable_for_ta"] is True
    assert result["usable_for_ml"] is False
    assert "NULL_VOLUME_VALUES" in codes(result["warnings"])
    assert "SUSPICIOUS_VOLUME" in codes(result["issues"])


def test_market_data_quality_blocks_zero_or_negative_prices():
    dataset, metadata = make_dataset()
    dataset[3]["close"] = 0
    dataset[4]["open"] = -1
    result = assess(dataset, metadata)

    assert result["status"] == "FAILED"
    assert result["usable_for_chart"] is False
    assert "NON_POSITIVE_PRICES" in codes(result["blocking_errors"])


def test_market_data_quality_detects_disordered_dataset():
    dataset, metadata = make_dataset()
    result = assess(list(reversed(dataset)), metadata)

    assert result["usable_for_ta"] is False
    assert result["usable_for_ml"] is False
    assert "NOT_CHRONOLOGICAL" in codes(result["issues"])


def test_market_data_quality_blocks_missing_columns():
    dataset, metadata = make_dataset()
    for row in dataset:
        row.pop("volume")
    result = assess(dataset, metadata)

    assert result["status"] == "FAILED"
    assert result["usable_for_chart"] is False
    assert "MISSING_OHLCV_COLUMNS" in codes(result["blocking_errors"])


def test_yahoo_like_chart_dataset_can_be_visual_only_not_ml():
    dataset, metadata = make_dataset(rows=5)
    metadata = {**metadata, "provider": "yahoo-finance2-chart"}
    result = assess(dataset, metadata)

    assert result["usable_for_chart"] is True
    assert result["usable_for_ta"] is False
    assert result["usable_for_ml"] is False
    assert result["usable_for_backtest"] is False
    assert result["quality_score"] < 80
