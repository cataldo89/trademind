import os
import time
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone
import yfinance as yf
from dotenv import load_dotenv

# Cargar variables de entorno locales del motor
load_dotenv()

# Configuración de API Keys
ALPHA_VANTAGE_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")
FINNHUB_KEY = os.getenv("FINNHUB_API_KEY")

# Registro del historial de peticiones para control de Rate Limits
# Alpha Vantage: 5 por minuto (limite rolling window de 60 segundos)
# Finnhub: 30 por minuto (limite rolling window de 60 segundos)
api_request_logs = {
    "alpha_vantage": [],
    "finnhub": []
}

def control_rate_limits(provider: str, limit: int):
    """
    Controla el Rate Limit de forma inteligente usando ventanas dinamicas de 60 segundos.
    Si se supera la cuota gratuita, calcula el tiempo necesario y hace una pausa automatica.
    """
    if provider not in api_request_logs:
        return
        
    now = time.time()
    # Filtrar peticiones de hace mas de 60 segundos
    api_request_logs[provider] = [t for t in api_request_logs[provider] if now - t < 60]
    
    if len(api_request_logs[provider]) >= limit:
        # Calcular el tiempo de espera hasta liberar la primera peticion del historial
        oldest_request = api_request_logs[provider][0]
        wait_time = 60.5 - (now - oldest_request)
        if wait_time > 0:
            print(f"[Rate Limit] Limite alcanzado para {provider}. Esperando {wait_time:.2f} segundos...")
            time.sleep(wait_time)
            now = time.time()
            api_request_logs[provider] = [t for t in api_request_logs[provider] if now - t < 60]
            
    # Registrar la peticion actual
    api_request_logs[provider].append(now)

# =====================================================================
# PROVEEDORES INDIVIDUALES CON FORMATO HOMOGÉNEO
# =====================================================================

def fetch_from_yahoo(symbol: str) -> dict:
    """
    Extrae el ultimo precio de cierre diario usando yfinance (Yahoo Finance).
    """
    print(f"[Yahoo] Solicitando ticker: {symbol}")
    ticker = yf.Ticker(symbol.upper().replace(".", "-"))
    # history es eficiente y no dispara los bloqueos masivos de stock.info
    hist = ticker.history(period="1d", auto_adjust=False)
    if hist.empty:
        raise ValueError("Yahoo no devolvio datos de cotizacion para este simbolo.")
        
    price = float(hist["Close"].iloc[-1])
    date_str = hist.index[-1].strftime("%Y-%m-%d")
    
    return {
        "ticker": symbol.upper(),
        "fecha": date_str,
        "precio_cierre": price,
        "fuente_utilizada": "yahoo-finance"
    }

def fetch_from_alpha_vantage(symbol: str) -> dict:
    """
    Extrae el ultimo precio de cierre diario usando el endpoint GLOBAL_QUOTE (Alpha Vantage).
    """
    if not ALPHA_VANTAGE_KEY:
        raise ValueError("ALPHA_VANTAGE_API_KEY no esta configurado.")
        
    # Control de limite de plan gratuito (5 peticiones por minuto)
    control_rate_limits("alpha_vantage", 5)
    
    print(f"[Alpha Vantage] Solicitando ticker: {symbol}")
    url = f"https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={symbol.upper()}&apikey={ALPHA_VANTAGE_KEY}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode('utf-8'))
        
    # Control de rate limit interno de Alpha Vantage
    if "Note" in payload:
        raise RuntimeError(f"Alpha Vantage limite superado (Note): {payload['Note']}")
        
    quote = payload.get("Global Quote")
    if not quote or "05. price" not in quote:
        raise ValueError(f"Respuesta inesperada de Alpha Vantage: {payload}")
        
    price = float(quote["05. price"])
    date_str = quote.get("07. latest trading day", datetime.now().strftime("%Y-%m-%d"))
    
    return {
        "ticker": symbol.upper(),
        "fecha": date_str,
        "precio_cierre": price,
        "fuente_utilizada": "alpha-vantage"
    }

