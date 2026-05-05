import yfinance as yf

def check_margin_of_safety(symbol: str):
    try:
        stock = yf.Ticker(symbol)
        info = stock.info
    except Exception as e:
        return False, f"Error fetching data for {symbol}: {e}"

    if not info or ('regularMarketPrice' not in info and 'previousClose' not in info):
        return False, f"Invalid or missing ticker data for {symbol}."
        
    pe_ratio = info.get('trailingPE', None)
    total_debt = info.get('totalDebt', None)
    total_assets = info.get('totalAssets', None)
    
    # 1. Validación de P/E
    if pe_ratio is None or not isinstance(pe_ratio, (int, float)) or pe_ratio <= 0:
        return False, f"P/E ratio is missing or invalid ({pe_ratio}). Graham filter failed."
        
    if pe_ratio > 15:
        return False, f"P/E ratio {pe_ratio:.2f} exceeds Graham's limit of 15."
        
    # 2. Validación de Deuda / Activos
    if total_assets is None or not isinstance(total_assets, (int, float)) or total_assets <= 0:
        return False, "Total Assets information is missing or zero, cannot calculate Debt/Asset."
        
    if total_debt is None or not isinstance(total_debt, (int, float)) or total_debt < 0:
        total_debt = 0
        
    debt_to_asset = total_debt / total_assets
    
    # P0.4: Criterio corregido de acuerdo a la documentación (debe ser < 0.50)
    if debt_to_asset > 0.50:
        return False, f"Debt-to-Asset ratio {debt_to_asset:.2f} exceeds strict limit of 0.50."
        
    return True, f"Passed Margin of Safety. P/E: {pe_ratio:.2f}, Debt/Asset: {debt_to_asset:.2f}"
