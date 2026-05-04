import sys
from graham_filters import check_margin_of_safety

if __name__ == "__main__":
    symbols = ["TSLA", "F", "AAPL"]
    for sym in symbols:
        passed, reason = check_margin_of_safety(sym)
        print(f"[{sym}] Passed: {passed} | Reason: {reason}")
