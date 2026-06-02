import pandas as pd

from provider_fallback import ProviderNotConfigured, ProviderRateLimited, resolve_provider_fallback


def make_frame(rows=300, start="2024-01-02", zero_volume=False):
    dates = pd.bdate_range(start=start, periods=rows, tz="UTC")
    return pd.DataFrame(
        {
            "time": dates,
            "open": [100 + index * 0.1 for index in range(rows)],
            "high": [101 + index * 0.1 for index in range(rows)],
            "low": [99 + index * 0.1 for index in range(rows)],
            "close": [100.2 + index * 0.1 for index in range(rows)],
            "volume": [0 if zero_volume else 1_000_000 + index for index in range(rows)],
        }
    )


def provider(name, frame=None, configured=True, error=None):
    def fetch(*_args):
        if error:
            raise error
        return frame if frame is not None else pd.DataFrame()

    return {"name": name, "kind": "ohlcv", "configured": configured, "fetch": fetch}


def test_yahoo_valid_and_selected():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[provider("yahoo-chart", make_frame()), provider("stooq", make_frame())],
    )

    assert result["selected_provider"] == "yahoo-chart"
    assert result["usable_for_ml"] is True
    assert result["final_status"] == "OK"
    assert result["fallback_used"] is False


def test_yahoo_fails_and_fallback_uses_other_provider():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[
            provider("yahoo-chart", error=RuntimeError("yahoo failed")),
            provider("stooq", make_frame()),
        ],
    )

    assert result["selected_provider"] == "stooq"
    assert result["usable_for_ml"] is True
    assert result["fallback_used"] is True
    assert any(item["provider"] == "yahoo-chart" and item["status"] == "failed" for item in result["provider_statuses"])


def test_all_providers_fail():
    result = resolve_provider_fallback(
        "INVALIDZZZ",
        providers=[
            provider("yahoo-chart", error=RuntimeError("failed")),
            provider("stooq", error=RuntimeError("failed")),
        ],
    )

    assert result["selected_provider"] is None
    assert result["final_status"] == "FAILED"
    assert result["usable_for_ml"] is False


def test_provider_without_api_key_is_not_configured():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[provider("alpha-vantage", configured=False)],
    )

    assert result["final_status"] == "FAILED"
    assert result["provider_statuses"][0]["status"] == "not_configured"


def test_alpha_vantage_rate_limited_is_marked_failed_rate_limited():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[provider("alpha-vantage", error=ProviderRateLimited("rate limit"))],
    )

    assert result["provider_statuses"][0]["status"] == "rate_limited"
    assert result["errors"][0]["status"] == "rate_limited"


def test_alternative_dataset_can_be_chart_only_not_ml():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[
            provider("yahoo-chart", error=RuntimeError("failed")),
            provider("stooq", make_frame(rows=20)),
        ],
    )

    assert result["selected_provider"] == "stooq"
    assert result["usable_for_chart"] is True
    assert result["usable_for_ml"] is False
    assert result["final_status"] == "FAILED"


def test_alternative_dataset_can_be_ml_usable():
    result = resolve_provider_fallback(
        "MSFT",
        providers=[
            provider("yahoo-chart", error=RuntimeError("failed")),
            provider("stooq", make_frame(rows=300)),
        ],
    )

    assert result["selected_provider"] == "stooq"
    assert result["usable_for_ml"] is True
    assert result["final_status"] == "OK"


def test_news_only_provider_is_not_ohlcv_source():
    result = resolve_provider_fallback(
        "AAPL",
        providers=[{"name": "finnhub", "kind": "news_only", "configured": True, "fetch": None}],
    )

    assert result["provider_statuses"][0]["status"] == "not_applicable"
    assert result["final_status"] == "FAILED"
