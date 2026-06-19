from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

logger = logging.getLogger(__name__)

MAX_SYMBOLS_PER_JOB = int(os.getenv("NEWS_SENTIMENT_MAX_SYMBOLS", "20"))
REQUEST_TIMEOUT_SECONDS = float(os.getenv("NEWS_SENTIMENT_SOURCE_TIMEOUT_SECONDS", "8"))
MARKETAUX_BATCH_SIZE = int(os.getenv("MARKETAUX_SENTIMENT_BATCH_SIZE", "20"))
MARKETAUX_PAGE_LIMIT = int(os.getenv("MARKETAUX_SENTIMENT_PAGE_LIMIT", "1"))
MARKETAUX_ARTICLES_PER_REQUEST = int(os.getenv("MARKETAUX_ARTICLES_PER_REQUEST", "20"))


@dataclass
class NewsItem:
    symbol: str
    provider: str
    published_at: datetime
    title: str
    summary: str = ""
    url: str = ""
    raw_sentiment: Optional[float] = None
    providers: List[str] = field(default_factory=list)
    providers_raw_sentiment: Dict[str, Optional[float]] = field(default_factory=dict)
    finbert_label: Optional[str] = None
    finbert_score: Optional[float] = None
    finbert_numeric: Optional[float] = None

    def __post_init__(self) -> None:
        self.symbol = self.symbol.upper().strip()
        if not self.providers:
            self.providers = [self.provider]
        if not self.providers_raw_sentiment:
            self.providers_raw_sentiment = {self.provider: self.raw_sentiment}


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value, tz=timezone.utc)
    elif isinstance(value, str) and value:
        normalized = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(normalized)
        except ValueError:
            try:
                dt = datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _bounded_float(value: Any) -> Optional[float]:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not -1 <= numeric <= 1:
        return max(-1.0, min(1.0, numeric))
    return numeric


def _request_json(client: httpx.Client, url: str, params: Dict[str, Any], headers: Optional[Dict[str, str]] = None) -> Any:
    attempts = int(os.getenv("NEWS_SENTIMENT_REQUEST_ATTEMPTS", "3"))
    for attempt in range(attempts):
        response = client.get(url, params=params, headers=headers)
        if response.status_code == 429 and attempt < attempts - 1:
            retry_after = response.headers.get("Retry-After")
            wait = float(retry_after) if retry_after and retry_after.isdigit() else 2**attempt
            time.sleep(min(wait, 8))
            continue
        response.raise_for_status()
        return response.json()
    return None


