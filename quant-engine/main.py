from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Callable, Any, Dict, List, Optional
import os
import time

from dotenv import load_dotenv
from ml_pipeline import run_pca_autoencoder, run_lasso_ridge
from risk_models import detect_regime, calculate_var_garch
from time_series_models import predict_direction_arima, predict_direction_sarima
from lean_integration import run_lean_backtest, export_to_lean
from graham_filters import check_margin_of_safety
from market_data import fetch_chart_dataframe
from historical_data_normalizer import normalize_historical_dataset
from market_data_quality import evaluate_market_data_quality
from provider_fallback import resolve_provider_fallback
from portfolio_risk_manager import evaluate_portfolio_risk
from robust_backtest import run_robust_backtest
from signal_quality import evaluate_signal_quality
from trade_execution_guard import evaluate_trade_execution_guard

load_dotenv()

app = FastAPI(title="TradeMind Quant Engine")

# --- Security Configuration ---
AUTH_DISABLED = os.getenv("QUANT_ENGINE_AUTH_DISABLED", "false").lower() == "true"
SECRET_KEY = os.getenv("QUANT_ENGINE_SECRET")
CACHE_TTL_SECONDS = int(os.getenv("QUANT_ENGINE_CACHE_TTL_SECONDS", "300"))
SENTIMENT_SCAN_MAX_SYMBOLS = int(os.getenv("SENTIMENT_SCAN_MAX_SYMBOLS", "30"))
_CACHE: dict[str, tuple[float, Any]] = {}


def get_cached(key: str, loader: Callable[[], Any], ttl_seconds: int = CACHE_TTL_SECONDS) -> Any:
    now = time.time()
    cached = _CACHE.get(key)
    if cached and cached[0] > now:
        return cached[1]

    value = loader()
    _CACHE[key] = (now + ttl_seconds, value)
    return value


@app.middleware("http")
async def security_middleware(request: Request, call_next: Callable):
    if not AUTH_DISABLED and not request.url.path.startswith(("/health", "/docs", "/openapi.json")):
        if request.url.path == "/":
            pass
        elif not SECRET_KEY:
            return JSONResponse(status_code=500, content={"detail": "QUANT_ENGINE_SECRET is not configured."})

        client_secret = request.headers.get("X-TradeMind-Quant-Secret")
        if client_secret != SECRET_KEY:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    response = await call_next(request)
    return response


# --- CORS Configuration ---
allowed_origins_str = os.getenv("QUANT_ENGINE_ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [origin.strip() for origin in allowed_origins_str.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SymbolRequest(BaseModel):
    symbol: str


class ToolRequest(BaseModel):
    symbol: str
    timeframe: str = "1D"


class LeanRequest(BaseModel):
    symbol: str
    parameters: dict = {}


class MarketDataQualityRequest(BaseModel):
    symbol: str
    provider: str = "yahoo-chart"
    timeframe: str = "1d"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    dataset: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ProviderFallbackRequest(BaseModel):
    symbol: str
    market: str = "US"
    timeframe: str = "1d"
    range: Optional[str] = "2y"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    required_use: str = "ml"


class HistoricalDataNormalizerRequest(BaseModel):
    symbol: str
    provider: str
    market: str = "US"
    timeframe: str = "1d"
    raw_dataset: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SignalQualityRequest(BaseModel):
    symbol: str
    market: str = "US"
    selected_provider: Optional[str] = None
    market_data_quality: Dict[str, Any] = Field(default_factory=dict)
    technical_indicators: Dict[str, Any] = Field(default_factory=dict)
    ml_prediction: Any = None
    risk_metrics: Dict[str, Any] = Field(default_factory=dict)
    graham_result: Dict[str, Any] = Field(default_factory=dict)
    sentiment_result: Dict[str, Any] = Field(default_factory=dict)
    workflow_action: str = "HOLD"
    workflow_confidence: int = 0
    reasons: List[str] = Field(default_factory=list)


class RobustBacktestRequest(BaseModel):
    symbol: str
    market: str = "US"
    provider: Optional[str] = None
    timeframe: str = "1d"
    normalized_dataset: List[Dict[str, Any]] = Field(default_factory=list)
    market_data_quality: Dict[str, Any] = Field(default_factory=dict)
    signal_quality: Dict[str, Any] = Field(default_factory=dict)
    strategy_type: str = "buy_and_hold"
    strategy_params: Dict[str, Any] = Field(default_factory=dict)
    initial_capital: float = 10000.0
    fees: float = 0.0
    slippage: float = 0.0


class PortfolioRiskManagerRequest(BaseModel):
    user_id: Optional[str] = None
    symbol: str
    market: str = "US"
    final_action: str = "HOLD"
    signal_quality: Dict[str, Any] = Field(default_factory=dict)
    robust_backtest: Dict[str, Any] = Field(default_factory=dict)
    current_price: Optional[float] = None
    portfolio_positions: Optional[List[Dict[str, Any]]] = None
    cash_balance: Optional[float] = None
    account_equity: Optional[float] = None
    risk_profile: str = "balanced"
    max_position_pct: Optional[float] = None
    max_sector_pct: Optional[float] = None
    max_market_pct: Optional[float] = None


class TradeExecutionGuardRequest(BaseModel):
    user_id: Optional[str] = None
    symbol: str
    market: str = "US"
    side: str = "BUY"
    requested_amount: Optional[float] = None
    requested_quantity: Optional[float] = None
    current_price: Optional[float] = None
    signal_quality: Dict[str, Any] = Field(default_factory=dict)
    robust_backtest: Dict[str, Any] = Field(default_factory=dict)
    portfolio_risk: Dict[str, Any] = Field(default_factory=dict)
    market_data_quality: Dict[str, Any] = Field(default_factory=dict)
    selected_provider: Optional[str] = None
    account_equity: Optional[float] = None
    cash_balance: Optional[float] = None
    current_position: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = None
    source: str = "manual"


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "quant-engine", "cache_entries": len(_CACHE)}


