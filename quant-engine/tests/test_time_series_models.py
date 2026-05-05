import pytest
from time_series_models import predict_direction_arima, predict_direction_sarima, predict_direction_marima

def test_predict_arima_invalid():
    res = predict_direction_arima("INVALID_TICKER_XYZ")
    assert res["status"] == "error"

def test_predict_sarima_invalid():
    res = predict_direction_sarima("INVALID_TICKER_XYZ")
    assert res["status"] == "error"

def test_predict_marima():
    res = predict_direction_marima(["AAPL", "MSFT"])
    assert res["status"] == "not_implemented"
