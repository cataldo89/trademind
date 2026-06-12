from __future__ import annotations

import csv
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import pandas as pd

from market_data import fetch_chart_dataframe
from historical_data_normalizer import normalize_historical_dataset
from market_data_quality import evaluate_market_data_quality


ProviderStatus = Dict[str, Any]


def _normalize_symbol_for_stooq(symbol: str, market: str) -> str:
    clean = symbol.replace(".", "-").lower()
    if market.upper() == "US" and not clean.endswith(".us"):
        return f"{clean}.us"
    return clean


def _range_to_days(range_: Optional[str]) -> int:
    normalized = (range_ or "2y").lower()
    if normalized.endswith("y"):
        return max(1, int(normalized[:-1] or "2")) * 365
    if normalized.endswith("mo"):
        return max(1, int(normalized[:-2] or "1")) * 31
    if normalized.endswith("d"):
        return max(1, int(normalized[:-1] or "1"))
    return 730


def _empty_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])


def _fetch_yahoo_chart(symbol: str, timeframe: str, range_: Optional[str], *_: Any) -> pd.DataFrame:
    return fetch_chart_dataframe(symbol, range_=range_ or "2y", interval=timeframe)


def _fetch_yfinance(symbol: str, timeframe: str, range_: Optional[str], *_: Any) -> pd.DataFrame:
    try:
        import yfinance as yf
    except Exception as exc:
        raise RuntimeError(f"yfinance import failed: {exc}") from exc

    ticker = yf.Ticker(symbol.replace(".", "-").upper())
    frame = ticker.history(period=range_ or "2y", interval=timeframe, auto_adjust=False)
    if frame is None or frame.empty:
        return _empty_frame()
    return frame.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})


def _fetch_finnhub(symbol: str, timeframe: str, range_: Optional[str], *_: Any) -> pd.DataFrame:
    api_key = os.getenv("FINNHUB_API_KEY")
    if not api_key:
        raise ProviderNotConfigured("FINNHUB_API_KEY is not configured")
        
    formatted_symbol = symbol.upper().replace("-", ".")
    url = f"https://finnhub.io/api/v1/quote?symbol={formatted_symbol}&token={api_key}"
    
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 TradeMind Quant'})
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = __import__("json").loads(response.read().decode('utf-8'))
        
    if "c" not in payload or payload["c"] == 0:
        raise RuntimeError(f"Respuesta inesperada de Finnhub o ticker inexistente: {payload}")
        
    price = float(payload["c"])
    timestamp = pd.to_datetime(payload.get("t", __import__("time").time()), unit="s", utc=True)
    
    frame = pd.DataFrame([{
        "time": timestamp,
        "open": price,
        "high": price,
        "low": price,
        "close": price,
        "volume": 0
    }])
    return frame


