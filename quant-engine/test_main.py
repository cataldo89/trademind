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
def test_workflow_analyze(mock_risk, mock_tech, mock_research):
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
