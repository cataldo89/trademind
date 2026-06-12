from __future__ import annotations

import os
import json
import logging
from typing import Dict, List, Any, Tuple
from datetime import datetime

try:
    import pandas as pd
    import numpy as np
    import lightgbm as lgb
except ImportError:
    logging.warning("lightgbm, pandas, or numpy is required. Install it with: pip install lightgbm pandas numpy")
    pd = None
    np = None
    lgb = None

logger = logging.getLogger(__name__)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "lightgbm_asset_ranker.txt")
METADATA_PATH = os.path.join(MODELS_DIR, "lightgbm_asset_ranker_metadata.json")

# Ensure models directory exists
os.makedirs(MODELS_DIR, exist_ok=True)

def _calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def calculate_asset_features(symbol: str, candles: List[Dict[str, Any]]) -> pd.DataFrame:
    """Calculates minimal features from candles."""
    if pd is None:
        raise ImportError("pandas is required")
        
    if not candles or len(candles) < 20:
        return pd.DataFrame()

    df = pd.DataFrame(candles)
    if "time" in df.columns:
        # Assuming time is Unix timestamp or already datetime, try to convert safely
        df["date"] = pd.to_datetime(df["time"], unit="s", errors="coerce").dt.date
    else:
        return pd.DataFrame()

    df = df.sort_values("date").reset_index(drop=True)
    df["symbol"] = symbol

    # Price and Volume
    close = df["close"]
    vol = df.get("volume", pd.Series([0]*len(df)))

    # Returns
    df["return_1d"] = close.pct_change(1)
    df["return_5d"] = close.pct_change(5)
    df["return_20d"] = close.pct_change(20)

    # Volatility
    df["volatility_20d"] = df["return_1d"].rolling(20).std() * np.sqrt(252)
    
    # Volume Change
    df["volume_change_5d"] = vol.pct_change(5)
    
    # SMA
    sma_20 = close.rolling(20).mean()
    sma_50 = close.rolling(50).mean()
    df["price_vs_sma_20"] = (close - sma_20) / sma_20.replace(0, np.nan)
    df["price_vs_sma_50"] = (close - sma_50) / sma_50.replace(0, np.nan)
    
    # RSI
    df["rsi_14"] = _calc_rsi(close, 14)
    
    # Drawdown 20d
    rolling_max_20 = close.rolling(20).max()
    df["drawdown_20d"] = (close - rolling_max_20) / rolling_max_20.replace(0, np.nan)
    
    # Scores
    df["momentum_score"] = df["return_5d"] + df["return_20d"]
    df["risk_score"] = df["volatility_20d"] - df["drawdown_20d"]

    # Target (Forward Return 5d)
    df["forward_return_5d"] = df["close"].shift(-5) / df["close"] - 1

    df = df.dropna(subset=[
        "return_1d", "return_5d", "return_20d", "volatility_20d", 
        "price_vs_sma_20", "price_vs_sma_50", "rsi_14", "drawdown_20d",
        "forward_return_5d" # We drop NA for target so training works. We will handle inference separately if needed
    ])
    
    return df

def build_ranking_dataset(historical_data_by_symbol: Dict[str, List[Dict[str, Any]]]) -> pd.DataFrame:
    """Builds a single dataframe from multiple symbols' historical data."""
    dfs = []
    for symbol, candles in historical_data_by_symbol.items():
        try:
            df = calculate_asset_features(symbol, candles)
            if not df.empty:
                dfs.append(df)
        except Exception as e:
            logger.warning(f"Error calculating features for {symbol}: {e}")
    
    if not dfs:
        return pd.DataFrame()
        
    return pd.concat(dfs, ignore_index=True)

def create_forward_return_target(df: pd.DataFrame, horizon_days: int = 5) -> pd.DataFrame:
    """Calculates risk-adjusted forward return."""
    # Already computed forward_return_5d in features, but let's adjust by risk
    df["future_score"] = df["forward_return_5d"] / df["volatility_20d"].replace(0, np.nan).fillna(0.01)
    return df

def discretize_relevance_by_date(df: pd.DataFrame) -> pd.DataFrame:
    """Converts future_score to 0..4 ordinal relevance per date."""
    def _rank_group(group):
        if len(group) < 5:
            # If too few assets, just assign middle rank
            group["relevance"] = 2
            return group
        
        try:
            # 5 quantiles -> 0 to 4
            group["relevance"] = pd.qcut(group["future_score"], 5, labels=False, duplicates='drop')
        except:
            group["relevance"] = 2
        return group

    df = df.groupby("date", group_keys=False).apply(_rank_group)
    df["relevance"] = df["relevance"].fillna(2).astype(int)
    return df

