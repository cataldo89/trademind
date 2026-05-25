import os
import sys
from graham_filters import check_margin_of_safety


DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "F", "SPY", "QQQ"]


def parse_symbols(args):
    raw_values = args or os.getenv("GRAHAM_TEST_SYMBOLS", "").split(",")
    symbols = []
    seen = set()

    for value in raw_values:
        for symbol in value.split(","):
            normalized = symbol.strip().upper()
            if normalized and normalized not in seen:
                seen.add(normalized)
                symbols.append(normalized)

    return symbols or DEFAULT_SYMBOLS


if __name__ == "__main__":
    symbols = parse_symbols(sys.argv[1:])
    for sym in symbols:
        passed, reason = check_margin_of_safety(sym)
        print(f"[{sym}] Passed: {passed} | Reason: {reason}")

