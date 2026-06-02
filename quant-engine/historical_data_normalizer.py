from __future__ import annotations

from typing import Any, Dict, List, Optional

import pandas as pd


PRICE_COLUMNS = ["open", "high", "low", "close"]
REQUIRED_COLUMNS = PRICE_COLUMNS + ["volume"]
TIME_ALIASES = {"date", "datetime", "timestamp", "time"}
COLUMN_ALIASES = {
    "date": "time",
    "datetime": "time",
    "timestamp": "time",
    "time": "time",
    "open": "open",
    "high": "high",
    "low": "low",
    "close": "close",
    "adjclose": "adj_close",
    "adj_close": "adj_close",
    "adj_close_": "adj_close",
    "adjusted_close": "adj_close",
    "volume": "volume",
}


def _issue(code: str, message: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    item: Dict[str, Any] = {"code": code, "message": message}
    if details:
        item["details"] = details
    return item


def _normalize_name(name: Any) -> str:
    text = str(name).strip().lower().replace(" ", "_").replace("-", "_")
    text = text.replace(".", "_")
    return COLUMN_ALIASES.get(text, text)


def _raw_to_frame(raw_dataset: Any) -> pd.DataFrame:
    if isinstance(raw_dataset, pd.DataFrame):
        frame = raw_dataset.copy()
    else:
        frame = pd.DataFrame(list(raw_dataset or []))

    if not isinstance(frame.index, pd.RangeIndex):
        index_name = frame.index.name or "time"
        if _normalize_name(index_name) in TIME_ALIASES or isinstance(frame.index, pd.DatetimeIndex):
            frame = frame.reset_index().rename(columns={index_name: "time", "index": "time"})

    rename_map = {column: _normalize_name(column) for column in frame.columns}
    return frame.rename(columns=rename_map)


def _metadata_adjusted_status(metadata: Dict[str, Any]) -> str:
    for key in ("adjusted", "is_adjusted", "auto_adjust", "uses_adjusted_close"):
        if key not in metadata:
            continue
        value = metadata.get(key)
        if isinstance(value, bool):
            return "adjusted" if value else "unadjusted"
        if isinstance(value, str):
            normalized = value.lower()
            if normalized in {"true", "yes", "1", "adjusted"}:
                return "adjusted"
            if normalized in {"false", "no", "0", "raw", "unadjusted"}:
                return "unadjusted"
    return "unknown"


def _coerce_time(values: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(values):
        return pd.to_datetime(values, utc=True, errors="coerce")

    numeric = pd.to_numeric(values, errors="coerce")
    numeric_count = int(numeric.notna().sum())
    if numeric_count > 0 and numeric_count >= max(1, int(len(values) * 0.8)):
        median_value = float(numeric.dropna().median())
        unit = "ms" if median_value > 10_000_000_000 else "s"
        return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")

    return pd.to_datetime(values, utc=True, errors="coerce")


def normalize_historical_dataset(
    symbol: str,
    provider: str,
    market: str,
    timeframe: str,
    raw_dataset: Any,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    metadata = metadata or {}
    issues: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    diagnostics: Dict[str, Any] = {"input_rows": 0, "dropped_rows": 0, "duplicate_rows_removed": 0}

    frame = _raw_to_frame(raw_dataset)
    diagnostics["input_rows"] = int(len(frame))
    diagnostics["input_columns"] = [str(column) for column in frame.columns]

    if frame.empty and len(frame.columns) == 0:
        return {
            "symbol": symbol,
            "provider": provider,
            "normalized_dataset": [],
            "row_count": 0,
            "timezone": "unknown",
            "currency": metadata.get("currency"),
            "adjusted_status": _metadata_adjusted_status(metadata),
            "normalization_status": "FAILED",
            "issues": [_issue("EMPTY_DATASET", "Raw dataset is empty.")],
            "warnings": warnings,
            "raw_diagnostics": diagnostics,
        }

    if "time" not in frame.columns:
        issues.append(_issue("MISSING_TIME_COLUMN", "Raw dataset has no date/time column."))

    missing_columns = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing_columns:
        issues.append(_issue("MISSING_OHLCV_COLUMNS", "Raw dataset is missing OHLCV columns.", {"missing_columns": missing_columns}))

    if issues:
        return {
            "symbol": symbol,
            "provider": provider,
            "normalized_dataset": [],
            "row_count": 0,
            "timezone": "unknown",
            "currency": metadata.get("currency"),
            "adjusted_status": _metadata_adjusted_status(metadata),
            "normalization_status": "FAILED",
            "issues": issues,
            "warnings": warnings,
            "raw_diagnostics": diagnostics,
        }

    timezone = str(metadata.get("timezone") or metadata.get("tz") or "unknown")
    raw_time = frame["time"]
    if not pd.api.types.is_datetime64_any_dtype(raw_time) and raw_time.map(lambda value: isinstance(value, str) and not any(token in value for token in ("Z", "+", "-"))).any():
        warnings.append(_issue("TIMEZONE_UNKNOWN", "Provider did not declare timezone for at least one timestamp."))

    frame["time"] = _coerce_time(raw_time)
    if frame["time"].isna().any():
        bad = int(frame["time"].isna().sum())
        warnings.append(_issue("INVALID_TIMESTAMPS_DROPPED", "Rows with invalid timestamps were dropped.", {"rows": bad}))
        diagnostics["dropped_rows"] += bad
        frame = frame.dropna(subset=["time"])

    for column in REQUIRED_COLUMNS + (["adj_close"] if "adj_close" in frame.columns else []):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    null_required = frame[REQUIRED_COLUMNS].isna().any(axis=1)
    if bool(null_required.any()):
        count = int(null_required.sum())
        warnings.append(_issue("NULL_OHLCV_DROPPED", "Rows with null OHLCV values were dropped.", {"rows": count}))
        diagnostics["dropped_rows"] += count
        frame = frame[~null_required]

    non_positive_prices = (frame[PRICE_COLUMNS] <= 0).any(axis=1)
    if bool(non_positive_prices.any()):
        count = int(non_positive_prices.sum())
        issues.append(_issue("NON_POSITIVE_PRICES_DROPPED", "Rows with zero or negative prices were rejected.", {"rows": count}))
        diagnostics["dropped_rows"] += count
        frame = frame[~non_positive_prices]

    zero_volume_count = int((frame["volume"].fillna(0) <= 0).sum())
    if zero_volume_count:
        warnings.append(_issue("ZERO_OR_NULL_VOLUME", "Dataset contains zero or null volume.", {"rows": zero_volume_count}))

    before_dedupe = len(frame)
    frame = frame.drop_duplicates(subset=["time", "open", "high", "low", "close", "volume"])
    diagnostics["duplicate_rows_removed"] = before_dedupe - len(frame)
    if diagnostics["duplicate_rows_removed"]:
        warnings.append(_issue("DUPLICATE_ROWS_REMOVED", "Exact duplicate candles were removed.", {"rows": diagnostics["duplicate_rows_removed"]}))

    frame = frame.sort_values("time")
    adjusted_status = _metadata_adjusted_status(metadata)
    if "adj_close" in frame.columns and adjusted_status == "unknown":
        warnings.append(_issue("ADJUSTMENT_AMBIGUOUS", "adj_close exists but OHLC adjustment status is not declared."))

    normalized_dataset: List[Dict[str, Any]] = []
    for row in frame.to_dict(orient="records"):
        timestamp = pd.Timestamp(row["time"])
        normalized_dataset.append(
            {
                "time": int(timestamp.timestamp()),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            }
        )

    diagnostics["output_rows"] = len(normalized_dataset)
    if not normalized_dataset:
        issues.append(_issue("NO_NORMALIZED_ROWS", "No rows remained after normalization."))

    status = "FAILED" if not normalized_dataset else "WARNING" if issues or warnings else "OK"
    return {
        "symbol": symbol,
        "provider": provider,
        "normalized_dataset": normalized_dataset,
        "row_count": len(normalized_dataset),
        "timezone": timezone,
        "currency": metadata.get("currency"),
        "adjusted_status": adjusted_status,
        "normalization_status": status,
        "issues": issues,
        "warnings": warnings,
        "raw_diagnostics": diagnostics,
    }
