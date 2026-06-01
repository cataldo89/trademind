import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import os

# Set env before importing main to ensure defaults don't mess up
os.environ["QUANT_ENGINE_SECRET"] = "test-secret"
os.environ["QUANT_ENGINE_AUTH_DISABLED"] = "false"

from main import app

client = TestClient(app)

def test_root_authorized():
    response = client.get("/", headers={"X-TradeMind-Quant-Secret": "test-secret"})
    assert response.status_code == 200
    assert response.json() == {"status": "Quant Engine Running"}

def test_unauthorized():
    response = client.post("/mcp/tools/check_graham_filters", json={"symbol": "AAPL"})
    assert response.status_code == 401

@patch("graham_filters.yf.Ticker")
def test_graham_filters(mock_ticker):
    mock_ticker.return_value.info = {
        "trailingPE": 10,
        "totalDebt": 100,
        "totalAssets": 1000,
        "regularMarketPrice": 150
    }
    
    response = client.post(
        "/mcp/tools/check_graham_filters", 
        json={"symbol": "AAPL"},
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["passed"] == True
    assert "P/E: 10.00" in data["reason"]

@patch("agents.graph.research_manager")
@patch("agents.graph.technical_analyst")
@patch("agents.graph.risk_manager")
@patch("agents.graph.market_data_quality_analyst")
def test_workflow_analyze(mock_quality, mock_risk, mock_tech, mock_research):
    def mock_quality_func(state):
        state["market_data_quality"] = {
            "status": "OK",
            "usable_for_chart": True,
            "usable_for_ta": True,
            "usable_for_ml": True,
            "usable_for_backtest": True,
            "quality_score": 95,
            "recommendation": "Mocked quality passed",
        }
        state["data_status"] = "usable"
        return state

    def mock_rm(state):
        state["graham_passed"] = True
        state["graham_reason"] = "Mocked passed"
        return state
    
    def mock_ta(state):
        state["market_regime"] = "Bull"
        state["ml_prediction"] = 0.05
        return state
        
    def mock_risk_func(state):
        state["var_95"] = 0.02
        return state
        
    mock_quality.side_effect = mock_quality_func
    mock_research.side_effect = mock_rm
    mock_tech.side_effect = mock_ta
    mock_risk.side_effect = mock_risk_func
    
    response = client.post(
        "/workflow/analyze", 
        json={"symbol": "AAPL"},
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert "workflow_result" in data
    res = data["workflow_result"]
    assert res["action"] == "BUY"
    assert res["label"] == "COMPRAR CON CAUTELA"
    assert res["confidence"] >= 75


def test_market_data_quality_endpoint_dataset():
    dataset = [
        {"time": "2024-01-02", "open": 100, "high": 101, "low": 99, "close": 100.5, "volume": 1000}
        for _ in range(5)
    ]

    response = client.post(
        "/mcp/tools/market_data_quality",
        json={
            "symbol": "AAPL",
            "provider": "test-provider",
            "timeframe": "1d",
            "dataset": dataset,
            "metadata": {"adjusted": True, "provider_status": "ok"},
        },
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["symbol"] == "AAPL"
    assert data["usable_for_chart"] is True
    assert data["usable_for_ml"] is False


@patch("agents.graph.research_manager")
@patch("agents.graph.market_data_quality_analyst")
def test_workflow_blocks_ml_when_market_data_quality_fails(mock_quality, mock_research):
    def mock_quality_func(state):
        state["market_data_quality"] = {
            "status": "FAILED",
            "usable_for_chart": False,
            "usable_for_ta": False,
            "usable_for_ml": False,
            "usable_for_backtest": False,
            "quality_score": 0,
            "recommendation": "Mocked data failure",
        }
        state["data_status"] = "insufficient"
        return state

    mock_quality.side_effect = mock_quality_func

    response = client.post(
        "/workflow/analyze",
        json={"symbol": "BAD"},
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    result = response.json()["workflow_result"]
    assert result["action"] == "HOLD"
    assert result["confidence"] == 0
    assert result["data_status"] == "insufficient"
    assert result["market_data_quality"]["usable_for_ml"] is False
    mock_research.assert_not_called()
