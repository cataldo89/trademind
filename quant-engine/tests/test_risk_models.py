import pytest
from risk_models import detect_regime, calculate_var_garch

def test_detect_regime_valid():
    regime = detect_regime("AAPL")
    assert regime in ["Bear (Alta volatilidad negativa)", "Sideways (Rango)", "Bull (Tendencia alcista)", "Unknown"]

def test_detect_regime_invalid():
    regime = detect_regime("INVALID_TICKER_XYZ")
    assert regime == "Unknown"

def test_calculate_var_garch_valid():
    var_res = calculate_var_garch("AAPL", "1D")
    assert "var_1d_95" in var_res
    assert "annualized_vol" in var_res

def test_calculate_var_garch_invalid():
    var_res = calculate_var_garch("INVALID_TICKER_XYZ", "1D")
    assert var_res["var_1d_95"] == 0.0
