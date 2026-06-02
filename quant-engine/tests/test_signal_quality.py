from signal_quality import evaluate_signal_quality


GOOD_QUALITY = {
    "status": "OK",
    "usable_for_chart": True,
    "usable_for_ta": True,
    "usable_for_ml": True,
    "usable_for_backtest": True,
    "quality_score": 90,
}


BAD_QUALITY = {
    "status": "FAILED",
    "usable_for_chart": False,
    "usable_for_ta": False,
    "usable_for_ml": False,
    "usable_for_backtest": False,
    "quality_score": 0,
}


def assess(**kwargs):
    return evaluate_signal_quality(symbol="AAPL", market="US", **kwargs)


def test_bad_data_positive_finbert_blocks_hold():
    result = assess(
        market_data_quality=BAD_QUALITY,
        sentiment_result={"sentiment": "POSITIVE"},
        workflow_action="BUY",
        workflow_confidence=90,
    )

    assert result["signal_status"] == "BLOCKED"
    assert result["final_action"] == "HOLD"
    assert result["final_confidence"] == 0
    assert any("FinBERT positivo" in reason for reason in result["blocking_reasons"])


def test_positive_ml_high_risk_conflicted_hold():
    result = assess(
        market_data_quality=GOOD_QUALITY,
        ml_prediction=0.04,
        risk_metrics={"var_95": 0.08},
        workflow_action="BUY",
        workflow_confidence=82,
    )

    assert result["signal_status"] == "CONFLICTED"
    assert result["final_action"] == "HOLD"


def test_positive_ml_low_risk_good_data_ok_buy():
    result = assess(
        market_data_quality=GOOD_QUALITY,
        ml_prediction=0.04,
        risk_metrics={"var_95": 0.02},
        graham_result={"passed": True},
        workflow_action="BUY",
        workflow_confidence=80,
    )

    assert result["signal_status"] == "OK"
    assert result["final_action"] == "BUY"
    assert result["final_confidence"] >= 70


def test_negative_graham_positive_workflow_conflicted():
    result = assess(
        market_data_quality=GOOD_QUALITY,
        ml_prediction=0.03,
        risk_metrics={"var_95": 0.02},
        graham_result={"passed": False, "reason": "No margin of safety"},
        workflow_action="BUY",
        workflow_confidence=78,
    )

    assert result["signal_status"] == "CONFLICTED"
    assert "Graham negativo" in " ".join(result["contradicting_factors"])


def test_all_neutral_is_weak_hold():
    result = assess(
        market_data_quality=GOOD_QUALITY,
        ml_prediction=0,
        risk_metrics={},
        workflow_action="HOLD",
        workflow_confidence=45,
    )

    assert result["signal_status"] == "WEAK"
    assert result["final_action"] == "HOLD"


def test_invalidzzz_blocked_hold():
    result = evaluate_signal_quality(symbol="INVALIDZZZ", market="US", market_data_quality=BAD_QUALITY)

    assert result["signal_status"] == "BLOCKED"
    assert result["final_action"] == "HOLD"
