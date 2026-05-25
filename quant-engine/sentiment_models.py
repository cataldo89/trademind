import json
import logging
import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from typing import Callable, Dict, List, Optional

os.environ["HF_HOME"] = "./modelos_locales"

logger = logging.getLogger(__name__)

_sentiment_pipeline = None

DEFAULT_MAX_HEADLINES = int(os.getenv("SENTIMENT_MAX_HEADLINES", "25"))
SOURCE_TIMEOUT_SECONDS = float(os.getenv("SENTIMENT_SOURCE_TIMEOUT_SECONDS", "6"))
DEFAULT_SOURCES = "google,gdelt,yahoo,finnhub,newsapi,sec,presswire,macro"
ENABLED_SOURCES = {
    source.strip().lower()
    for source in os.getenv("SENTIMENT_NEWS_SOURCES", DEFAULT_SOURCES).split(",")
    if source.strip()
}

PRESSWIRE_RSS_FEEDS = [
    ("PR Newswire", "https://www.prnewswire.com/rss/news-releases-list.rss"),
    (
        "GlobeNewswire Public Companies",
        "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
    ),
    (
        "GlobeNewswire Earnings",
        "https://www.globenewswire.com/RssFeed/subjectcode/13-Earnings%20Releases%20and%20Operating%20Results/feedTitle/GlobeNewswire%20-%20Earnings%20Releases%20and%20Operating%20Results",
    ),
    (
        "GlobeNewswire M&A",
        "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20and%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20and%20Acquisitions",
    ),
]

MACRO_RSS_FEEDS = [
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("BLS Employment Situation", "https://www.bls.gov/feed/empsit.rss"),
    ("BLS CPI", "https://www.bls.gov/feed/cpi.rss"),
    ("BLS Productivity", "https://www.bls.gov/feed/lpc_latest.rss"),
    ("BEA Releases", "https://apps.bea.gov/rss/rss.xml"),
]


def _json_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: float = SOURCE_TIMEOUT_SECONDS) -> Dict:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": os.getenv("SENTIMENT_USER_AGENT", "TradeMindQuantEngine/1.0"),
            "Accept": "application/json",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _rss_get(url: str, source: str, timeout: float = SOURCE_TIMEOUT_SECONDS) -> List[dict]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": os.getenv("SENTIMENT_USER_AGENT", "TradeMindQuantEngine/1.0"),
            "Accept": "application/rss+xml, application/atom+xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        xml_data = response.read()

    root = ET.fromstring(xml_data)
    items = root.findall(".//item")
    if not items:
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    headlines = []
    for item in items[:20]:
        title = item.findtext("title") or item.findtext("{http://www.w3.org/2005/Atom}title")
        if title:
            headlines.append({"title": title.strip(), "source": source})
    return headlines


def _is_relevant(title: str, symbol: str) -> bool:
    text = title.lower()
    normalized_symbol = symbol.strip().lower()
    return (
        f"${normalized_symbol}" in text
        or f" {normalized_symbol} " in f" {text} "
        or f"({normalized_symbol})" in text
        or f":{normalized_symbol}" in text
    )


def _extra_rss_feeds() -> List[tuple]:
    feeds = []
    raw = os.getenv("SENTIMENT_EXTRA_RSS_FEEDS", "")
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "=" in entry:
            name, url = entry.split("=", 1)
            feeds.append((name.strip(), url.strip()))
        else:
            feeds.append(("Custom RSS", entry))
    return feeds


def _dedupe_headlines(headlines: List[dict], limit: int = DEFAULT_MAX_HEADLINES) -> List[dict]:
    seen = set()
    unique = []
    for item in headlines:
        title = (item.get("title") or "").strip()
        if not title:
            continue
        key = " ".join(title.lower().split())
        if key in seen:
            continue
        seen.add(key)
        unique.append({**item, "title": title})
        if len(unique) >= limit:
            break
    return unique


def get_pipeline():
    global _sentiment_pipeline
    if _sentiment_pipeline is None:
        logger.info("Cargando modelo FinBERT en memoria (CUDA si esta disponible)...")
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            device = 0 if torch.cuda.is_available() else -1
            tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
            model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert")
            if device == 0:
                model = model.to("cuda")

            labels = {0: "positive", 1: "negative", 2: "neutral"}

            def classify(texts: List[str]):
                encoded = tokenizer(texts, padding=True, truncation=True, max_length=128, return_tensors="pt")
                if device == 0:
                    encoded = {key: value.to("cuda") for key, value in encoded.items()}
                with torch.no_grad():
                    logits = model(**encoded).logits
                predictions = torch.argmax(logits, dim=1).detach().cpu().tolist()
                return [{"label": labels.get(prediction, "neutral")} for prediction in predictions]

            _sentiment_pipeline = classify
            logger.info(f"Modelo FinBERT cargado en {'CUDA' if device == 0 else 'CPU'}")
        except Exception as e:
            logger.error(f"Error cargando FinBERT, se usara fallback: {e}")
            _sentiment_pipeline = None
    return _sentiment_pipeline


