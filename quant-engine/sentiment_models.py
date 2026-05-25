import os
import json
import logging
from typing import List, Dict
import yfinance as yf

# Configuramos la ruta local para no descargar en C:/Users/
os.environ["HF_HOME"] = "./modelos_locales"

# Intenta importar transformers, si falla, hacemos un mock seguro
try:
    from transformers import pipeline
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False

logger = logging.getLogger(__name__)

# Variable global para mantener el modelo en memoria
_sentiment_pipeline = None

def get_pipeline():
    global _sentiment_pipeline
    if not HAS_TRANSFORMERS:
        return None
    if _sentiment_pipeline is None:
        logger.info("Cargando modelo FinBERT en memoria (RTX 5090 CUDA si está disponible)...")
        try:
            import torch
            device = 0 if torch.cuda.is_available() else -1
            _sentiment_pipeline = pipeline("sentiment-analysis", model="ProsusAI/finbert", device=device)
            logger.info(f"Modelo cargado correctamente en {'CUDA' if device == 0 else 'CPU'}")
        except Exception as e:
            logger.error(f"Error cargando pipeline FinBERT: {e}")
            _sentiment_pipeline = None
    return _sentiment_pipeline

def analyze_sentiment_batch(symbols: List[str]) -> Dict[str, dict]:
    results = {}
    pipe = get_pipeline()
    
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            news = ticker.news
            
            if not news:
                results[sym] = {"sentiment": "NEUTRAL", "score": 0, "news_count": 0}
                continue
            
            texts = [item.get('title', '') + ". " + item.get('summary', '') for item in news[:10]]
            
            if pipe:
                # Usar IA Local
                preds = pipe(texts)
                pos = sum(1 for p in preds if p['label'] == 'positive')
                neg = sum(1 for p in preds if p['label'] == 'negative')
                
                score = pos - neg
                if score > 1:
                    overall = "POSITIVE"
                elif score < -1:
                    overall = "NEGATIVE"
                else:
                    overall = "NEUTRAL"
                    
                results[sym] = {"sentiment": overall, "score": score, "news_count": len(texts), "method": "FinBERT (RTX 5090)"}
            else:
                # Fallback sin IA pesada (simulación si no se ha instalado PyTorch aún)
                results[sym] = {"sentiment": "NEUTRAL", "score": 0, "news_count": len(texts), "method": "Fallback"}
                
        except Exception as e:
            logger.error(f"Error procesando {sym}: {e}")
            results[sym] = {"sentiment": "NEUTRAL", "score": 0, "news_count": 0}
            
    return results

def run_daily_sentiment_job(symbols: List[str]):
    """
    Simula el Cron Job. Genera el diccionario y lo guarda en cache JSON.
    """
    logger.info(f"Iniciando escaneo masivo de noticias para {len(symbols)} activos...")
    data = analyze_sentiment_batch(symbols)
    
    with open("sentiment_cache.json", "w") as f:
        json.dump(data, f)
    
    logger.info("Escaneo finalizado y cache actualizado.")
    return data

def get_cached_sentiment(symbol: str) -> dict:
    try:
        if os.path.exists("sentiment_cache.json"):
            with open("sentiment_cache.json", "r") as f:
                cache = json.load(f)
                return cache.get(symbol, None)
    except Exception:
        pass
    return None
