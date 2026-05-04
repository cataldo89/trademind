import yfinance as yf

def check_margin_of_safety(symbol: str):
    stock = yf.Ticker(symbol)
    info = stock.info
    
    pe_ratio = info.get('trailingPE', 999)
    total_debt = info.get('totalDebt', 0)
    total_assets = info.get('totalAssets', 1)
    
    # Si la API de Yahoo falla en dar totalAssets, intentamos un fallback o calculamos distinto
    debt_to_asset = total_debt / total_assets if total_assets else 0
    
    if pe_ratio > 15:
        return False, f"P/E ratio {pe_ratio} exceeds Graham's limit of 15."
    
    if debt_to_asset > 1.10:
        return False, f"Debt-to-Asset ratio {debt_to_asset:.2f} exceeds limit of 1.10."
        
    return True, f"Passed Margin of Safety. P/E: {pe_ratio}, Debt/Asset: {debt_to_asset:.2f}"