def fetch_google_news(symbol: str) -> List[dict]:
    query = urllib.parse.quote(f"{symbol} stock OR shares")
    url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
    try:
        return _rss_get(url, "Google News")
    except Exception as e:
        logger.error(f"Error fetch_google_news for {symbol}: {e}")
        return []


def fetch_gdelt_news(symbol: str) -> List[dict]:
    query = urllib.parse.quote(f'("{symbol}" stock OR "{symbol}" shares)')
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc"
        f"?query={query}&mode=ArtList&format=json&maxrecords=10&sort=HybridRel"
    )
    try:
        payload = _json_get(url)
        return [
            {"title": article.get("title", ""), "source": "GDELT"}
            for article in payload.get("articles", [])
            if article.get("title")
        ]
    except Exception as e:
        logger.error(f"Error fetch_gdelt_news for {symbol}: {e}")
        return []


def fetch_yahoo_news(symbol: str) -> List[dict]:
    try:
        import yfinance as yf

        ticker = yf.Ticker(symbol)
        articles = getattr(ticker, "news", None) or []
        headlines = []
        for article in articles[:10]:
            content = article.get("content") if isinstance(article, dict) else None
            title = content.get("title") if isinstance(content, dict) else None
            if not title and isinstance(article, dict):
                title = article.get("title")
            if title:
                headlines.append({"title": title, "source": "Yahoo Finance"})
        return headlines
    except Exception as e:
        logger.error(f"Error fetch_yahoo_news for {symbol}: {e}")
        return []


def fetch_finnhub_news(symbol: str) -> List[dict]:
    token = os.getenv("FINNHUB_API_KEY")
    if not token:
        return []

    to_date = date.today()
    from_date = to_date - timedelta(days=int(os.getenv("SENTIMENT_LOOKBACK_DAYS", "14")))
    params = urllib.parse.urlencode(
        {
            "symbol": symbol,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "token": token,
        }
    )
    url = f"https://finnhub.io/api/v1/company-news?{params}"
    try:
        payload = _json_get(url)
        return [
            {"title": article.get("headline", ""), "source": "Finnhub"}
            for article in payload[:10]
            if article.get("headline")
        ]
    except Exception as e:
        logger.error(f"Error fetch_finnhub_news for {symbol}: {e}")
        return []


def fetch_newsapi_news(symbol: str) -> List[dict]:
    api_key = os.getenv("NEWSAPI_KEY")
    if not api_key:
        return []

    params = urllib.parse.urlencode(
        {
            "q": f'"{symbol}" AND (stock OR shares OR earnings OR acquisition)',
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": 10,
            "apiKey": api_key,
        }
    )
    url = f"https://newsapi.org/v2/everything?{params}"
    try:
        payload = _json_get(url)
        return [
            {"title": article.get("title", ""), "source": "NewsAPI"}
            for article in payload.get("articles", [])
            if article.get("title")
        ]
    except Exception as e:
        logger.error(f"Error fetch_newsapi_news for {symbol}: {e}")
        return []


def fetch_sec_filings(symbol: str) -> List[dict]:
    sec_user_agent = os.getenv("SEC_USER_AGENT")
    if not sec_user_agent:
        return []

    forms = os.getenv("SENTIMENT_SEC_FORMS", "8-K,10-K,10-Q").split(",")
    headers = {"User-Agent": sec_user_agent}
    headlines = []
    for form in forms:
        params = urllib.parse.urlencode(
            {
                "action": "getcompany",
                "CIK": symbol,
                "type": form.strip(),
                "owner": "exclude",
                "count": 5,
                "output": "atom",
            }
        )
        url = f"https://www.sec.gov/cgi-bin/browse-edgar?{params}"
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=SOURCE_TIMEOUT_SECONDS) as response:
                root = ET.fromstring(response.read())
            for entry in root.findall(".//{http://www.w3.org/2005/Atom}entry")[:5]:
                title = entry.findtext("{http://www.w3.org/2005/Atom}title")
                if title:
                    headlines.append({"title": f"SEC filing: {title.strip()}", "source": "SEC EDGAR"})
        except Exception as e:
            logger.error(f"Error fetch_sec_filings for {symbol}/{form}: {e}")
    return headlines