@app.get("/")
def read_root():
    return {"status": "Quant Engine Running"}


# --- MCP Tool Endpoints ---

@app.post("/mcp/tools/get_market_regime")
def get_market_regime(req: ToolRequest):
    regime = get_cached(f"regime:{req.symbol.upper()}", lambda: detect_regime(req.symbol))
    return {"regime": regime}


@app.post("/mcp/tools/calculate_var")
def calculate_var(req: ToolRequest):
    var_95 = get_cached(
        f"var:{req.symbol.upper()}:{req.timeframe}",
        lambda: calculate_var_garch(req.symbol, req.timeframe),
    )
    return {"var_95": var_95, "timeframe": req.timeframe}


@app.post("/mcp/tools/check_graham_filters")
def check_graham_filters(req: SymbolRequest):
    passed, reason = get_cached(
        f"graham:{req.symbol.upper()}",
        lambda: check_margin_of_safety(req.symbol),
    )
    return {"passed": passed, "reason": reason}


@app.post("/mcp/tools/market_data_quality")
def market_data_quality(req: MarketDataQualityRequest):
    dataset: Any = req.dataset
    metadata = dict(req.metadata)
    if not dataset:
        frame = fetch_chart_dataframe(req.symbol, range_="2y", interval=req.timeframe)
        dataset = frame
        metadata.setdefault("fetched_by", "quant-engine")
        metadata.setdefault("provider", req.provider)

    return evaluate_market_data_quality(
        symbol=req.symbol,
        provider=req.provider,
        timeframe=req.timeframe,
        start_date=req.start_date,
        end_date=req.end_date,
        dataset=dataset,
        metadata=metadata,
    )


@app.post("/mcp/tools/historical_data_normalizer")
def historical_data_normalizer(req: HistoricalDataNormalizerRequest):
    return normalize_historical_dataset(
        symbol=req.symbol,
        provider=req.provider,
        market=req.market,
        timeframe=req.timeframe,
        raw_dataset=req.raw_dataset,
        metadata=req.metadata,
    )


@app.post("/mcp/tools/provider_fallback")
def provider_fallback(req: ProviderFallbackRequest):
    return resolve_provider_fallback(
        symbol=req.symbol,
        market=req.market,
        timeframe=req.timeframe,
        range_=req.range,
        start_date=req.start_date,
        end_date=req.end_date,
        required_use=req.required_use,
    )


@app.post("/mcp/tools/signal_quality")
def signal_quality(req: SignalQualityRequest):
    return evaluate_signal_quality(
        symbol=req.symbol,
        market=req.market,
        selected_provider=req.selected_provider,
        market_data_quality=req.market_data_quality,
        technical_indicators=req.technical_indicators,
        ml_prediction=req.ml_prediction,
        risk_metrics=req.risk_metrics,
        graham_result=req.graham_result,
        sentiment_result=req.sentiment_result,
        workflow_action=req.workflow_action,
        workflow_confidence=req.workflow_confidence,
        reasons=req.reasons,
    )


@app.post("/mcp/tools/robust_backtest")
def robust_backtest(req: RobustBacktestRequest):
    return run_robust_backtest(
        symbol=req.symbol,
        market=req.market,
        provider=req.provider,
        timeframe=req.timeframe,
        normalized_dataset=req.normalized_dataset,
        market_data_quality=req.market_data_quality,
        signal_quality=req.signal_quality,
        strategy_type=req.strategy_type,
        strategy_params=req.strategy_params,
        initial_capital=req.initial_capital,
        fees=req.fees,
        slippage=req.slippage,
    )


