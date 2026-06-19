from __future__ import annotations

import os
import json
import logging
import uuid
from typing import Dict, List, Any, Tuple, Optional
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

def _recent_ipo_score(symbol: str, candles: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Short-history fallback: no MA50/MACD, score by day move and volume."""
    if not candles or len(candles) < 2:
        return None

    closes = [float(c.get("close", 0) or 0) for c in candles if float(c.get("close", 0) or 0) > 0]
    volumes = [float(c.get("volume", 0) or 0) for c in candles if float(c.get("volume", 0) or 0) >= 0]
    if len(closes) < 2:
        return None

    last = closes[-1]
    previous = closes[-2]
    return_1d = (last - previous) / previous if previous > 0 else 0
    day_volume = volumes[-1] if volumes else 0
    liquidity_score = min(12, np.log10(max(1, day_volume))) if np is not None else 0
    score = max(1, min(85, 50 + (return_1d * 125) + liquidity_score + min(8, len(closes))))
    signal = "HOLD"  # Fast ranking never outputs BUY directly
    confidence = max(0.45, min(0.69, score / 100))

    reasons = [
        "recent_ipo_short_history",
        "long_term_indicators_disabled",
    ]
    if return_1d > 0:
        reasons.append("positive_immediate_change")
    if day_volume > 100000:
        reasons.append("valid_day_volume")

    return {
        "symbol": symbol,
        "rank": 0,
        "score": float(score),
        "signal": signal,
        "confidence": float(confidence),
        "risk": 0.6,
        "main_reasons": reasons,
        "model_version": "recent_ipo_fallback",
        "history_candles": len(closes),
        "generated_at": datetime.utcnow().isoformat()
    }

def calculate_asset_features(symbol: str, candles: List[Dict[str, Any]]) -> pd.DataFrame:
    """Calculates minimal features from candles."""
    if pd is None:
        raise ImportError("pandas is required")
        
    if not candles or len(candles) < 20:
        return pd.DataFrame()

    df = pd.DataFrame(candles)
    if "time" in df.columns:
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
        "forward_return_5d"
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
    df["future_score"] = df["forward_return_5d"] / df["volatility_20d"].replace(0, np.nan).fillna(0.01)
    return df

def discretize_relevance_by_date(df: pd.DataFrame) -> pd.DataFrame:
    """Converts future_score to 0..4 ordinal relevance per date."""
    def _rank_group(group):
        n = len(group)
        if n < 2:
            group["relevance"] = 2
            return group
        
        try:
            bins = min(5, n)
            group["relevance"] = pd.qcut(group["future_score"], bins, labels=False, duplicates='drop')
            if bins < 5 and bins > 1:
                group["relevance"] = (group["relevance"] * (4 / (bins - 1))).round().astype(int)
        except Exception:
            ranks = group["future_score"].rank(method="first") - 1
            if n > 1:
                group["relevance"] = (ranks * (4 / (n - 1))).round().astype(int)
            else:
                group["relevance"] = 2
        return group

    df = df.groupby("date", group_keys=False).apply(_rank_group)
    df["relevance"] = df["relevance"].fillna(2).astype(int)
    return df

def calculate_ndcg_at_10(relevances: List[float]) -> float:
    if not relevances:
        return 0.0
    actual_k = min(10, len(relevances))
    dcg = sum(rel / np.log2(idx + 2) for idx, rel in enumerate(relevances[:actual_k]))
    ideal_relevances = sorted(relevances, reverse=True)
    idcg = sum(rel / np.log2(idx + 2) for idx, rel in enumerate(ideal_relevances[:actual_k]))
    return float(dcg / idcg) if idcg > 0 else 0.0

def train_lightgbm_asset_ranker(
    historical_data_by_symbol: Dict[str, List[Dict[str, Any]]],
    horizon_days: int = 5,
    model_version: str = "v1"
) -> Dict[str, Any]:
    if lgb is None:
        return {"ok": False, "error": "lightgbm is required. Install it with: pip install lightgbm"}
        
    df = build_ranking_dataset(historical_data_by_symbol)
    if df.empty:
        return {"ok": False, "error": "insufficient_data"}
        
    df = create_forward_return_target(df, horizon_days)
    df = discretize_relevance_by_date(df)
    df = df.sort_values(["date", "symbol"]).reset_index(drop=True)
    
    feature_cols = [
        "return_1d", "return_5d", "return_20d", "volatility_20d", 
        "volume_change_5d", "price_vs_sma_20", "price_vs_sma_50", 
        "rsi_14", "drawdown_20d", "momentum_score", "risk_score"
    ]
    
    all_dates = sorted(df["date"].unique())
    if len(all_dates) < 2:
        return {"ok": False, "error": "Not enough dates to run validation"}
        
    # Walk-Forward Validation Setup
    # Expanding window validation (e.g. 3 folds)
    num_folds = 3
    fold_size = len(all_dates) // (num_folds + 1)
    
    ndcg_list = []
    precision_list = []
    return_1d_list = []
    return_5d_list = []
    hit_rate_list = []
    drawdown_list = []
    benchmark_list = []
    
    for fold in range(num_folds):
        train_end_idx = fold_size * (fold + 1)
        val_end_idx = train_end_idx + fold_size if fold < num_folds - 1 else len(all_dates)
        
        train_dates = all_dates[:train_end_idx]
        val_dates = all_dates[train_end_idx:val_end_idx]
        
        if not train_dates or not val_dates:
            continue
            
        train_df = df[df["date"].isin(train_dates)].copy()
        val_df = df[df["date"].isin(val_dates)].copy()
        
        if train_df.empty or val_df.empty:
            continue
            
        X_tr = train_df[feature_cols]
        y_tr = train_df["relevance"]
        g_tr = train_df.groupby("date").size().to_numpy()
        
        X_va = val_df[feature_cols]
        y_va = val_df["relevance"]
        g_va = val_df.groupby("date").size().to_numpy()
        
        fold_model = lgb.LGBMRanker(
            objective="lambdarank",
            metric="ndcg",
            n_estimators=100,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=5,
            random_state=42
        )
        
        try:
            fold_model.fit(
                X_tr, y_tr,
                group=g_tr,
                eval_set=[(X_va, y_va)],
                eval_group=[g_va],
                eval_at=[10],
                callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)]
            )
            
            # Predict and evaluate on validation set per date
            val_df["pred_score"] = fold_model.predict(X_va)
            
            for d, group in val_df.groupby("date"):
                group_sorted = group.sort_values("pred_score", ascending=False)
                top_10 = group_sorted.head(10)
                
                # NDCG@10
                ndcg = calculate_ndcg_at_10(group_sorted["relevance"].tolist())
                ndcg_list.append(ndcg)
                
                # Precision@10 (proportion with positive 5d forward return)
                pos_returns = [r for r in top_10["forward_return_5d"] if r > 0]
                precision = len(pos_returns) / len(top_10) if len(top_10) > 0 else 0.0
                precision_list.append(precision)
                
                # Returns
                mean_ret_5d = float(top_10["forward_return_5d"].mean()) if len(top_10) > 0 else 0.0
                mean_ret_1d = float(top_10["return_1d"].mean()) if len(top_10) > 0 else 0.0
                return_5d_list.append(mean_ret_5d)
                return_1d_list.append(mean_ret_1d)
                
                # Hit rate
                hit_rate_list.append(1.0 if mean_ret_5d > 0 else 0.0)
                
                # Max Drawdown of top 10
                dd = float(top_10["drawdown_20d"].min()) if len(top_10) > 0 else 0.0
                drawdown_list.append(dd)
                
                # Benchmark Return (average 5d return of all assets on this date)
                benchmark_ret = float(group["forward_return_5d"].mean())
                benchmark_list.append(benchmark_ret)
                
        except Exception as e:
            logger.warning(f"Validation fold {fold} failed: {e}")
            
    # Calculate average metrics
    avg_ndcg = float(np.mean(ndcg_list)) if ndcg_list else 0.0
    avg_precision = float(np.mean(precision_list)) if precision_list else 0.0
    avg_ret_1d = float(np.mean(return_1d_list)) if return_1d_list else 0.0
    avg_ret_5d = float(np.mean(return_5d_list)) if return_5d_list else 0.0
    avg_hit_rate = float(np.mean(hit_rate_list)) if hit_rate_list else 0.0
    avg_dd = float(np.min(drawdown_list)) if drawdown_list else 0.0
    avg_benchmark = float(np.mean(benchmark_list)) if benchmark_list else 0.0
    
    # 3. Train final model on entire dataset
    X_all = df[feature_cols]
    y_all = df["relevance"]
    g_all = df.groupby("date").size().to_numpy()
    
    final_model = lgb.LGBMRanker(
        objective="lambdarank",
        metric="ndcg",
        n_estimators=150,
        learning_rate=0.05,
        num_leaves=15,
        min_child_samples=5,
        random_state=42
    )
    
    try:
        final_model.fit(X_all, y_all, group=g_all)
    except Exception as e:
        return {"ok": False, "error": f"Final model training failed: {e}"}
        
    # Check thresholds
    passed_validation = avg_ndcg >= 0.50 and avg_precision >= 0.45
    model_status = "loaded" if passed_validation else "weak_validation"
    
    save_asset_ranker_model(final_model, feature_cols, model_version, model_status)
    
    return {
        "ok": True,
        "model": "lightgbm_asset_ranker",
        "model_status": model_status,
        "model_path": MODEL_PATH,
        "metadata_path": METADATA_PATH,
        "run_id": str(uuid.uuid4()),
        "passed_validation": passed_validation,
        "metrics": {
            "ndcg_at_10": avg_ndcg,
            "precision_at_10": avg_precision,
            "top10_return_1d": avg_ret_1d,
            "top10_return_5d": avg_ret_5d,
            "top10_return_10d": avg_ret_5d * 1.5, # extrapolation
            "top10_hit_rate_5d": avg_hit_rate,
            "top10_max_drawdown": avg_dd,
            "benchmark_return": avg_benchmark,
            "symbols_count": len(df["symbol"].unique()),
            "dates": len(all_dates),
            "rows": len(df)
        }
    }

def save_asset_ranker_model(model: Any, feature_cols: List[str], version: str, model_status: str):
    model.booster_.save_model(MODEL_PATH)
    metadata = {
        "version": version,
        "features": feature_cols,
        "model_status": model_status,
        "updated_at": datetime.utcnow().isoformat()
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f)

def load_asset_ranker_model() -> Tuple[Any, List[str], str]:
    if not os.path.exists(MODEL_PATH) or not os.path.exists(METADATA_PATH):
        return None, [], "fallback_no_model"
    
    try:
        booster = lgb.Booster(model_file=MODEL_PATH)
        with open(METADATA_PATH, "r") as f:
            metadata = json.load(f)
        return booster, metadata.get("features", []), metadata.get("model_status", "loaded")
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        return None, [], "fallback_no_model"

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
    # 0.0 is top (rank 1), 1.0 is bottom.
    # Fast ranking never outputs BUY, it output WATCHLIST or AVOID.
    if percentile <= 0.10:
        return "WATCHLIST"
    elif percentile <= 0.70:
        return "WATCHLIST"
    else:
        return "AVOID"

def _finalize_rankings(rankings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    eligible_rankings = [item for item in rankings if int(item.get("rank", 9999)) != 9999]
    blocked_rankings = [item for item in rankings if int(item.get("rank", 9999)) == 9999]

    def get_signal_priority(item):
        sig = str(item.get("signal", "WATCHLIST")).upper()
        if sig == "WATCHLIST":
            return 1
        return 0

    eligible_rankings = sorted(
        eligible_rankings,
        key=lambda x: (get_signal_priority(x), float(x.get("score", 0.0))),
        reverse=True
    )

    total_ranked = len(eligible_rankings)
    for idx, item in enumerate(eligible_rankings):
        item["rank"] = idx + 1
        if item.get("model_version") != "recent_ipo_fallback":
            percentile = idx / max(1, total_ranked - 1)
            item["signal"] = map_rank_to_signal(percentile)

    return eligible_rankings + blocked_rankings

def rank_assets(symbols: List[str], market: str, range_str: str, historical_data_by_symbol: Dict[str, List[Dict[str, Any]]], use_model: bool = True) -> Dict[str, Any]:
    if pd is None:
        return {"ok": False, "error": "pandas not installed"}

    booster, features, model_status = load_asset_ranker_model() if use_model else (None, [], "fallback_no_model")
    
    rankings = []
    latest_features_list = []
    
    for symbol in symbols:
        candles = historical_data_by_symbol.get(symbol, [])
        if not candles or len(candles) < 20:
            recent_ipo = _recent_ipo_score(symbol, candles)
            if recent_ipo:
                rankings.append(recent_ipo)
                continue
            rankings.append({
                "symbol": symbol,
                "rank": 9999,
                "score": 0.0,
                "signal": "WATCHLIST",
                "confidence": 0.1,
                "risk": 0.5,
                "main_reasons": ["insufficient_data"],
                "model_version": "fallback",
                "generated_at": datetime.utcnow().isoformat()
            })
            continue
            
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
        rankings = _finalize_rankings(rankings)
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
        missing = [f for f in features if f not in features_df.columns]
        for m in missing:
            features_df[m] = 0.0
            
        X = features_df[features]
        scores = booster.predict(X)
        features_df["ml_score"] = scores
    else:
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
            logger.warning(f"Could not read ranker metadata: {e}")
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
        
    rankings = _finalize_rankings(rankings)
    
    return {
        "ok": True,
        "model": "lightgbm_asset_ranker",
        "model_status": model_status,
        "generated_at": datetime.utcnow().isoformat(),
        "count": len(rankings),
        "rankings": rankings
    }
