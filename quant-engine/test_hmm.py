import argparse
import os
import re
from pathlib import Path

from risk_models import calculate_var_garch, detect_regime, predict_direction_arima


DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"]
ENV_SYMBOLS = "HMM_TEST_SYMBOLS"


def parse_symbol_values(values):
    symbols = []
    seen = set()

    for value in values:
        for symbol in str(value).split(","):
            normalized = symbol.strip().upper()
            if normalized and normalized not in seen:
                seen.add(normalized)
                symbols.append(normalized)

    return symbols


def load_zesty_symbols():
    repo_root = Path(__file__).resolve().parents[1]
    market_data_path = repo_root / "src" / "lib" / "market-data.ts"
    source = market_data_path.read_text(encoding="utf-8")

    array_match = re.search(
        r"export\s+const\s+ZESTY_SYMBOLS\s*=\s*\[([\s\S]*?)\]\s*(?:\n|$)",
        source,
    )
    if not array_match:
        raise RuntimeError(f"Could not find ZESTY_SYMBOLS in {market_data_path}")

    object_regex = re.compile(
        r"\{[\s\S]*?symbol\s*:\s*(['\"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,"
        r"\s*name\s*:\s*(['\"])((?:\\.|(?!\3)[\s\S])*?)\3[\s\S]*?\}"
    )

    return parse_symbol_values(match.group(2) for match in object_regex.finditer(array_match.group(1)))


def resolve_symbols(args):
    values = []

    if args.all_zesty:
        values.extend(load_zesty_symbols())

    if args.symbols:
        values.extend(args.symbols)

    env_symbols = os.getenv(ENV_SYMBOLS, "")
    if env_symbols:
        values.append(env_symbols)

    symbols = parse_symbol_values(values) if values else DEFAULT_SYMBOLS
    if args.limit is not None:
        symbols = symbols[: args.limit]

    return symbols


def format_percent(value):
    if isinstance(value, (int, float)):
        return f"{value * 100:.2f}%"
    return "n/a"


def run_symbol(symbol):
    print(f"\n--- Testing {symbol} ---")

    print("1. Detecting current market regime (HMM)...")
    regime = detect_regime(symbol)
    print(f"Regime: {regime}")

    print("2. Predicting 1-day direction (ARIMA)...")
    prediction = predict_direction_arima(symbol)
    print(f"Expected return: {format_percent(prediction.get('expected_return'))}")

    print("3. Calculating volatility and VaR (GARCH)...")
    var_data = calculate_var_garch(symbol, "1D")
    print(f"VaR 1D (95%): {format_percent(var_data.get('var_1d_95'))}")
    print(f"Annualized volatility: {format_percent(var_data.get('annualized_vol'))}")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Smoke test HMM, ARIMA and GARCH for one or many symbols."
    )
    parser.add_argument(
        "symbols",
        nargs="*",
        help="Symbols to test. Accepts spaces or commas, e.g. AAPL MSFT or AAPL,MSFT.",
    )
    parser.add_argument(
        "--all-zesty",
        action="store_true",
        help="Load every symbol from src/lib/market-data.ts ZESTY_SYMBOLS.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of resolved symbols to test.",
    )
    return parser


if __name__ == "__main__":
    parser = build_parser()
    parsed_args = parser.parse_args()
    if parsed_args.limit is not None and parsed_args.limit < 1:
        parser.error("--limit must be greater than or equal to 1")

    resolved_symbols = resolve_symbols(parsed_args)

    print(f"Resolved {len(resolved_symbols)} symbol(s).")
    for resolved_symbol in resolved_symbols:
        run_symbol(resolved_symbol)