@app.post("/mcp/tools/portfolio_risk_manager")
def portfolio_risk_manager(req: PortfolioRiskManagerRequest):
    return evaluate_portfolio_risk(
        user_id=req.user_id,
        symbol=req.symbol,
        market=req.market,
        final_action=req.final_action,
        signal_quality=req.signal_quality,
        robust_backtest=req.robust_backtest,
        current_price=req.current_price,
        portfolio_positions=req.portfolio_positions,
        cash_balance=req.cash_balance,
        account_equity=req.account_equity,
        risk_profile=req.risk_profile,
        max_position_pct=req.max_position_pct,
        max_sector_pct=req.max_sector_pct,
        max_market_pct=req.max_market_pct,
    )


@app.post("/mcp/tools/trade_execution_guard")
def trade_execution_guard(req: TradeExecutionGuardRequest):
    return evaluate_trade_execution_guard(
        user_id=req.user_id,
        symbol=req.symbol,
        market=req.market,
        side=req.side,
        requested_amount=req.requested_amount,
        requested_quantity=req.requested_quantity,
        current_price=req.current_price,
        signal_quality=req.signal_quality,
        robust_backtest=req.robust_backtest,
        portfolio_risk=req.portfolio_risk,
        market_data_quality=req.market_data_quality,
        selected_provider=req.selected_provider,
        account_equity=req.account_equity,
        cash_balance=req.cash_balance,
        current_position=req.current_position,
        idempotency_key=req.idempotency_key,
        source=req.source,
    )


# --- Detailed ML Endpoints ---

@app.post("/ml/extract_features")
def extract_features(req: SymbolRequest):
    features = get_cached(f"features:{req.symbol.upper()}", lambda: run_pca_autoencoder(req.symbol))
    return {"features": features}


@app.post("/ml/predict_direction")
def predict_direction(req: ToolRequest):
    prediction = get_cached(f"arima:{req.symbol.upper()}", lambda: predict_direction_arima(req.symbol))
    return {"prediction": prediction}


@app.post("/ml/predict_sarima")
def predict_sarima(req: ToolRequest):
    prediction = get_cached(f"sarima:{req.symbol.upper()}", lambda: predict_direction_sarima(req.symbol))
    return {"prediction": prediction}


@app.post("/lean/backtest")
def lean_backtest(req: LeanRequest):
    algo_file = export_to_lean(req.symbol, req.parameters)
    result = run_lean_backtest(algo_file)
    if result.get("status") == "error" and "not installed" in result.get("message", ""):
        return {"success": False, "status": "lean_not_ready", "message": result.get("message")}

    return {
        "success": result.get("status") == "success",
        "status": "completed" if result.get("status") == "success" else "error",
        "statistics": {
            "sharpe_ratio": None,
            "drawdown": None,
            "net_profit": None,
            "win_rate": None,
        },
        "raw_path": algo_file,
        "details": result.get("output") or result.get("message"),
    }


# --- Agent Workflow Endpoints ---

@app.post("/workflow/analyze")
def run_workflow(req: SymbolRequest):
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from agents.graph import run_analysis_workflow

    result = get_cached(
        f"workflow:{req.symbol.upper()}",
        lambda: run_analysis_workflow(req.symbol),
    )
    return {"workflow_result": result}


# --- Sentiment Analysis Endpoints ---

from typing import List

class BatchSymbolRequest(BaseModel):
    symbols: List[str]

@app.post("/ml/trigger_sentiment_scan")
def trigger_sentiment_scan(req: BatchSymbolRequest):
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from sentiment_models import run_daily_sentiment_job
    
    # We run it synchronously here just for testing/triggering manually
    # In production this would be a true background task (e.g. celery/BackgroundTasks)
    unique_symbols = []
    seen_symbols = set()
    for symbol in req.symbols:
        normalized = symbol.strip().upper()
        if normalized and normalized not in seen_symbols:
            seen_symbols.add(normalized)
            unique_symbols.append(normalized)

    limited_symbols = unique_symbols[:SENTIMENT_SCAN_MAX_SYMBOLS]
    data = run_daily_sentiment_job(limited_symbols)
    return {
        "status": "completed",
        "requested": len(unique_symbols),
        "processed": len(data),
        "truncated": len(unique_symbols) > len(limited_symbols),
        "limit": SENTIMENT_SCAN_MAX_SYMBOLS,
    }

@app.get("/ml/sentiment_cache")
def get_sentiment_cache():
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from sentiment_models import get_cached_sentiment
    
    # We read the whole cache by passing a dummy or just reading the file
    import json
    try:
        if os.path.exists("sentiment_cache.json"):
            with open("sentiment_cache.json", "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}
