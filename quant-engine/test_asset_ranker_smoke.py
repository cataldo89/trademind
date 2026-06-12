import sys
import os
import json
import time
from typing import Dict, Any

# Ensure we can import from quant-engine
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from asset_ranker import train_lightgbm_asset_ranker, rank_assets

def generate_synthetic_candles(num_days=30):
    candles = []
    base_time = int(time.time()) - (num_days * 86400)
    base_price = 100.0
    for i in range(num_days):
        candles.append({
            "time": base_time + (i * 86400),
            "open": base_price,
            "high": base_price * 1.02,
            "low": base_price * 0.98,
            "close": base_price * (1.01 if i % 2 == 0 else 0.99), # Slight zig zag
            "volume": 1000 + (i * 10)
        })
        base_price = candles[-1]["close"]
    return candles

def main():
    print("Generating synthetic data...")
    # Generate for 3 symbols
    historical_data = {
        "AAPL": generate_synthetic_candles(60),
        "MSFT": generate_synthetic_candles(60),
        "TSLA": generate_synthetic_candles(60),
    }

    print("Training model...")
    train_res = train_lightgbm_asset_ranker(
        historical_data_by_symbol=historical_data,
        horizon_days=5,
        model_version="smoke_v1"
    )
    print(json.dumps(train_res, indent=2))
    
    if not train_res.get("ok"):
        print("Training failed (or lightgbm not installed). Proceeding to fallback test.")

    print("\nRanking assets...")
    rank_res = rank_assets(
        symbols=["AAPL", "MSFT", "TSLA", "UNKNOWN_NO_DATA"],
        market="US",
        range_str="1y",
        historical_data_by_symbol=historical_data,
        use_model=True
    )
    print(json.dumps(rank_res, indent=2))
    
    if rank_res.get("ok"):
        print("\nSmoke test passed.")
    else:
        print("\nSmoke test failed:", rank_res.get("error"))

if __name__ == "__main__":
    main()