def _fetch_alpha_vantage(symbol: str, timeframe: str, range_: Optional[str], *_: Any) -> pd.DataFrame:
    api_key = os.getenv("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        raise ProviderNotConfigured("ALPHA_VANTAGE_API_KEY is not configured")
    if timeframe.lower() not in {"1d", "daily"}:
        raise RuntimeError("Alpha Vantage daily endpoint required for this timeframe")

    params = urllib.parse.urlencode(
        {
            "function": "TIME_SERIES_DAILY",
            "symbol": symbol.upper(),
            "outputsize": "full",
            "apikey": api_key,
        }
    )
    url = f"https://www.alphavantage.co/query?{params}"
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = __import__("json").loads(response.read().decode("utf-8"))

    note = payload.get("Note") or payload.get("Information")
    if note:
        raise ProviderRateLimited(str(note))
    series = payload.get("Time Series (Daily)")
    if not isinstance(series, dict):
        raise RuntimeError(str(payload.get("Error Message") or "Alpha Vantage did not return daily series"))

    rows = []
    cutoff_days = _range_to_days(range_)
    cutoff = pd.Timestamp(datetime.now(timezone.utc)) - pd.Timedelta(days=cutoff_days)
    for day, values in series.items():
        timestamp = pd.to_datetime(day, utc=True, errors="coerce")
        if pd.isna(timestamp) or timestamp < cutoff:
            continue
        rows.append(
            {
                "time": timestamp,
                "open": values.get("1. open"),
                "high": values.get("2. high"),
                "low": values.get("3. low"),
                "close": values.get("4. close"),
                "volume": values.get("5. volume"),
            }
        )
    frame = pd.DataFrame(rows)
    if frame.empty:
        return _empty_frame()
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame.sort_values("time")


class ProviderNotConfigured(RuntimeError):
    pass


class ProviderRateLimited(RuntimeError):
    pass


def _provider_registry() -> List[Dict[str, Any]]:
    return [
        {"name": "alpha-vantage", "kind": "ohlcv", "configured": bool(os.getenv("ALPHA_VANTAGE_API_KEY")), "fetch": _fetch_alpha_vantage},
        {"name": "finnhub", "kind": "ohlcv", "configured": bool(os.getenv("FINNHUB_API_KEY")), "fetch": _fetch_finnhub},
        {"name": "yahoo-chart", "kind": "ohlcv", "configured": True, "fetch": _fetch_yahoo_chart},
        {"name": "yfinance", "kind": "ohlcv", "configured": True, "fetch": _fetch_yfinance},
    ]


def _required_quality_flag(required_use: str) -> str:
    normalized = (required_use or "ml").lower()
    if normalized not in {"chart", "ta", "ml", "backtest"}:
        normalized = "ml"
    return f"usable_for_{normalized}"


def resolve_provider_fallback(
    symbol: str,
    market: str = "US",
    timeframe: str = "1d",
    range_: Optional[str] = "2y",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    required_use: str = "ml",
    providers: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    providers = providers or _provider_registry()
    providers_attempted: List[str] = []
    provider_statuses: List[ProviderStatus] = []
    errors: List[Dict[str, Any]] = []
    candidates: List[Dict[str, Any]] = []
    required_flag = _required_quality_flag(required_use)

    for provider in providers:
        name = provider["name"]
        providers_attempted.append(name)

        if provider.get("kind") != "ohlcv":
            provider_statuses.append({"provider": name, "status": "not_applicable", "reason": "Provider is not an OHLCV source"})
            continue

        if not provider.get("configured", False):
            provider_statuses.append({"provider": name, "status": "not_configured", "reason": "Missing API key or configuration"})
            continue

        fetch: Optional[Callable[..., pd.DataFrame]] = provider.get("fetch")
        if fetch is None:
            provider_statuses.append({"provider": name, "status": "not_configured", "reason": "Provider endpoint is not implemented"})
            continue

        try:
            frame = fetch(symbol, timeframe, range_, market)
            metadata = {"provider_status": "ok", "source": name, "adjusted": None}
            normalized = normalize_historical_dataset(
                symbol=symbol,
                provider=name,
                market=market,
                timeframe=timeframe,
                raw_dataset=frame,
                metadata=metadata,
            )
            dataset = normalized["normalized_dataset"]
            quality = evaluate_market_data_quality(
                symbol=symbol,
                provider=name,
                timeframe=timeframe,
                dataset=dataset,
                start_date=start_date,
                end_date=end_date,
                metadata={
                    **metadata,
                    "normalization_status": normalized["normalization_status"],
                    "adjusted_status": normalized["adjusted_status"],
                },
            )
            status = "ok" if quality.get(required_flag) else "bad_quality"
            provider_statuses.append(
                {
                    "provider": name,
                    "status": status,
                    "normalization_status": normalized["normalization_status"],
                    "quality_score": quality.get("quality_score", 0),
                    "usable_for_chart": quality.get("usable_for_chart", False),
                    "usable_for_ta": quality.get("usable_for_ta", False),
                    "usable_for_ml": quality.get("usable_for_ml", False),
                    "usable_for_backtest": quality.get("usable_for_backtest", False),
                    "blocking_errors": quality.get("blocking_errors", []),
                }
            )
            candidates.append({"provider": name, "dataset": dataset, "quality": quality, "normalization": normalized})
        except ProviderNotConfigured as exc:
            provider_statuses.append({"provider": name, "status": "not_configured", "reason": str(exc)})
        except ProviderRateLimited as exc:
            provider_statuses.append({"provider": name, "status": "rate_limited", "reason": str(exc)})
            errors.append({"provider": name, "status": "rate_limited", "message": str(exc)})
        except Exception as exc:
            provider_statuses.append({"provider": name, "status": "failed", "reason": str(exc)})
            errors.append({"provider": name, "status": "failed", "message": str(exc)})

    candidates.sort(key=lambda item: int(item["quality"].get("quality_score") or 0), reverse=True)
    usable_candidates = [item for item in candidates if item["quality"].get(required_flag)]
    selected = usable_candidates[0] if usable_candidates else (candidates[0] if candidates else None)

    if not selected:
        return {
            "symbol": symbol,
            "selected_provider": None,
            "selected_dataset": [],
            "selected_quality": None,
            "selected_normalization": None,
            "providers_attempted": providers_attempted,
            "provider_statuses": provider_statuses,
            "fallback_used": False,
            "usable_for_chart": False,
            "usable_for_ta": False,
            "usable_for_ml": False,
            "usable_for_backtest": False,
            "final_status": "FAILED",
            "reason": "No configured OHLCV provider returned data.",
            "errors": errors,
        }

    selected_quality = selected["quality"]
    selected_provider = selected["provider"]
    first_ohlcv = next((provider["name"] for provider in providers if provider.get("kind") == "ohlcv" and provider.get("configured")), None)
    required_ok = bool(selected_quality.get(required_flag))
    final_status = "OK" if required_ok and selected_quality.get("status") == "OK" else "WARNING" if required_ok else "FAILED"

    if required_ok:
        reason = f"Selected {selected_provider} with quality_score {selected_quality.get('quality_score')} for {required_use}."
    else:
        reason = f"No provider reached required_use={required_use}; selected best diagnostic provider {selected_provider}."

    return {
        "symbol": symbol,
        "selected_provider": selected_provider,
        "selected_dataset": selected["dataset"],
        "selected_quality": selected_quality,
        "selected_normalization": selected.get("normalization"),
        "providers_attempted": providers_attempted,
        "provider_statuses": provider_statuses,
        "fallback_used": bool(first_ohlcv and selected_provider != first_ohlcv),
        "usable_for_chart": bool(selected_quality.get("usable_for_chart")),
        "usable_for_ta": bool(selected_quality.get("usable_for_ta")),
        "usable_for_ml": bool(selected_quality.get("usable_for_ml")),
        "usable_for_backtest": bool(selected_quality.get("usable_for_backtest")),
        "final_status": final_status,
        "reason": reason,
        "errors": errors,
    }
