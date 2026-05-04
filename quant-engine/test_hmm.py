import sys
from risk_models import detect_regime, calculate_var_garch, predict_direction_arima

if __name__ == "__main__":
    symbol = "SPY"
    print(f"--- Iniciando pruebas para {symbol} ---")
    
    print("\n1. Detectando régimen de mercado actual (HMM)...")
    regime = detect_regime(symbol)
    print(f"Régimen detectado: {regime}")
    
    print("\n2. Prediciendo dirección a 1 día (ARIMA)...")
    prediction = predict_direction_arima(symbol)
    print(f"Retorno esperado: {prediction['expected_return']*100:.2f}%")
    
    print("\n3. Calculando volatilidad y VaR (GARCH)...")
    var_data = calculate_var_garch(symbol, "1D")
    print(f"VaR 1D (95%): {var_data['var_1d_95']*100:.2f}%")
    print(f"Volatilidad Anualizada: {var_data['annualized_vol']*100:.2f}%")

