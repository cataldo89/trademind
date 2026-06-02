from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

import math
import pandas as pd


REQUIRED_PRICE_COLUMNS = ["open", "high", "low", "close"]
REQUIRED_COLUMNS = REQUIRED_PRICE_COLUMNS + ["volume"]
TIME_COLUMN_ALIASES = ["time", "timestamp", "date", "datetime"]


def _issue(code: str, message: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    item: Dict[str, Any] = {"code": code, "message": message}
    if details:
        item["details"] = details
    return item


def _normalize_column_name(name: Any) -> str:
    return str(name).strip().lower().replace(" ", "_")


def _coerce_time_series(values: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(values):
        return pd.to_datetime(values, utc=True, errors="coerce")

    numeric = pd.to_numeric(values, errors="coerce")
    numeric_count = int(numeric.notna().sum())

    if numeric_count > 0 and numeric_count >= max(1, int(len(values) * 0.8)):
        median_value = float(numeric.dropna().median())
        unit = "ms" if median_value > 10_000_000_000 else "s"
        return pd.to_datetime(numeric, unit=unit, utc=True, errors="coerce")

    return pd.to_datetime(values, utc=True, errors="coerce")


def _dataset_to_frame(dataset: Any) -> pd.DataFrame:
    if isinstance(dataset, pd.DataFrame):
        source = dataset.copy()
    else:
        source = pd.DataFrame(list(dataset or []))

    if source.empty and len(source.columns) == 0:
        return pd.DataFrame()

    rename_map = {column: _normalize_column_name(column) for column in source.columns}
    source = source.rename(columns=rename_map)

    time_column = next((column for column in TIME_COLUMN_ALIASES if column in source.columns), None)
    if time_column:
        source["time"] = _coerce_time_series(source[time_column])
    elif isinstance(source.index, pd.DatetimeIndex):
        source["time"] = pd.to_datetime(source.index, utc=True, errors="coerce")
    else:
        source["time"] = pd.NaT

    for column in REQUIRED_COLUMNS:
        if column in source.columns:
            source[column] = pd.to_numeric(source[column], errors="coerce")

    return source.reset_index(drop=True)


def _metadata_failure(metadata: Dict[str, Any]) -> Optional[str]:
    if not metadata:
        return None

    for key in ("error", "provider_error", "failure", "exception"):
        value = metadata.get(key)
        if value:
            return str(value)

    status = str(metadata.get("status") or metadata.get("provider_status") or "").lower()
    if status in {"error", "failed", "failure", "no_data", "empty"}:
        return status

    for key in ("note", "information", "warning"):
        value = metadata.get(key)
        if value and any(token in str(value).lower() for token in ("limit", "error", "fail", "empty", "no data")):
            return str(value)

    chart = metadata.get("chart")
    if isinstance(chart, dict):
        error = chart.get("error")
        if error:
            return str(error)

    return None


def _adjustment_status(metadata: Dict[str, Any]) -> Optional[bool]:
    for key in ("adjusted", "is_adjusted", "auto_adjust", "uses_adjusted_close"):
        if key in metadata:
            value = metadata.get(key)
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                if value.lower() in {"true", "yes", "1", "adjusted"}:
                    return True
                if value.lower() in {"false", "no", "0", "raw", "unadjusted"}:
                    return False

    columns = metadata.get("columns")
    if isinstance(columns, Iterable) and not isinstance(columns, (str, bytes)):
        normalized_columns = {_normalize_column_name(column) for column in columns}
        if "adjclose" in normalized_columns or "adj_close" in normalized_columns:
            return True

    return None


def _expected_interval_seconds(timeframe: str, observed_median: Optional[float]) -> float:
    normalized = (timeframe or "").lower()
    mapping = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
        "daily": 86400,
        "1w": 604800,
        "1wk": 604800,
        "weekly": 604800,
        "1mo": 2592000,
        "monthly": 2592000,
    }
    if normalized in mapping:
        return float(mapping[normalized])
    if observed_median and observed_median > 0:
        return float(observed_median)
    return 86400.0


def _quality_thresholds(timeframe: str) -> Dict[str, int]:
    normalized = (timeframe or "").lower()
    intraday = normalized in {"1m", "5m", "15m", "30m", "1h", "4h"}
    return {
        "min_chart_candles": 1,
        "min_ta_candles": 50,
        "min_ml_candles": 120,
        "min_backtest_candles": 252,
        "min_ml_history_days": 20 if intraday else 180,
        "min_backtest_history_days": 60 if intraday else 365,
    }


def evaluate_market_data_quality(
    symbol: str,
    provider: str,
    timeframe: str,
    dataset: Any,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    metadata = metadata or {}
    frame = _dataset_to_frame(dataset)
    thresholds = _quality_thresholds(timeframe)

    issues: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    blocking_errors: List[Dict[str, Any]] = []
    score = 100

    provider_failure = _metadata_failure(metadata)
    if provider_failure:
        blocking_errors.append(_issue("PROVIDER_FAILURE", "Provider reported a failure.", {"provider_failure": provider_failure}))
        score -= 50

    missing_columns = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    has_time = "time" in frame.columns and frame["time"].notna().any()
    if not has_time:
        blocking_errors.append(_issue("MISSING_TIME_COLUMN", "Dataset has no usable time/date column."))
        score -= 40

    if missing_columns:
        blocking_errors.append(
            _issue("MISSING_OHLCV_COLUMNS", "Dataset is missing required OHLCV columns.", {"missing_columns": missing_columns})
        )
        score -= 45

    row_count = int(len(frame))
    if row_count == 0:
        blocking_errors.append(_issue("EMPTY_DATASET", "Dataset is empty."))
        if not provider_failure:
            blocking_errors.append(_issue("PROVIDER_SILENT_FAILURE", "Provider returned no rows without a structured error."))
        score -= 80

    null_counts: Dict[str, int] = {}
    non_positive_price_count = 0
    invalid_ohlc_count = 0
    null_volume_count = 0
    zero_volume_count = 0
    duplicate_time_count = 0
    chronological = True
    min_time = None
    max_time = None
    history_days = 0.0
    expected_missing_periods = 0
    expected_missing_ratio = 0.0
    large_gap_count = 0
    median_gap_seconds: Optional[float] = None
    max_gap_seconds: Optional[float] = None

    if row_count > 0 and not missing_columns:
        for column in REQUIRED_COLUMNS:
            null_counts[column] = int(frame[column].isna().sum())

        price_frame = frame[REQUIRED_PRICE_COLUMNS]
        price_nulls = sum(null_counts[column] for column in REQUIRED_PRICE_COLUMNS)
        if price_nulls:
            issues.append(_issue("NULL_PRICE_VALUES", "Open/high/low/close contain null values.", {"null_price_cells": price_nulls}))
            score -= min(25, price_nulls * 2)

        non_positive_mask = (price_frame <= 0).any(axis=1)
        non_positive_price_count = int(non_positive_mask.sum())
        if non_positive_price_count:
            blocking_errors.append(
                _issue("NON_POSITIVE_PRICES", "Dataset contains zero or negative OHLC prices.", {"rows": non_positive_price_count})
            )
            score -= 45

        invalid_ohlc_mask = (
            (frame["high"] < frame[["open", "close", "low"]].max(axis=1))
            | (frame["low"] > frame[["open", "close", "high"]].min(axis=1))
        )
        invalid_ohlc_count = int(invalid_ohlc_mask.sum())
        if invalid_ohlc_count:
            blocking_errors.append(_issue("INVALID_OHLC_RANGE", "OHLC rows have inconsistent high/low ranges.", {"rows": invalid_ohlc_count}))
            score -= 35

        null_volume_count = int(frame["volume"].isna().sum())
        zero_volume_count = int((frame["volume"].fillna(0) <= 0).sum())
        if null_volume_count:
            warnings.append(_issue("NULL_VOLUME_VALUES", "Volume contains null values.", {"rows": null_volume_count}))
            score -= min(12, null_volume_count)

        zero_volume_ratio = zero_volume_count / row_count if row_count else 0.0
        if zero_volume_ratio >= 0.8:
            issues.append(_issue("SUSPICIOUS_VOLUME", "Most candles have zero or missing volume.", {"zero_volume_ratio": zero_volume_ratio}))
            score -= 20
        elif zero_volume_count:
            warnings.append(_issue("ZERO_VOLUME_CANDLES", "Some candles have zero volume.", {"rows": zero_volume_count}))
            score -= min(10, zero_volume_count)

    if row_count > 0 and has_time:
        times = frame["time"].dropna()
        chronological = bool(times.is_monotonic_increasing)
        if not chronological:
            issues.append(_issue("NOT_CHRONOLOGICAL", "Candles are not sorted in chronological order."))
            score -= 15

        duplicate_time_count = int(times.duplicated().sum())
        if duplicate_time_count:
            issues.append(_issue("DUPLICATE_TIMESTAMPS", "Dataset contains duplicated timestamps.", {"rows": duplicate_time_count}))
            score -= 15

        sorted_times = times.drop_duplicates().sort_values()
        if len(sorted_times) > 0:
            min_time = sorted_times.iloc[0].isoformat()
            max_time = sorted_times.iloc[-1].isoformat()
            history_days = max(0.0, (sorted_times.iloc[-1] - sorted_times.iloc[0]).total_seconds() / 86400.0)

        if len(sorted_times) > 1:
            deltas = sorted_times.diff().dropna().dt.total_seconds()
            median_gap_seconds = float(deltas.median()) if len(deltas) else None
            max_gap_seconds = float(deltas.max()) if len(deltas) else None
            expected_seconds = _expected_interval_seconds(timeframe, median_gap_seconds)
            large_gap_count = int((deltas > expected_seconds * 3.5).sum())
            if large_gap_count:
                warnings.append(
                    _issue("TEMPORAL_GAPS", "Dataset has temporal gaps larger than expected.", {"large_gap_count": large_gap_count})
                )
                score -= min(20, large_gap_count * 2)

            if (timeframe or "").lower() in {"1d", "daily"}:
                expected_days = pd.bdate_range(sorted_times.iloc[0].date(), sorted_times.iloc[-1].date())
                actual_days = {value.date() for value in sorted_times}
                expected_missing_periods = sum(1 for value in expected_days if value.date() not in actual_days)
                expected_missing_ratio = expected_missing_periods / len(expected_days) if len(expected_days) else 0.0
                if expected_missing_ratio > 0.15:
                    issues.append(
                        _issue(
                            "MISSING_DATES",
                            "Dataset is missing too many expected trading dates.",
                            {"missing_periods": expected_missing_periods, "missing_ratio": expected_missing_ratio},
                        )
                    )
                    score -= 20
                elif expected_missing_periods:
                    warnings.append(
                        _issue(
                            "MISSING_DATES_MINOR",
                            "Dataset has some missing expected trading dates.",
                            {"missing_periods": expected_missing_periods, "missing_ratio": expected_missing_ratio},
                        )
                    )
                    score -= min(10, expected_missing_periods)

    adjusted = _adjustment_status(metadata)
    if adjusted is False:
        warnings.append(_issue("UNADJUSTED_DATA", "Provider metadata says prices are not adjusted."))
        score -= 15
    elif adjusted is None:
        warnings.append(_issue("ADJUSTMENT_UNKNOWN", "Provider metadata does not declare whether prices are adjusted."))
        score -= 5

    if row_count < thresholds["min_ta_candles"]:
        warnings.append(
            _issue(
                "INSUFFICIENT_TA_HISTORY",
                "Dataset has too few candles for reliable technical analysis.",
                {"min_required": thresholds["min_ta_candles"], "actual": row_count},
            )
        )
        score -= 25

    if row_count < thresholds["min_ml_candles"] or history_days < thresholds["min_ml_history_days"]:
        warnings.append(
            _issue(
                "INSUFFICIENT_ML_HISTORY",
                "Dataset has too little history for ML models.",
                {
                    "min_candles": thresholds["min_ml_candles"],
                    "actual_candles": row_count,
                    "min_history_days": thresholds["min_ml_history_days"],
                    "actual_history_days": history_days,
                },
            )
        )
        score -= 20

    if row_count < thresholds["min_backtest_candles"] or history_days < thresholds["min_backtest_history_days"]:
        warnings.append(
            _issue(
                "INSUFFICIENT_BACKTEST_HISTORY",
                "Dataset has too little history for backtesting.",
                {
                    "min_candles": thresholds["min_backtest_candles"],
                    "actual_candles": row_count,
                    "min_history_days": thresholds["min_backtest_history_days"],
                    "actual_history_days": history_days,
                },
            )
        )
        score -= 10

    score = int(max(0, min(100, round(score))))

    no_blocking_errors = len(blocking_errors) == 0
    severe_missing_dates = expected_missing_ratio > 0.15
    severe_gaps = row_count > 0 and large_gap_count > max(1, int(row_count * 0.05))
    volume_quality_ok = row_count > 0 and (zero_volume_count / row_count) < 0.8 and (null_volume_count / row_count) < 0.2

    usable_for_chart = no_blocking_errors and row_count >= thresholds["min_chart_candles"]
    usable_for_ta = (
        usable_for_chart
        and row_count >= thresholds["min_ta_candles"]
        and chronological
        and duplicate_time_count == 0
        and not severe_missing_dates
    )
    usable_for_ml = (
        usable_for_ta
        and row_count >= thresholds["min_ml_candles"]
        and history_days >= thresholds["min_ml_history_days"]
        and volume_quality_ok
        and not severe_gaps
        and adjusted is not False
    )
    usable_for_backtest = (
        usable_for_ml
        and row_count >= thresholds["min_backtest_candles"]
        and history_days >= thresholds["min_backtest_history_days"]
    )

    if not usable_for_chart:
        status = "FAILED"
        recommendation = "Bloquear graficos, analisis tecnico, ML y backtesting hasta corregir datos OHLCV."
    elif not usable_for_ml:
        status = "WARNING"
        recommendation = "Usar como maximo para grafico/diagnostico; no ejecutar ML ni emitir BUY/SELL confiado."
    elif not usable_for_backtest:
        status = "WARNING"
        recommendation = "Datos aptos para TA/ML, pero no para backtesting robusto."
    else:
        status = "OK" if score >= 80 and not issues else "WARNING"
        recommendation = "Datos aptos para grafico, TA, ML y backtesting bajo los umbrales actuales."

    raw_diagnostics = {
        "row_count": row_count,
        "required_columns": REQUIRED_COLUMNS,
        "missing_columns": missing_columns,
        "null_counts": null_counts,
        "non_positive_price_count": non_positive_price_count,
        "invalid_ohlc_count": invalid_ohlc_count,
        "null_volume_count": null_volume_count,
        "zero_volume_count": zero_volume_count,
        "duplicate_time_count": duplicate_time_count,
        "chronological": chronological,
        "min_time": min_time,
        "max_time": max_time,
        "history_days": history_days,
        "expected_missing_periods": expected_missing_periods,
        "expected_missing_ratio": expected_missing_ratio,
        "large_gap_count": large_gap_count,
        "median_gap_seconds": median_gap_seconds,
        "max_gap_seconds": max_gap_seconds,
        "adjusted": adjusted,
        "provider_failure": provider_failure,
        "thresholds": thresholds,
        "start_date": start_date,
        "end_date": end_date,
    }

    return {
        "symbol": symbol,
        "provider": provider,
        "timeframe": timeframe,
        "status": status,
        "usable_for_chart": usable_for_chart,
        "usable_for_ta": usable_for_ta,
        "usable_for_ml": usable_for_ml,
        "usable_for_backtest": usable_for_backtest,
        "quality_score": score,
        "issues": issues,
        "warnings": warnings,
        "blocking_errors": blocking_errors,
        "recommendation": recommendation,
        "raw_diagnostics": raw_diagnostics,
    }


def evaluate_market_data_quality_frame(
    symbol: str,
    provider: str,
    timeframe: str,
    frame: pd.DataFrame,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return evaluate_market_data_quality(
        symbol=symbol,
        provider=provider,
        timeframe=timeframe,
        dataset=frame,
        metadata=metadata,
    )