def fetch_finnhub_news(symbol: str, start: datetime, end: datetime) -> List[NewsItem]:
    token = os.getenv("FINNHUB_API_KEY")
    if not token:
        logger.warning("FINNHUB_API_KEY is not configured; skipping Finnhub sentiment source.")
        return []

    params = {
        "symbol": symbol.upper(),
        "from": start.date().isoformat(),
        "to": end.date().isoformat(),
        "token": token,
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            payload = _request_json(client, "https://finnhub.io/api/v1/company-news", params)
    except Exception as exc:
        logger.error("Finnhub news fetch failed for %s: %s", symbol, exc)
        return []

    if not isinstance(payload, list):
        return []

    items: List[NewsItem] = []
    for article in payload:
        title = str(article.get("headline") or "").strip()
        if not title:
            continue
        items.append(
            NewsItem(
                symbol=symbol,
                provider="finnhub",
                published_at=_parse_datetime(article.get("datetime")),
                title=title[:280],
                summary=str(article.get("summary") or "")[:800],
                url=str(article.get("url") or ""),
                raw_sentiment=_bounded_float(article.get("sentiment")),
            )
        )
    return items


def _marketaux_symbol_sentiment(article: Dict[str, Any], symbol: str) -> Optional[float]:
    target = symbol.upper()
    for entity in article.get("entities") or []:
        entity_symbol = str(entity.get("symbol") or "").upper()
        if entity_symbol == target:
            return _bounded_float(entity.get("sentiment_score"))
    return _bounded_float(article.get("sentiment_score"))


def fetch_marketaux_news(symbols: List[str], start: datetime, end: datetime) -> List[NewsItem]:
    api_key = os.getenv("MARKETAUX_API_KEY")
    if not api_key:
        logger.warning("MARKETAUX_API_KEY is not configured; skipping Marketaux sentiment source.")
        return []

    normalized_symbols = [symbol.upper().strip() for symbol in symbols if symbol.strip()]
    if not normalized_symbols:
        return []

    items: List[NewsItem] = []
    url = "https://api.marketaux.com/v1/news/all"
    batches = [
        normalized_symbols[index:index + MARKETAUX_BATCH_SIZE]
        for index in range(0, len(normalized_symbols), MARKETAUX_BATCH_SIZE)
    ]

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            for batch in batches:
                for page in range(1, max(1, MARKETAUX_PAGE_LIMIT) + 1):
                    params = {
                        "api_token": api_key,
                        "symbols": ",".join(batch),
                        "language": "en",
                        "published_after": start.isoformat(),
                        "published_before": end.isoformat(),
                        "must_have_entities": "true",
                        "limit": MARKETAUX_ARTICLES_PER_REQUEST,
                        "page": page,
                    }
                    payload = _request_json(client, url, params)
                    articles = payload.get("data") if isinstance(payload, dict) else []
                    if not articles:
                        break
                    for article in articles:
                        article_symbols = {
                            str(entity.get("symbol") or "").upper()
                            for entity in article.get("entities") or []
                        }
                        matched_symbols = [symbol for symbol in batch if symbol in article_symbols] or batch
                        for symbol in matched_symbols:
                            title = str(article.get("title") or "").strip()
                            if not title:
                                continue
                            items.append(
                                NewsItem(
                                    symbol=symbol,
                                    provider="marketaux",
                                    published_at=_parse_datetime(article.get("published_at")),
                                    title=title[:280],
                                    summary=str(article.get("description") or article.get("snippet") or "")[:800],
                                    url=str(article.get("url") or ""),
                                    raw_sentiment=_marketaux_symbol_sentiment(article, symbol),
                                )
                            )
    except Exception as exc:
        logger.error("Marketaux news fetch failed for %s: %s", ",".join(normalized_symbols), exc)
        return items

    return items


def merge_and_deduplicate(news_lists: List[List[NewsItem]]) -> List[NewsItem]:
    merged: Dict[str, NewsItem] = {}
    for item in [article for articles in news_lists for article in articles]:
        title_key = " ".join(item.title.lower().split())
        timestamp_key = item.published_at.replace(minute=0, second=0, microsecond=0).isoformat()
        key = item.url.lower().strip() if item.url else f"{item.symbol}:{title_key}:{timestamp_key}"
        existing = merged.get(key)
        if not existing:
            merged[key] = item
            continue
        providers = set(existing.providers) | set(item.providers) | {item.provider}
        existing.providers = sorted(providers)
        existing.providers_raw_sentiment[item.provider] = item.raw_sentiment
        if not existing.summary and item.summary:
            existing.summary = item.summary
    return sorted(merged.values(), key=lambda article: article.published_at, reverse=True)


def score_article_finbert(text: str) -> Dict[str, Any]:
    cleaned = text.strip()
    if not cleaned:
        return {"label": "neutral", "score": 0.0, "numeric": 0.0}

    try:
        from sentiment_models import get_pipeline

        pipe = get_pipeline()
        if pipe:
            prediction = pipe([cleaned[:600]])[0]
            label = str(prediction.get("label") or "neutral").lower()
            numeric = 1.0 if label == "positive" else -1.0 if label == "negative" else 0.0
            return {"label": label, "score": abs(numeric), "numeric": numeric}
    except Exception as exc:
        logger.error("FinBERT scoring failed, using lexical fallback: %s", exc)

    lowered = cleaned.lower()
    positive_tokens = ["beats", "raises", "surges", "growth", "profit", "record", "upgrade", "bullish"]
    negative_tokens = ["misses", "cuts", "falls", "loss", "downgrade", "bearish", "probe", "lawsuit"]
    pos = sum(1 for token in positive_tokens if token in lowered)
    neg = sum(1 for token in negative_tokens if token in lowered)
    numeric = 1.0 if pos > neg else -1.0 if neg > pos else 0.0
    label = "positive" if numeric > 0 else "negative" if numeric < 0 else "neutral"
    return {"label": label, "score": abs(numeric), "numeric": numeric}


def _mean(values: Iterable[Optional[float]]) -> Optional[float]:
    finite = [value for value in values if isinstance(value, (int, float))]
    if not finite:
        return None
    return sum(float(value) for value in finite) / len(finite)


def aggregate_symbol_sentiment(
    news: List[NewsItem],
    horizon_days: List[int],
    as_of: Optional[datetime] = None,
) -> Dict[str, Dict[int, Dict[str, Any]]]:
    as_of_dt = (as_of or datetime.now(timezone.utc)).astimezone(timezone.utc)
    by_symbol: Dict[str, Dict[int, Dict[str, Any]]] = {}
    symbols = sorted({article.symbol for article in news})

    for symbol in symbols:
        symbol_articles = [article for article in news if article.symbol == symbol]
        by_symbol[symbol] = {}
        window_means: Dict[int, Optional[float]] = {}
        for horizon in sorted(set(horizon_days)):
            window_start = as_of_dt - timedelta(days=horizon)
            articles = [article for article in symbol_articles if window_start <= article.published_at <= as_of_dt]
            finbert_values = [article.finbert_numeric for article in articles]
            raw_finnhub = [article.providers_raw_sentiment.get("finnhub") for article in articles]
            raw_marketaux = [article.providers_raw_sentiment.get("marketaux") for article in articles]
            finbert_mean = _mean(finbert_values) or 0.0
            negative = [value for value in finbert_values if isinstance(value, (int, float)) and value < 0]
            window_means[horizon] = finbert_mean if articles else None
            by_symbol[symbol][horizon] = {
                "symbol": symbol,
                "as_of": as_of_dt.isoformat(),
                "horizon_days": horizon,
                "sent_mean_raw_finnhub": _mean(raw_finnhub),
                "sent_mean_raw_marketaux": _mean(raw_marketaux),
                "sent_mean_finbert": finbert_mean,
                "sent_share_negative": len(negative) / len(articles) if articles else 0.0,
                "sent_count_articles": len(articles),
                "sent_trend_1d": None,
                "sent_trend_5d": None,
                "sent_trend_20d": None,
            }

        for horizon, features in by_symbol[symbol].items():
            current = window_means.get(horizon)
            if current is None:
                continue
            for trend_horizon in [1, 5, 20]:
                baseline = window_means.get(trend_horizon)
                if baseline is not None and trend_horizon != horizon:
                    features[f"sent_trend_{trend_horizon}d"] = current - baseline

    return by_symbol


def _persist_news_sentiment(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        logger.warning("Supabase env vars missing; news_sentiment rows were not persisted.")
        return

    endpoint = f"{supabase_url.rstrip('/')}/rest/v1/news_sentiment"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    params = {"on_conflict": "symbol,as_of,horizon_days"}
    with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = client.post(endpoint, params=params, headers=headers, json=rows)
        response.raise_for_status()


def _write_compat_sentiment_cache(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    latest_by_symbol: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if int(row["horizon_days"]) != 1:
            continue
        score = float(row["sent_mean_finbert"])
        sentiment = "POSITIVE" if score > 0.2 else "NEGATIVE" if score < -0.2 else "NEUTRAL"
        latest_by_symbol[row["symbol"]] = {
            "sentiment": sentiment,
            "score": score,
            "news_count": int(row["sent_count_articles"]),
            "method": "FinBERT Finnhub+Marketaux",
            "sources": ["finnhub", "marketaux"],
            "timestamp": row["as_of"],
        }
    if not latest_by_symbol:
        return
    cache: Dict[str, Any] = {}
    try:
        if os.path.exists("sentiment_cache.json"):
            with open("sentiment_cache.json", "r") as handle:
                cache = json.load(handle)
    except Exception as exc:
        logger.warning("Could not read old sentiment_cache.json: %s", exc)
    cache.update(latest_by_symbol)
    with open("sentiment_cache.json", "w") as handle:
        json.dump(cache, handle)


def run_news_sentiment_update(symbols: List[str], horizon_days: Optional[List[int]] = None) -> Dict[str, Any]:
    normalized_symbols = []
    seen = set()
    for symbol in symbols:
        normalized = symbol.strip().upper()
        if normalized and normalized not in seen:
            seen.add(normalized)
            normalized_symbols.append(normalized)
    limited_symbols = normalized_symbols[:MAX_SYMBOLS_PER_JOB]
    horizons = sorted(set(horizon_days or [1, 5, 20]))
    max_horizon = max(horizons) if horizons else 20
    as_of = datetime.now(timezone.utc)
    start = as_of - timedelta(days=max(max_horizon, 1))

    provider_errors: Dict[str, str] = {}
    finnhub_articles: List[NewsItem] = []
    for symbol in limited_symbols:
        try:
            finnhub_articles.extend(fetch_finnhub_news(symbol, start, as_of))
        except Exception as exc:
            provider_errors[f"finnhub:{symbol}"] = str(exc)

    try:
        marketaux_articles = fetch_marketaux_news(limited_symbols, start, as_of)
    except Exception as exc:
        provider_errors["marketaux"] = str(exc)
        marketaux_articles = []

    merged = merge_and_deduplicate([finnhub_articles, marketaux_articles])
    for article in merged:
        text = " ".join(part for part in [article.title, article.summary] if part)
        scored = score_article_finbert(text)
        article.finbert_label = scored["label"]
        article.finbert_score = float(scored["score"])
        article.finbert_numeric = float(scored["numeric"])

    aggregated = aggregate_symbol_sentiment(merged, horizons, as_of)
    for symbol in limited_symbols:
        if symbol in aggregated:
            continue
        aggregated[symbol] = {
            horizon: {
                "symbol": symbol,
                "as_of": as_of.isoformat(),
                "horizon_days": horizon,
                "sent_mean_raw_finnhub": None,
                "sent_mean_raw_marketaux": None,
                "sent_mean_finbert": 0.0,
                "sent_share_negative": 0.0,
                "sent_count_articles": 0,
                "sent_trend_1d": None,
                "sent_trend_5d": None,
                "sent_trend_20d": None,
            }
            for horizon in horizons
        }
    rows = [
        features
        for symbol_features in aggregated.values()
        for features in symbol_features.values()
    ]

    try:
        _persist_news_sentiment(rows)
    except Exception as exc:
        provider_errors["supabase"] = str(exc)
        logger.error("Persisting news_sentiment failed: %s", exc)

    _write_compat_sentiment_cache(rows)

    return {
        "updated_symbols": sorted(aggregated.keys()),
        "requested_symbols": len(normalized_symbols),
        "processed_symbols": len(limited_symbols),
        "truncated": len(normalized_symbols) > len(limited_symbols),
        "limit": MAX_SYMBOLS_PER_JOB,
        "horizons": horizons,
        "articles_used": len(merged),
        "provider_errors": provider_errors,
        "features": aggregated,
    }


def serialize_news_item(item: NewsItem) -> Dict[str, Any]:
    data = asdict(item)
    data["published_at"] = item.published_at.isoformat()
    return data