def fetch_from_finnhub(symbol: str) -> dict:
    """
    Extrae el ultimo precio de cierre diario usando el endpoint /quote (Finnhub).
    """
    if not FINNHUB_KEY:
        raise ValueError("FINNHUB_API_KEY no esta configurado.")
        
    # Control de limite de plan gratuito (30 peticiones por minuto)
    control_rate_limits("finnhub", 30)
    
    print(f"[Finnhub] Solicitando ticker: {symbol}")
    # Finnhub necesita simbolos con formato yfinance ej. BRK.B
    formatted_symbol = symbol.upper().replace("-", ".")
    url = f"https://finnhub.io/api/v1/quote?symbol={formatted_symbol}&token={FINNHUB_KEY}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = json.loads(response.read().decode('utf-8'))
        
    # Finnhub devuelve el precio actual en 'c' (current price) y timestamp en 't'
    if "c" not in payload or payload["c"] == 0:
        raise ValueError(f"Respuesta inesperada de Finnhub o ticker inexistente: {payload}")
        
    price = float(payload["c"])
    timestamp = payload.get("t", int(time.time()))
    date_str = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")
    
    return {
        "ticker": symbol.upper(),
        "fecha": date_str,
        "precio_cierre": price,
        "fuente_utilizada": "finnhub"
    }

# =====================================================================
# GESTOR DEL BALANCEO DE CARGA Y FAILOVER
# =====================================================================

class LoadBalancer:
    def __init__(self):
        # Registro de proveedores disponibles en orden
        self.providers = [
            {"name": "alpha-vantage", "fetcher": fetch_from_alpha_vantage},
            {"name": "finnhub", "fetcher": fetch_from_finnhub},
            {"name": "yahoo-finance", "fetcher": fetch_from_yahoo}
        ]
        self.current_provider_index = 0

    def get_next_provider(self) -> dict:
        """
        Selecciona el siguiente proveedor utilizando el algoritmo Round Robin.
        """
        provider = self.providers[self.current_provider_index]
        self.current_provider_index = (self.current_provider_index + 1) % len(self.providers)
        return provider

    def fetch_price(self, symbol: str) -> dict:
        """
        Obtiene el precio de cierre de un ticker con rotacion Round Robin y Failover inmediato en caso de error.
        """
        # Limitar los intentos maximos al numero de proveedores disponibles
        attempts = 0
        max_attempts = len(self.providers)
        
        while attempts < max_attempts:
            provider = self.get_next_provider()
            provider_name = provider["name"]
            fetcher = provider["fetcher"]
            
            try:
                # Intentar descarga con el proveedor seleccionado
                result = fetcher(symbol)
                print(f"-> EXITO: {symbol} obtenido de {provider_name} a ${result['precio_cierre']}")
                return result
            except Exception as e:
                attempts += 1
                print(f"[FAILOVER] Error con {provider_name} para {symbol}: {e}. Redirigiendo consulta...")
                
        # Si se agotaron todos los proveedores para este ticker
        raise RuntimeError(f"Fallo critico: Ninguno de los proveedores ({[p['name'] for p in self.providers]}) pudo obtener datos para {symbol}.")

# =====================================================================
# EJECUCIÓN DEL FLUJO DE PRUEBA
# =====================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("Iniciando extractor Load Balancer para TradeMind...")
    print("=" * 60)
    
    # Lista de prueba de tickers diversos
    tickers = ["AAPL", "MSFT", "GOOGL", "COLO", "PLTR", "TSLA"]
    
    balancer = LoadBalancer()
    results = []
    failed_tickers = []
    
    for ticker in tickers:
        try:
            # Obtener datos de forma segura
            data = balancer.fetch_price(ticker)
            results.append(data)
        except Exception as e:
            print(f"[ERROR CRITICO] No se pudo obtener cotizacion para {ticker}: {e}")
            failed_tickers.append(ticker)
            
    # Guardar resultados localmente en la carpeta de datos
    data_dir = r"c:\Users\catal\Desktop\IA\SAASFACTORY\IA SAAS TRADE CV\trademind\quant-engine\data"
    os.makedirs(data_dir, exist_ok=True)
    output_file = os.path.join(data_dir, "load_balanced_prices.json")
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=4)
        
    print("\n" + "=" * 60)
    print("Resumen de Ejecucion:")
    print("=" * 60)
    print(f"Resultados guardados en: {output_file}")
    print(f"Descargas exitosas: {len(results)}/{len(tickers)}")
    if failed_tickers:
        print(f"Simbolos fallidos: {failed_tickers}")
    print("=" * 60)