def train_lightgbm_asset_ranker(historical_data_by_symbol: Dict[str, List[Dict[str, Any]]], horizon_days: int = 5, model_version: str = "v1") -> Dict[str, Any]:
    if lgb is None:
        return {"ok": False, "error": "lightgbm is required. Install it with: pip install lightgbm"}
        
    df = build_ranking_dataset(historical_data_by_symbol)
    if df.empty:
        return {"ok": False, "error": "insufficient_data"}
        
    df = create_forward_return_target(df, horizon_days)
    df = discretize_relevance_by_date(df)
    
    # Sort by date and symbol as required by lightgbm group
    df = df.sort_values(["date", "symbol"]).reset_index(drop=True)
    
    feature_cols = [
        "return_1d", "return_5d", "return_20d", "volatility_20d", 
        "volume_change_5d", "price_vs_sma_20", "price_vs_sma_50", 
        "rsi_14", "drawdown_20d", "momentum_score", "risk_score"
    ]
    
    # Temporal split 80-20
    all_dates = sorted(df["date"].unique())
    if len(all_dates) < 2:
        return {"ok": False, "error": "Not enough dates to split"}
        
    split_idx = int(len(all_dates) * 0.8)
    train_dates = all_dates[:split_idx]
    val_dates = all_dates[split_idx:]
    
    train_df = df[df["date"].isin(train_dates)].copy()
    val_df = df[df["date"].isin(val_dates)].copy()
    
    X_train = train_df[feature_cols]
    y_train = train_df["relevance"]
    g_train = train_df.groupby("date").size().to_numpy()
    
    X_val = val_df[feature_cols]
    y_val = val_df["relevance"]
    g_val = val_df.groupby("date").size().to_numpy()
    
    model = lgb.LGBMRanker(
        objective="lambdarank",
        metric="ndcg",
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        random_state=42
    )
    
    try:
        model.fit(
            X_train, y_train,
            group=g_train,
            eval_set=[(X_val, y_val)],
            eval_group=[g_val],
            eval_at=[10, 25],
            callbacks=[lgb.early_stopping(stopping_rounds=20)]
        )
    except Exception as e:
        return {"ok": False, "error": f"Training failed: {e}"}
        
    save_asset_ranker_model(model, feature_cols, model_version)
    
    # We can fetch metrics from model.best_score_ if we want, but let's just return a placeholder for NDCG
    ndcg_10 = model.best_score_.get("valid_0", {}).get("ndcg@10", 0.0) if hasattr(model, "best_score_") else 0.0
    ndcg_25 = model.best_score_.get("valid_0", {}).get("ndcg@25", 0.0) if hasattr(model, "best_score_") else 0.0
    
    return {
        "ok": True,
        "model": "lightgbm_asset_ranker",
        "model_path": MODEL_PATH,
        "metadata_path": METADATA_PATH,
        "metrics": {
            "ndcg_at_10": ndcg_10,
            "ndcg_at_25": ndcg_25,
            "symbols": len(df["symbol"].unique()),
            "dates": len(all_dates),
            "rows": len(df)
        }
    }

def save_asset_ranker_model(model: Any, feature_cols: List[str], version: str):
    model.booster_.save_model(MODEL_PATH)
    metadata = {
        "version": version,
        "features": feature_cols,
        "updated_at": datetime.utcnow().isoformat()
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f)

def load_asset_ranker_model() -> Tuple[Any, List[str]]:
    if not os.path.exists(MODEL_PATH) or not os.path.exists(METADATA_PATH):
        return None, []
    
    try:
        booster = lgb.Booster(model_file=MODEL_PATH)
        with open(METADATA_PATH, "r") as f:
            metadata = json.load(f)
        return booster, metadata.get("features", [])
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        return None, []

def explain_asset_rank_basic(row: pd.Series) -> List[str]:
    reasons = []
    if row.get("momentum_score", 0) > 0.05:
        reasons.append("strong_momentum")
    if row.get("price_vs_sma_20", -1) > 0:
        reasons.append("above_sma_20")
    if row.get("drawdown_20d", -1) > -0.05:
        reasons.append("low_drawdown")
    if row.get("rsi_14", 50) < 40:
        reasons.append("oversold")
    return reasons[:3]

def map_rank_to_signal(percentile: float) -> str:
    # 0.0 is top (rank 1), 1.0 is bottom
    if percentile <= 0.10:
        return "BUY"
    elif percentile <= 0.70:
        return "HOLD"
    else:
        return "AVOID"

