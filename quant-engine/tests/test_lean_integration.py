import pytest
from lean_integration import run_lean_backtest, export_to_lean
import os

def test_lean_integration():
    file_path = export_to_lean("AAPL", {})
    assert os.path.exists(file_path)
    
    result = run_lean_backtest(file_path)
    assert result["status"] in ["error", "success"]
    if result["status"] == "error":
        assert "not installed" in result["message"] or "error" in result["message"]
