import importlib

import numpy as np
import pandas as pd

from market_data import fetch_chart_dataframe


UNKNOWN_REGIME = "Unknown"
ZERO_VAR_RESULT = {"var_1d_95": 0.0, "annualized_vol": 0.0}


def _get_yfinance_module():
    try:
        return importlib.import_module("yfinance")
    except ImportError:
        return None


def _get_gaussian_hmm_class():
    try:
        return importlib.import_module("hmmlearn.hmm").GaussianHMM
    except ImportError:
        return None


def _get_arch_model():
    try:
        return importlib.import_module("arch").arch_model
    except ImportError:
        return None


def _zero_var_result():
    return dict(ZERO_VAR_RESULT)


def detect_regime(symbol: str):
    df = fetch_chart_dataframe(symbol, range_="5y", interval="1d")
    if df.empty:
        yf = _get_yfinance_module()
        if yf is None:
            return UNKNOWN_REGIME

        try:
            df = yf.download(symbol, period="5y", progress=False)
        except Exception:
            return UNKNOWN_REGIME

    if df.empty:
        return UNKNOWN_REGIME

    GaussianHMM = _get_gaussian_hmm_class()
    if GaussianHMM is None:
        return UNKNOWN_REGIME

    try:
        close_series = df["Close"].squeeze() if isinstance(df["Close"], pd.DataFrame) else df["Close"]
        log_returns = np.log(close_series / close_series.shift(1)).dropna()
    except Exception:
        return UNKNOWN_REGIME

    if len(log_returns) < 10:
        return UNKNOWN_REGIME

    returns_array = log_returns.values.reshape(-1, 1)

    try:
        model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=100, random_state=42)
        model.fit(returns_array)
        hidden_states = model.predict(returns_array)
    except Exception:
        return UNKNOWN_REGIME

    means = model.means_.flatten()
    sorted_indices = np.argsort(means)
    state_map = {
        sorted_indices[0]: "Bear (Alta volatilidad negativa)",
        sorted_indices[1]: "Sideways (Rango)",
        sorted_indices[2]: "Bull (Tendencia alcista)",
    }

    current_state = hidden_states[-1]
    return state_map.get(current_state, UNKNOWN_REGIME)


def calculate_var_garch(symbol: str, timeframe: str):
    df = fetch_chart_dataframe(symbol, range_="2y", interval="1d")
    if df.empty:
        yf = _get_yfinance_module()
        if yf is None:
            return _zero_var_result()

        try:
            df = yf.download(symbol, period="2y", progress=False)
        except Exception:
            return _zero_var_result()

    if df.empty:
        return _zero_var_result()

    arch_model = _get_arch_model()
    if arch_model is None:
        return _zero_var_result()

    try:
        close_series = df["Close"].squeeze() if isinstance(df["Close"], pd.DataFrame) else df["Close"]
        returns = 100 * close_series.pct_change().dropna()
    except Exception:
        return _zero_var_result()

    if len(returns) < 10:
        return _zero_var_result()

    try:
        am = arch_model(returns, vol="Garch", p=1, q=1)
        res = am.fit(disp="off")
        forecasts = res.forecast(horizon=1)

        var_95 = forecasts.variance.iloc[-1, 0] ** 0.5 * 1.645
        ann_vol = (forecasts.variance.iloc[-1, 0] ** 0.5) * np.sqrt(252)
    except Exception:
        return _zero_var_result()

    return {
        "var_1d_95": var_95 / 100.0,
        "annualized_vol": ann_vol / 100.0,
    }


try:
    from time_series_models import (
        predict_direction_arima,
        predict_direction_marima,
        predict_direction_sarima,
    )
except Exception:

    def predict_direction_arima(symbol: str):
        return {"status": "error", "message": "time_series_models unavailable"}

    def predict_direction_sarima(symbol: str):
        return {"status": "error", "message": "time_series_models unavailable"}

    def predict_direction_marima(symbols: list):
        return {"status": "error", "message": "time_series_models unavailable"}