def rank_assets(symbols: List[str], market: str, range_str: str, historical_data_by_symbol: Dict[str, List[Dict[str, Any]]], use_model: bool = True) -> Dict[str, Any]:
    if pd is None:
        return {"ok": False, "error": "pandas not installed"}

    booster, features = load_asset_ranker_model() if use_model else (None, [])
    
    model_status = "loaded" if booster else "fallback_no_model"
    rankings = []
    
    # Evaluate features for the latest date for each symbol
    latest_features_list = []
    
    for symbol in symbols:
        candles = historical_data_by_symbol.get(symbol, [])
        if not candles or len(candles) < 20:
            rankings.append({
                "symbol": symbol,
                "rank": 9999,
                "score": 0.0,
                "signal": "HOLD",
                "confidence": 0.1,
                "risk": 0.5,
                "main_reasons": ["insufficient_data"],
                "model_version": "fallback",
                "generated_at": datetime.utcnow().isoformat()
            })
            continue
            
        # Compute features, don't drop target na since we are inferring
        df = pd.DataFrame(candles)
        df["date"] = pd.to_datetime(df.get("time", df.index), unit="s", errors="coerce").dt.date
        df = df.sort_values("date").reset_index(drop=True)
        
        close = df["close"]
        vol = df.get("volume", pd.Series([0]*len(df)))
        
        df["return_1d"] = close.pct_change(1)
        df["return_5d"] = close.pct_change(5)
        df["return_20d"] = close.pct_change(20)
        df["volatility_20d"] = df["return_1d"].rolling(20).std() * np.sqrt(252)
        df["volume_change_5d"] = vol.pct_change(5)
        sma_20 = close.rolling(20).mean()
        sma_50 = close.rolling(50).mean()
        df["price_vs_sma_20"] = (close - sma_20) / sma_20.replace(0, np.nan)
        df["price_vs_sma_50"] = (close - sma_50) / sma_50.replace(0, np.nan)
        df["rsi_14"] = _calc_rsi(close, 14)
        df["drawdown_20d"] = (close - close.rolling(20).max()) / close.rolling(20).max().replace(0, np.nan)
        df["momentum_score"] = df["return_5d"] + df["return_20d"]
        df["risk_score"] = df["volatility_20d"] - df["drawdown_20d"]
        
        latest_row = df.iloc[-1].copy()
        latest_row["symbol"] = symbol
        latest_features_list.append(latest_row)

    if not latest_features_list:
        return {
            "ok": True,
            "model": "lightgbm_asset_ranker",
            "model_status": "insufficient_data",
            "generated_at": datetime.utcnow().isoformat(),
            "count": len(rankings),
            "rankings": rankings
        }

    features_df = pd.DataFrame(latest_features_list)
    features_df.fillna(0, inplace=True)
    
    if booster and features:
        # Check if all required features exist
        missing = [f for f in features if f not in features_df.columns]
        for m in missing:
            features_df[m] = 0.0
            
        X = features_df[features]
        scores = booster.predict(X)
        features_df["ml_score"] = scores
    else:
        # Fallback heuristic score based on momentum and RSI
        features_df["ml_score"] = features_df["momentum_score"] * 100 + (50 - abs(features_df["rsi_14"] - 50))
        
    features_df["rank"] = features_df["ml_score"].rank(ascending=False, method="min")
    features_df = features_df.sort_values("rank")
    
    total_valid = len(features_df)
    
    meta_ver = "fallback"
    if booster:
        try:
            with open(METADATA_PATH, "r") as f:
                meta_ver = json.load(f).get("version", "v1")
        except Exception as e:
            logger.warning(f"Could not read ranker metadata, using fallback version: {e}")
            meta_ver = "unknown"
    
    for i, row in features_df.iterrows():
        rank = int(row["rank"])
        percentile = (rank - 1) / max(1, (total_valid - 1))
        signal = map_rank_to_signal(percentile)
        
        confidence = 0.8 if booster else 0.5
        risk = float(row.get("volatility_20d", 0.5))
        
        reasons = explain_asset_rank_basic(row)
        
        rankings.append({
            "symbol": row["symbol"],
            "rank": rank,
            "score": float(row["ml_score"]),
            "signal": signal,
            "confidence": confidence,
            "risk": risk,
            "main_reasons": reasons,
            "model_version": meta_ver,
            "generated_at": datetime.utcnow().isoformat()
        })
        
    # Sort final rankings by rank
    rankings = sorted(rankings, key=lambda x: x["rank"])
    
    return {
        "ok": True,
        "model": "lightgbm_asset_ranker",
        "model_status": model_status,
        "generated_at": datetime.utcnow().isoformat(),
        "count": len(rankings),
        "rankings": rankings
    }