def fetch_presswire_news(symbol: str) -> List[dict]:
    headlines = []
    for name, url in PRESSWIRE_RSS_FEEDS + _extra_rss_feeds():
        try:
            feed_headlines = _rss_get(url, name)
            headlines.extend([item for item in feed_headlines if _is_relevant(item["title"], symbol)])
        except Exception as e:
            logger.error(f"Error fetch_presswire_news for {symbol}/{name}: {e}")
    return headlines


def fetch_macro_news(symbol: str) -> List[dict]:
    if os.getenv("SENTIMENT_INCLUDE_MACRO_NEWS", "false").lower() != "true":
        return []

    headlines = []
    for name, url in MACRO_RSS_FEEDS:
        try:
            headlines.extend(_rss_get(url, name)[:3])
        except Exception as e:
            logger.error(f"Error fetch_macro_news for {symbol}/{name}: {e}")
    return headlines


SOURCE_FETCHERS: Dict[str, Callable[[str], List[dict]]] = {
    "google": fetch_google_news,
    "gdelt": fetch_gdelt_news,
    "yahoo": fetch_yahoo_news,
    "finnhub": fetch_finnhub_news,
    "newsapi": fetch_newsapi_news,
    "sec": fetch_sec_filings,
    "presswire": fetch_presswire_news,
    "macro": fetch_macro_news,
}


def fetch_combined_news(symbol: str) -> List[dict]:
    tasks = [
        (name, fetcher)
        for name, fetcher in SOURCE_FETCHERS.items()
        if name in ENABLED_SOURCES
    ]
    if not tasks:
        return []

    headlines = []
    max_workers = min(len(tasks), int(os.getenv("SENTIMENT_SOURCE_CONCURRENCY", "6")))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_source = {executor.submit(fetcher, symbol): name for name, fetcher in tasks}
        for future in as_completed(future_to_source):
            source = future_to_source[future]
            try:
                headlines.extend(future.result())
            except Exception as e:
                logger.error(f"Error running sentiment source {source} for {symbol}: {e}")

    return _dedupe_headlines(headlines)


def analyze_sentiment_batch(symbols: List[str]) -> Dict[str, dict]:
    results = {}
    pipe = get_pipeline()

    for sym in symbols:
        try:
            articles = fetch_combined_news(sym)
            texts = [article["title"] for article in articles]
            sources = sorted({article.get("source", "Unknown") for article in articles})

            if not texts:
                results[sym] = {
                    "sentiment": "NEUTRAL",
                    "score": 0,
                    "news_count": 0,
                    "method": "No headlines",
                    "sources": [],
                    "texts": [],
                }
                continue

            if pipe:
                preds = pipe(texts)
                pos = sum(1 for p in preds if p["label"] == "positive")
                neg = sum(1 for p in preds if p["label"] == "negative")

                score = pos - neg
                if score > 1:
                    overall = "POSITIVE"
                elif score < -1:
                    overall = "NEGATIVE"
                else:
                    overall = "NEUTRAL"

                results[sym] = {
                    "sentiment": overall,
                    "score": score,
                    "news_count": len(texts),
                    "method": "FinBERT multi-source",
                    "sources": sources,
                    "texts": texts,
                }
            else:
                results[sym] = {
                    "sentiment": "NEUTRAL",
                    "score": 0,
                    "news_count": len(texts),
                    "method": "Fallback multi-source headlines",
                    "sources": sources,
                    "texts": texts,
                }

        except Exception as e:
            logger.error(f"Error procesando {sym}: {e}")
            results[sym] = {"sentiment": "NEUTRAL", "score": 0, "news_count": 0, "sources": [], "texts": []}

    return results


def run_daily_sentiment_job(symbols: List[str]):
    logger.info(f"Iniciando escaneo masivo de noticias para {len(symbols)} activos...")
    data = analyze_sentiment_batch(symbols)

    cache = {}
    try:
        if os.path.exists("sentiment_cache.json"):
            with open("sentiment_cache.json", "r") as f:
                cache = json.load(f)
    except Exception as e:
        logger.warning(f"No se pudo leer sentiment_cache.json previo: {e}")

    cache.update(data)
    with open("sentiment_cache.json", "w") as f:
        json.dump(cache, f)

    logger.info("Escaneo finalizado y cache actualizado.")
    return data


def get_cached_sentiment(symbol: str) -> dict:
    try:
        if os.path.exists("sentiment_cache.json"):
            with open("sentiment_cache.json", "r") as f:
                cache = json.load(f)
                return cache.get(symbol, None)
    except Exception:
        pass
    return None
