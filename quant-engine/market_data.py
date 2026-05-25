from __future__ import annotations

import json
import urllib.parse
import urllib.request

import pandas as pd


def fetch_chart_dataframe(symbol: str, range_: str = "1y", interval: str = "1d") -> pd.DataFrame:
    encoded_symbol = urllib.parse.quote(symbol.replace(".", "-").upper())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_symbol}"
        f"?range={range_}&interval={interval}"
    )
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 TradeMind Quant Engine",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception:
        return pd.DataFrame()

    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        return pd.DataFrame()

    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    if not timestamps or not quote:
        return pd.DataFrame()

    frame = pd.DataFrame(
        {
            "Open": quote.get("open"),
            "High": quote.get("high"),
            "Low": quote.get("low"),
            "Close": quote.get("close"),
            "Volume": quote.get("volume"),
        },
        index=pd.to_datetime(timestamps, unit="s", utc=True),
    )

    return frame.dropna(subset=["Close"])
