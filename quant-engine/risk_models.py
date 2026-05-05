import numpy as np
import pandas as pd
import yfinance as yf
from hmmlearn.hmm import GaussianHMM

def detect_regime(symbol: str):
    # Descargar últimos 5 años de datos
    df = yf.download(symbol, period="5y", progress=False)
    if df.empty:
        return "Unknown"
        
    # Calcular retornos logarítmicos
    close_series = df['Close'].squeeze() if isinstance(df['Close'], pd.DataFrame) else df['Close']
    log_returns = np.log(close_series / close_series.shift(1)).dropna()
    
    # Reformatear para hmmlearn (array 2D)
    returns_array = log_returns.values.reshape(-1, 1)
    
    # Entrenar HMM de 3 estados
    model = GaussianHMM(n_components=3, covariance_type="diag", n_iter=100, random_state=42)
    model.fit(returns_array)
    
    # Predecir los estados ocultos
    hidden_states = model.predict(returns_array)
    
    # Mapear estados a Bull, Bear, Sideways basándose en sus medias
    means = model.means_.flatten()
    
    sorted_indices = np.argsort(means)
    state_map = {
        sorted_indices[0]: "Bear (Alta volatilidad negativa)",
        sorted_indices[1]: "Sideways (Rango)",
        sorted_indices[2]: "Bull (Tendencia alcista)"
    }
    
    current_state = hidden_states[-1]
    return state_map[current_state]

from statsmodels.tsa.arima.model import ARIMA
from arch import arch_model

def calculate_var_garch(symbol: str, timeframe: str):
    df = yf.download(symbol, period="2y", progress=False)
    if df.empty:
        return {"var_1d_95": 0.0, "annualized_vol": 0.0}
        
    close_series = df['Close'].squeeze() if isinstance(df['Close'], pd.DataFrame) else df['Close']
    returns = 100 * close_series.pct_change().dropna()
    
    am = arch_model(returns, vol='Garch', p=1, q=1)
    res = am.fit(disp="off")
    forecasts = res.forecast(horizon=1)
    
    var_95 = forecasts.variance.iloc[-1, 0] ** 0.5 * 1.645
    ann_vol = (forecasts.variance.iloc[-1, 0] ** 0.5) * np.sqrt(252)
    
    return {
        "var_1d_95": var_95 / 100.0,
        "annualized_vol": ann_vol / 100.0
    }


