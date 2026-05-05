from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Callable
import os

from ml_pipeline import run_pca_autoencoder, run_lasso_ridge
from risk_models import detect_regime, calculate_var_garch, predict_direction_arima
from graham_filters import check_margin_of_safety

app = FastAPI(title="TradeMind Quant Engine")

from fastapi.responses import JSONResponse

# --- Security Configuration ---
AUTH_DISABLED = os.getenv("QUANT_ENGINE_AUTH_DISABLED", "false").lower() == "true"
SECRET_KEY = os.getenv("QUANT_ENGINE_SECRET")

@app.middleware("http")
async def security_middleware(request: Request, call_next: Callable):
    if not AUTH_DISABLED:
        if not SECRET_KEY:
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

@app.get("/")
def read_root():
    return {"status": "Quant Engine Running"}

# --- MCP Tool Endpoints ---

@app.post("/mcp/tools/get_market_regime")
def get_market_regime(req: ToolRequest):
    regime = detect_regime(req.symbol)
    return {"regime": regime}

@app.post("/mcp/tools/calculate_var")
def calculate_var(req: ToolRequest):
    var_95 = calculate_var_garch(req.symbol, req.timeframe)
    return {"var_95": var_95, "timeframe": req.timeframe}

@app.post("/mcp/tools/check_graham_filters")
def check_graham_filters(req: SymbolRequest):
    passed, reason = check_margin_of_safety(req.symbol)
    return {"passed": passed, "reason": reason}

# --- Detailed ML Endpoints ---

@app.post("/ml/extract_features")
def extract_features(req: SymbolRequest):
    features = run_pca_autoencoder(req.symbol)
    return {"features": features}

@app.post("/ml/predict_direction")
def predict_direction(req: ToolRequest):
    prediction = predict_direction_arima(req.symbol)
    return {"prediction": prediction}

# --- Agent Workflow Endpoints ---

@app.post("/workflow/analyze")
def run_workflow(req: SymbolRequest):
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from agents.graph import run_analysis_workflow
    result = run_analysis_workflow(req.symbol)
    return {"workflow_result": result}

