import yfinance as yf
import pandas as pd
import numpy as np

def check_volume_divergence(symbol: str) -> dict:
    """
    Analyzes recent daily volume to detect divergences.
    Returns: {"signal": "BULLISH"|"BEARISH"|"NEUTRAL", "reason": str}
    """
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="3mo")
        if df.empty or len(df) < 10:
            return {"signal": "NEUTRAL", "reason": "No data"}
            
        # Simplified peak detection
        df['Price_Max'] = df['High'].rolling(window=5, center=True).max()
        peaks = df[df['High'] == df['Price_Max']].copy()
        
        if len(peaks) >= 2:
            last_peak = peaks.iloc[-1]
            prev_peak = peaks.iloc[-2]
            
            # Bearish Divergence: Price higher but volume lower
            if last_peak['High'] > prev_peak['High'] and last_peak['Volume'] < prev_peak['Volume']:
                return {"signal": "BEARISH", "reason": "Divergencia bajista de volumen (Precio sube, Volumen cae)"}
            
            # Bullish divergence (simplified: price drops, volume drops showing disinterest)
            df['Price_Min'] = df['Low'].rolling(window=5, center=True).min()
            troughs = df[df['Low'] == df['Price_Min']].copy()
            if len(troughs) >= 2:
                last_trough = troughs.iloc[-1]
                prev_trough = troughs.iloc[-2]
                if last_trough['Low'] < prev_trough['Low'] and last_trough['Volume'] < prev_trough['Volume']:
                    return {"signal": "BULLISH", "reason": "Divergencia alcista de volumen (Precio baja con desinterés/poco volumen)"}

        return {"signal": "NEUTRAL", "reason": "No hay divergencia de volumen clara."}
    except Exception as e:
        return {"signal": "NEUTRAL", "reason": str(e)}

def check_5min_scalping_fvg(symbol: str) -> dict:
    """
    Applies the ICT 5-minute Scalping strategy (FVG detection).
    Returns: {"signal": "BULLISH"|"BEARISH"|"NEUTRAL", "reason": str}
    """
    try:
        ticker = yf.Ticker(symbol)
        # Fetch 5-minute data
        df = ticker.history(period="5d", interval="5m")
        if df.empty or len(df) < 5:
            return {"signal": "NEUTRAL", "reason": "Sin datos 5m"}
            
        # Looking for latest Fair Value Gap (FVG)
        last_closes = df.iloc[-10:] # Look at last 10 candles
        for i in range(len(last_closes) - 2):
            c1 = last_closes.iloc[i]
            c3 = last_closes.iloc[i+2]
            
            # Bullish FVG
            if c3['Low'] > c1['High']:
                return {"signal": "BULLISH", "reason": "Fair Value Gap Alcista en 5m"}
            
            # Bearish FVG
            if c3['High'] < c1['Low']:
                return {"signal": "BEARISH", "reason": "Fair Value Gap Bajista en 5m"}
                
        return {"signal": "NEUTRAL", "reason": "Sin FVG reciente"}
    except Exception as e:
         return {"signal": "NEUTRAL", "reason": str(e)}
         
def check_fibonacci_pullback(symbol: str) -> dict:
    """
    Analyzes pullback to 61.8% Fibonacci level.
    """
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="1mo")
        if df.empty or len(df) < 10:
             return {"signal": "NEUTRAL", "reason": "No data"}
        
        recent_min = df['Low'].min()
        recent_max = df['High'].max()
        diff = recent_max - recent_min
        if diff == 0:
            return {"signal": "NEUTRAL", "reason": "Sin volatilidad"}
            
        fib_618 = recent_max - (diff * 0.618)
        current_price = df.iloc[-1]['Close']
        
        # If current price is near the 61.8% retracement (within 1.5% of the total difference)
        margin = diff * 0.015
        if abs(current_price - fib_618) < margin:
             # Check if trend was up
             if df.iloc[-10]['Close'] < df.iloc[-1]['Close'] * 0.95: 
                 return {"signal": "BULLISH", "reason": "Retroceso al 61.8% Fibonacci detectado"}
        return {"signal": "NEUTRAL", "reason": "Fuera de zona Fibonacci"}
    except Exception as e:
         return {"signal": "NEUTRAL", "reason": str(e)}

def aggregate_youtube_signals(symbol: str) -> dict:
    v_div = check_volume_divergence(symbol)
    fvg = check_5min_scalping_fvg(symbol)
    fib = check_fibonacci_pullback(symbol)
    
    signals = [s for s in [v_div["signal"], fvg["signal"], fib["signal"]] if s != "NEUTRAL"]
    
    reasons = []
    if v_div["signal"] != "NEUTRAL": reasons.append(v_div["reason"])
    if fvg["signal"] != "NEUTRAL": reasons.append(fvg["reason"])
    if fib["signal"] != "NEUTRAL": reasons.append(fib["reason"])
    
    if not signals:
        return {"overall": "NEUTRAL", "reasons": "Sin señales de YouTube"}
        
    bulls = sum(1 for s in signals if s == "BULLISH")
    bears = sum(1 for s in signals if s == "BEARISH")
    
    overall = "NEUTRAL"
    if bulls > bears: overall = "BULLISH"
    elif bears > bulls: overall = "BEARISH"
    
    return {
        "overall": overall,
        "reasons": " | ".join(reasons)
    }
