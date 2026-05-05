import pytest
from graham_filters import check_margin_of_safety

def test_graham_invalid_ticker():
    passed, reason = check_margin_of_safety("INVALID_TICKER_XYZ")
    assert not passed
    assert "Invalid or missing" in reason or "Error fetching" in reason

def test_graham_valid_ticker_aapl():
    # Solo probar que retorna una tupla con bool y string, 
    # ya que no controlamos si AAPL pasa el filtro o no
    passed, reason = check_margin_of_safety("AAPL")
    assert isinstance(passed, bool)
    assert isinstance(reason, str)
