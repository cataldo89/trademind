import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from news_sentiment_pipeline import (
    NewsItem,
    aggregate_symbol_sentiment,
    merge_and_deduplicate,
    run_news_sentiment_update,
)


def test_merge_and_deduplicate_merges_providers_by_url():
    now = datetime.now(timezone.utc)
    merged = merge_and_deduplicate([
        [NewsItem(symbol="AAPL", provider="finnhub", published_at=now, title="Apple beats", url="https://x.test/a", raw_sentiment=0.4)],
        [NewsItem(symbol="AAPL", provider="marketaux", published_at=now, title="Apple beats", url="https://x.test/a", raw_sentiment=0.6)],
    ])

    assert len(merged) == 1
    assert merged[0].providers == ["finnhub", "marketaux"]
    assert merged[0].providers_raw_sentiment["finnhub"] == 0.4
    assert merged[0].providers_raw_sentiment["marketaux"] == 0.6


def test_aggregate_symbol_sentiment_by_horizon():
    now = datetime.now(timezone.utc)
    articles = [
        NewsItem(symbol="NVDA", provider="finnhub", published_at=now - timedelta(hours=2), title="NVDA raises outlook", raw_sentiment=0.5, finbert_numeric=1.0),
        NewsItem(symbol="NVDA", provider="marketaux", published_at=now - timedelta(days=3), title="NVDA probe risk", raw_sentiment=-0.4, finbert_numeric=-1.0),
        NewsItem(symbol="NVDA", provider="marketaux", published_at=now - timedelta(days=10), title="NVDA neutral", raw_sentiment=0.0, finbert_numeric=0.0),
    ]

    features = aggregate_symbol_sentiment(articles, [1, 5, 20], as_of=now)

    assert features["NVDA"][1]["sent_count_articles"] == 1
    assert features["NVDA"][1]["sent_mean_finbert"] == 1.0
    assert features["NVDA"][5]["sent_count_articles"] == 2
    assert features["NVDA"][5]["sent_share_negative"] == 0.5
    assert features["NVDA"][20]["sent_count_articles"] == 3


def test_run_news_sentiment_update_survives_provider_error(monkeypatch, tmp_path):
    now = datetime.now(timezone.utc)
    monkeypatch.chdir(tmp_path)

    def failing_finnhub(symbol, start, end):
        raise RuntimeError("rate limited")

    def fake_marketaux(symbols, start, end):
        return [
            NewsItem(symbol=symbols[0], provider="marketaux", published_at=now, title="AAPL growth", raw_sentiment=0.7)
        ]

    monkeypatch.setattr("news_sentiment_pipeline.fetch_finnhub_news", failing_finnhub)
    monkeypatch.setattr("news_sentiment_pipeline.fetch_marketaux_news", fake_marketaux)
    monkeypatch.setattr("news_sentiment_pipeline.score_article_finbert", lambda text: {"label": "positive", "score": 1.0, "numeric": 1.0})
    monkeypatch.setattr("news_sentiment_pipeline._persist_news_sentiment", lambda rows: None)

    result = run_news_sentiment_update(["AAPL"], [1, 5, 20])

    assert result["updated_symbols"] == ["AAPL"]
    assert result["articles_used"] == 1
    assert "finnhub:AAPL" in result["provider_errors"]
    assert result["features"]["AAPL"][1]["sent_mean_finbert"] == 1.0
