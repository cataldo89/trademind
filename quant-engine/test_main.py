import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import os
import pandas as pd

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
        dataset = [
            {"time": int(pd.Timestamp(date).timestamp()), "open": 100 + i, "high": 101 + i, "low": 99 + i, "close": 100 + i, "volume": 1000}
            for i, date in enumerate(pd.bdate_range("2024-01-02", periods=300))
        ]
        state["market_data_quality"] = {
            "status": "OK",
            "usable_for_chart": True,
            "usable_for_ta": True,
            "usable_for_ml": True,
            "usable_for_backtest": True,
            "quality_score": 95,
            "recommendation": "Mocked quality passed",
        }
        state["provider_fallback"] = {"selected_provider": "mock", "selected_dataset": dataset}
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
    assert res["action"] == "HOLD"
    assert res["label"] == "Mantener / riesgo de cartera bloquea"
    assert res["confidence"] <= 60
    assert res["robust_backtest"]["backtest_status"] == "WEAK"
    assert res["robust_backtest"]["usable_for_decision"] is False
    assert res["portfolio_risk"]["portfolio_risk_status"] == "BLOCKED"


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


@patch("main.resolve_provider_fallback")
def test_provider_fallback_endpoint(mock_fallback):
    mock_fallback.return_value = {
        "symbol": "AAPL",
        "selected_provider": "stooq",
        "selected_dataset": [],
        "selected_quality": {"status": "OK", "usable_for_ml": True, "quality_score": 90},
        "providers_attempted": ["yahoo-chart", "stooq"],
        "provider_statuses": [],
        "fallback_used": True,
        "usable_for_chart": True,
        "usable_for_ta": True,
        "usable_for_ml": True,
        "usable_for_backtest": True,
        "final_status": "OK",
        "reason": "mocked",
        "errors": [],
    }

    response = client.post(
        "/mcp/tools/provider_fallback",
        json={"symbol": "AAPL", "market": "US", "timeframe": "1d", "range": "2y", "required_use": "ml"},
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["selected_provider"] == "stooq"
    assert data["fallback_used"] is True
    mock_fallback.assert_called_once()


def test_historical_data_normalizer_endpoint():
    response = client.post(
        "/mcp/tools/historical_data_normalizer",
        json={
            "symbol": "AAPL",
            "provider": "yahoo-chart",
            "market": "US",
            "timeframe": "1d",
            "raw_dataset": [
                {"Date": "2024-01-02", "Open": "100", "High": "101", "Low": "99", "Close": "100.5", "Volume": "1000"}
            ],
            "metadata": {"currency": "USD"},
        },
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["normalization_status"] in {"OK", "WARNING"}
    assert data["row_count"] == 1
    assert data["normalized_dataset"][0]["time"] > 0


def test_signal_quality_endpoint_blocks_bad_data():
    response = client.post(
        "/mcp/tools/signal_quality",
        json={
            "symbol": "INVALIDZZZ",
            "market": "US",
            "market_data_quality": {"usable_for_ml": False, "quality_score": 0, "usable_for_chart": False},
            "sentiment_result": {"sentiment": "POSITIVE"},
            "workflow_action": "BUY",
            "workflow_confidence": 90,
        },
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["signal_status"] == "BLOCKED"
    assert data["final_action"] == "HOLD"
    assert data["final_confidence"] == 0


def test_robust_backtest_endpoint_blocks_bad_quality():
    response = client.post(
        "/mcp/tools/robust_backtest",
        json={
            "symbol": "INVALIDZZZ",
            "normalized_dataset": [],
            "market_data_quality": {"usable_for_backtest": False},
            "signal_quality": {"signal_status": "BLOCKED"},
        },
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["backtest_status"] == "BLOCKED"
    assert data["usable_for_decision"] is False


def test_portfolio_risk_manager_endpoint_blocks_signal_blocked():
    response = client.post(
        "/mcp/tools/portfolio_risk_manager",
        json={
            "symbol": "INVALIDZZZ",
            "final_action": "BUY",
            "signal_quality": {"signal_status": "BLOCKED"},
            "robust_backtest": {"backtest_status": "FAILED"},
            "cash_balance": 1000,
            "account_equity": 10000,
        },
        headers={"X-TradeMind-Quant-Secret": "test-secret"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["portfolio_risk_status"] == "BLOCKED"
    assert data["adjusted_action"] == "HOLD"


def test_trade_execution_guard_endpoint_blocks_invalidzzz():
    response = client.post(
        "/mcp/tools/trade_execution_guard",
        headers={"X-TradeMind-Quant-Secret": "test-secret"},
        json={
            "user_id": "u1",
            "symbol": "INVALIDZZZ",
            "market": "US",
            "side": "BUY",
            "requested_amount": 100,
            "current_price": 100,
            "signal_quality": {"signal_status": "BLOCKED", "final_action": "HOLD"},
            "robust_backtest": {"backtest_status": "FAILED"},
            "portfolio_risk": {"portfolio_risk_status": "BLOCKED", "action_allowed": False},
            "market_data_quality": {"status": "FAILED", "usable_for_ml": False},
            "cash_balance": 1000,
            "account_equity": 10000,
            "idempotency_key": "idem-test",
            "source": "workflow",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["execution_status"] == "BLOCKED"
    assert data["action_to_execute"] == "NONE"


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
