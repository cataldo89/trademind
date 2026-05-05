import pandas as pd
import yfinance as yf
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.statespace.sarimax import SARIMAX
import warnings
warnings.filterwarnings("ignore")

def predict_direction_arima(symbol: str):
    try:
        df = yf.download(symbol, period="1y", progress=False)
        if df.empty:
            return {"expected_return": 0.0, "confidence": 0.0, "status": "error"}
            
        close_series = df['Close'].squeeze() if isinstance(df['Close'], pd.DataFrame) else df['Close']
        close_series = close_series.dropna()
        if len(close_series) < 30:
            return {"expected_return": 0.0, "confidence": 0.0, "status": "insufficient_data"}
            
        model = ARIMA(close_series, order=(1, 1, 1))
        fitted = model.fit()
        forecast = fitted.forecast(steps=1)
        
        last_price = close_series.iloc[-1]
        predicted_price = float(forecast.iloc[0])
        expected_return = (predicted_price - last_price) / last_price
        
        in_sample_preds = fitted.predict(start=len(close_series)-20, end=len(close_series)-1)
        actuals = close_series.iloc[-20:]
        mse = ((in_sample_preds - actuals) ** 2).mean()
        rmse_pct = (mse ** 0.5) / last_price
        
        confidence = max(10, 100 - (rmse_pct * 1000))
        
        return {
            "model": "ARIMA",
            "symbol": symbol,
            "expected_return": expected_return,
            "predicted_price": predicted_price,
            "last_price": last_price,
            "confidence": min(100, confidence) / 100.0,
            "diagnostics": {
                "samples": len(close_series),
                "order": [1,1,1]
            }
        }
    except Exception as e:
        return {"expected_return": 0.0, "confidence": 0.0, "status": "error", "message": str(e)}

def predict_direction_sarima(symbol: str):
    try:
        df = yf.download(symbol, period="2y", progress=False)
        if df.empty:
            return {"expected_return": 0.0, "confidence": 0.0, "status": "error"}
            
        close_series = df['Close'].squeeze() if isinstance(df['Close'], pd.DataFrame) else df['Close']
        close_series = close_series.dropna()
        if len(close_series) < 60:
            return {"expected_return": 0.0, "confidence": 0.0, "status": "insufficient_data"}
            
        model = SARIMAX(close_series, order=(1, 1, 1), seasonal_order=(1, 1, 1, 5))
        fitted = model.fit(disp=False)
        forecast = fitted.forecast(steps=1)
        
        last_price = close_series.iloc[-1]
        predicted_price = float(forecast.iloc[0])
        expected_return = (predicted_price - last_price) / last_price
        
        in_sample_preds = fitted.predict(start=len(close_series)-20, end=len(close_series)-1)
        actuals = close_series.iloc[-20:]
        mse = ((in_sample_preds - actuals) ** 2).mean()
        rmse_pct = (mse ** 0.5) / last_price
        confidence = max(10, 100 - (rmse_pct * 1000))
        
        return {
            "model": "SARIMA",
            "symbol": symbol,
            "expected_return": expected_return,
            "predicted_price": predicted_price,
            "last_price": last_price,
            "confidence": min(100, confidence) / 100.0,
            "diagnostics": {
                "samples": len(close_series),
                "order": [1,1,1],
                "seasonal_order": [1,1,1,5],
                "validation_method": "rolling_backtest"
            }
        }
    except Exception as e:
        return {"expected_return": 0.0, "confidence": 0.0, "status": "error", "message": str(e)}

def predict_direction_marima(symbols: list):
    return {
        "status": "not_implemented",
        "message": "MARIMA/VARMAX not implemented yet due to complexity and data requirements."
    }
