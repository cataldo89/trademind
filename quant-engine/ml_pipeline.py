import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.decomposition import PCA
from sklearn.linear_model import Lasso, Ridge
from sklearn.preprocessing import StandardScaler

def run_pca_autoencoder(symbol: str):
    # Descargar datos para reducción de dimensionalidad
    df = yf.download(symbol, period="1y", progress=False)
    if df.empty:
        return {"status": "error"}
        
    df['Ret'] = df['Close'].pct_change()
    df['Vol'] = df['Volume'].pct_change()
    df = df.dropna()
    
    features = df[['Ret', 'Vol']].values
    scaler = StandardScaler()
    scaled_features = scaler.fit_transform(features)
    
    pca = PCA(n_components=1)
    principal_components = pca.fit_transform(scaled_features)
    
    return {
        "status": "success",
        "principal_components": principal_components[-5:].flatten().tolist(),
        "noise_reduction_ratio": pca.explained_variance_ratio_[0]
    }

def run_lasso_ridge(features_df: pd.DataFrame, target_series: pd.Series):
    X = StandardScaler().fit_transform(features_df.values)
    y = target_series.values
    
    lasso = Lasso(alpha=0.01)
    lasso.fit(X, y)
    
    selected = [features_df.columns[i] for i, c in enumerate(lasso.coef_) if c != 0]
    discarded = [features_df.columns[i] for i, c in enumerate(lasso.coef_) if c == 0]
    
    return {
        "selected_features": selected,
        "discarded_features": discarded
    }
