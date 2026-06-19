import type { Candle } from '@/types'
import type { MarketDataQualityResult } from './market-data-quality'

export type CryptoMlFamily =
  | 'lightgbm'
  | 'hybrid_lightgbm_lstm'
  | 'xgboost'
  | 'random_forest'
  | 'ridge'
  | 'elastic_net'
  | 'ols'
  | 'svr'
  | 'bayesian_ridge'
  | 'logistic_regression'
  | 'mean_reversion'
  | 'arma_garch'
  | 'technical_defensive'
  | 'transfer_learning'

export type CryptoHistoryTier =
  | 'complete'
  | 'medium_complete'
  | 'medium'
  | 'short_medium'
  | 'short'
  | 'very_short'
  | 'stable_parity'
  | 'rebrand_noise'

export interface CryptoMlPolicy {
  symbol: string
  historyTier: CryptoHistoryTier
  recommendedModel: string
  modelFamily: CryptoMlFamily
  keyFeatures: string[]
  allowsGradientBoosting: boolean
  allowsLightGbmTraining: boolean
  requiresSentimentFeatures?: boolean
  requiresParityModel?: boolean
  requiresMkrTransfer?: boolean
  zeroVolumeSensitive?: boolean
}

export interface CryptoMlDecision {
  isCrypto: boolean
  isStablecoin: boolean
  policy?: CryptoMlPolicy
  model: string
  modelFamily: CryptoMlFamily | 'standard_quant'
  engineLabel: string
  historyCandles: number
  zeroVolumeRatio: number
  confidenceCap: number
  scorePenalty: number
  lightgbmAllowed: boolean
  pythonAllowed: boolean
  reasons: string[]
}

const STABLECOINS = new Set(['USDC-USD', 'USDG-USD', 'USDT-USD'])

const CRYPTO_POLICIES: Record<string, Omit<CryptoMlPolicy, 'symbol'>> = {
  'AAVE-USD': {
    historyTier: 'medium_complete',
    recommendedModel: 'LightGBM con regularizacion',
    modelFamily: 'lightgbm',
    keyFeatures: ['DEX net volume', 'lending rate spreads', 'DeFi protocol metrics'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'ADA-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM con validacion temporal',
    modelFamily: 'lightgbm',
    keyFeatures: ['EMA crosses', 'daily transaction volume', 'staking participation'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'ARB-USD': {
    historyTier: 'medium',
    recommendedModel: 'XGBoost regularizado',
    modelFamily: 'xgboost',
    keyFeatures: ['L2 gas fees', 'DeFi liquidity flows'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'AVAX-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM optimizado',
    modelFamily: 'lightgbm',
    keyFeatures: ['active subnets', 'bridge volume', 'daily volatility spread'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'BAT-USD': {
    historyTier: 'complete',
    recommendedModel: 'Random Forest Classifier',
    modelFamily: 'random_forest',
    keyFeatures: ['Brave active users', 'ad spend seasonality'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'BCH-USD': {
    historyTier: 'complete',
    recommendedModel: 'SVR',
    modelFamily: 'svr',
    keyFeatures: ['BTC beta', 'hash rate', 'mining difficulty'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'BONK-USD': {
    historyTier: 'short',
    recommendedModel: 'Elastic Net + sentimiento local',
    modelFamily: 'elastic_net',
    keyFeatures: ['Solana transaction volume', 'FinBERT/social sentiment'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresSentimentFeatures: true,
  },
  'BTC-USD': {
    historyTier: 'complete',
    recommendedModel: 'Hibrido LightGBM-LSTM',
    modelFamily: 'hybrid_lightgbm_lstm',
    keyFeatures: ['OHLCV', 'net order volume', 'Fed rates', 'options volatility', 'commodities'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'CRV-USD': {
    historyTier: 'complete',
    recommendedModel: 'Gradient Boosting Trees (XGBoost)',
    modelFamily: 'xgboost',
    keyFeatures: ['Curve TVL', 'stable-pool yields', 'synthetic token premiums'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'DOGE-USD': {
    historyTier: 'complete',
    recommendedModel: 'LSTM profunda',
    modelFamily: 'technical_defensive',
    keyFeatures: ['search trends', 'social interactions', 'large holder flows'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresSentimentFeatures: true,
  },
  'DOT-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM con sintonizacion robusta',
    modelFamily: 'lightgbm',
    keyFeatures: ['active parachains', 'secondary token inflation'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'ETH-USD': {
    historyTier: 'complete',
    recommendedModel: 'LSTM con atencion',
    modelFamily: 'technical_defensive',
    keyFeatures: ['EIP-1559 burn', 'L2 TVL', 'Ethereum gas rates'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'FIL-USD': {
    historyTier: 'short',
    recommendedModel: 'Random Forest',
    modelFamily: 'random_forest',
    keyFeatures: ['active storage capacity', 'storage cost per TB'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'GRT-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM regularizado',
    modelFamily: 'lightgbm',
    keyFeatures: ['indexing queries per minute', 'query fees'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'HYPE-USD': {
    historyTier: 'very_short',
    recommendedModel: 'Regresion Bayesiana Ridge',
    modelFamily: 'bayesian_ridge',
    keyFeatures: ['perpetual funding rates', 'transactions per block'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'LDO-USD': {
    historyTier: 'short',
    recommendedModel: 'LightGBM con sintonizacion de hiperparametros',
    modelFamily: 'lightgbm',
    keyFeatures: ['ETH deposited in Lido', 'stETH staking yield'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'LINK-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM-LSTM hibrido',
    modelFamily: 'hybrid_lightgbm_lstm',
    keyFeatures: ['active oracle feeds', 'enterprise data transactions'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'LTC-USD': {
    historyTier: 'complete',
    recommendedModel: 'OLS',
    modelFamily: 'ols',
    keyFeatures: ['hash rate', 'active addresses', 'cumulative log returns'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'ONDO-USD': {
    historyTier: 'short',
    recommendedModel: 'LightGBM con variables exogenas',
    modelFamily: 'lightgbm',
    keyFeatures: ['short Treasury yields', 'USDY/OUSG minting flows'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'PAXG-USD': {
    historyTier: 'stable_parity',
    recommendedModel: 'ARMA-GARCH econometrico',
    modelFamily: 'arma_garch',
    keyFeatures: ['London spot gold', 'gold ETF capital flows'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'PEPE-USD': {
    historyTier: 'short',
    recommendedModel: 'Ridge + sentimiento',
    modelFamily: 'ridge',
    keyFeatures: ['Ethereum flow', 'bid/ask spread', 'net social sentiment'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresSentimentFeatures: true,
  },
  'POL-USD': {
    historyTier: 'short_medium',
    recommendedModel: 'LightGBM con regularizacion L1',
    modelFamily: 'lightgbm',
    keyFeatures: ['Polygon 2.0 daily transactions', 'staking volume'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'RENDER-USD': {
    historyTier: 'short_medium',
    recommendedModel: 'Random Forest Classifier',
    modelFamily: 'random_forest',
    keyFeatures: ['GPU cloud demand', 'render marketplace transactions'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'SHIB-USD': {
    historyTier: 'medium',
    recommendedModel: 'Ridge Regression',
    modelFamily: 'ridge',
    keyFeatures: ['ShibaSwap activity', 'token burn volume'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'SKY-USD': {
    historyTier: 'rebrand_noise',
    recommendedModel: 'LightGBM con transfer learning de MKR',
    modelFamily: 'transfer_learning',
    keyFeatures: ['MKR history adjusted 1:24000', 'SKY governance migration'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
    requiresMkrTransfer: true,
  },
  'SOL-USD': {
    historyTier: 'complete',
    recommendedModel: 'LSTM profunda',
    modelFamily: 'technical_defensive',
    keyFeatures: ['priority fees', 'NFT transaction volume', 'DEX trading volume'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'SUSHI-USD': {
    historyTier: 'complete',
    recommendedModel: 'Gradient Boosting Trees (XGBoost)',
    modelFamily: 'xgboost',
    keyFeatures: ['daily fees distributed', 'Sushi pool net exchange volume'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
  'TRUMP-USD': {
    historyTier: 'very_short',
    recommendedModel: 'Regresion logistica de clasificacion',
    modelFamily: 'logistic_regression',
    keyFeatures: ['political news volume', 'binary up/down classifier'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresSentimentFeatures: true,
  },
  'UNI-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM',
    modelFamily: 'lightgbm',
    keyFeatures: ['Uniswap v3/v4 pool liquidity', 'DAO proposal participation'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'USDC-USD': {
    historyTier: 'stable_parity',
    recommendedModel: 'Ornstein-Uhlenbeck mean reversion',
    modelFamily: 'mean_reversion',
    keyFeatures: ['peg deviation from 1 USD', 'liquidity', 'spread'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresParityModel: true,
  },
  'USDG-USD': {
    historyTier: 'stable_parity',
    recommendedModel: 'Ornstein-Uhlenbeck / Kalman filter',
    modelFamily: 'mean_reversion',
    keyFeatures: ['Paxos/Anchorage reserve balances', 'peg deviation'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresParityModel: true,
  },
  'USDT-USD': {
    historyTier: 'stable_parity',
    recommendedModel: 'Ornstein-Uhlenbeck / ARIMA',
    modelFamily: 'mean_reversion',
    keyFeatures: ['peg deviation', 'interbank rates', 'Curve stablecoin spreads'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
    requiresParityModel: true,
  },
  'WIF-USD': {
    historyTier: 'short',
    recommendedModel: 'Elastic Net con retardo temporal',
    modelFamily: 'elastic_net',
    keyFeatures: ['24h volatility windows', 'Solana speculative transaction volume'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'XRP-USD': {
    historyTier: 'complete',
    recommendedModel: 'Random Forest',
    modelFamily: 'random_forest',
    keyFeatures: ['regulatory events', 'ODL protocol usage'],
    allowsGradientBoosting: false,
    allowsLightGbmTraining: false,
  },
  'XTZ-USD': {
    historyTier: 'complete',
    recommendedModel: 'LightGBM',
    modelFamily: 'lightgbm',
    keyFeatures: ['active smart contracts', 'baking rewards'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: true,
  },
  'YFI-USD': {
    historyTier: 'complete',
    recommendedModel: 'Gradient Boosting Classifier',
    modelFamily: 'xgboost',
    keyFeatures: ['Yearn vault annual yield', 'DeFi capital withdrawal volume'],
    allowsGradientBoosting: true,
    allowsLightGbmTraining: false,
  },
}

export function isAlpacaCryptoSymbol(symbol: string) {
  return /-USD$/i.test(symbol) && Boolean(CRYPTO_POLICIES[symbol.toUpperCase()] || STABLECOINS.has(symbol.toUpperCase()))
}

export function getCryptoMlPolicy(symbol: string): CryptoMlPolicy | undefined {
  const normalized = symbol.toUpperCase()
  const policy = CRYPTO_POLICIES[normalized]
  return policy ? { symbol: normalized, ...policy } : undefined
}

export function zeroVolumeRatio(candles: Candle[]) {
  if (!candles.length) return 0
  const zeroVolume = candles.filter((candle) => Number(candle.volume ?? 0) <= 0).length
  return zeroVolume / candles.length
}

export function selectCryptoMlDecision(
  symbol: string,
  candles: Candle[],
  quality?: MarketDataQualityResult
): CryptoMlDecision {
  const normalized = symbol.toUpperCase()
  const policy = getCryptoMlPolicy(normalized)
  const isCrypto = isAlpacaCryptoSymbol(normalized)
  const isStablecoin = STABLECOINS.has(normalized) || Boolean(policy?.requiresParityModel)
  const historyCandles = candles.length
  const volumeZeroRatio = zeroVolumeRatio(candles)
  const reasons: string[] = []
  let scorePenalty = 0
  let confidenceCap = 100

  if (!isCrypto) {
    return {
      isCrypto: false,
      isStablecoin: false,
      model: 'Standard quant workflow',
      modelFamily: 'standard_quant',
      engineLabel: 'Quant estandar',
      historyCandles,
      zeroVolumeRatio: volumeZeroRatio,
      confidenceCap,
      scorePenalty,
      lightgbmAllowed: true,
      pythonAllowed: quality?.usable_for_ml !== false,
      reasons: ['Non-crypto asset; standard workflow applies.'],
    }
  }

  if (!policy) reasons.push('No policy found for this crypto symbol; using technical defensive fallback.')
  if (isStablecoin) reasons.push('Stablecoin: model peg deviation, liquidity, spread and depeg risk, not directional trend.')
  if (policy?.requiresMkrTransfer) reasons.push('SKY requires MKR history transfer adjusted by 1:24000 before robust boosting.')
  if (quality?.usable_for_ml === false) reasons.push('Market data quality blocks ML.')

  if (historyCandles < 150) {
    confidenceCap = Math.min(confidenceCap, 40)
    scorePenalty += 25
    reasons.push('Extremely short history: disable gradient boosting to avoid overfit.')
  } else if (historyCandles < 500) {
    confidenceCap = Math.min(confidenceCap, 55)
    scorePenalty += 15
    reasons.push('Short history: prefer Ridge, Elastic Net, logistic or defensive technical models.')
  } else if (historyCandles < 2000) {
    confidenceCap = Math.min(confidenceCap, 75)
    scorePenalty += 6
    reasons.push('Moderate history: use regularized validation, not unconstrained boosting.')
  }

  if (volumeZeroRatio >= 0.35) {
    confidenceCap = Math.min(confidenceCap, 45)
    scorePenalty += 20
    reasons.push('Alpaca CRXL reports many zero-volume midpoint bars; liquidity heuristic limits confidence.')
  } else if (volumeZeroRatio >= 0.15) {
    confidenceCap = Math.min(confidenceCap, 65)
    scorePenalty += 10
    reasons.push('Zero-volume midpoint bars detected; confidence reduced.')
  }

  const lightgbmAllowed = Boolean(
    policy?.allowsLightGbmTraining &&
    quality?.usable_for_ml !== false &&
    !isStablecoin &&
    !policy?.requiresMkrTransfer &&
    historyCandles >= 500 &&
    volumeZeroRatio < 0.35
  )
  const pythonAllowed = Boolean(
    quality?.usable_for_ml !== false &&
    !isStablecoin &&
    historyCandles >= 50 &&
    volumeZeroRatio < 0.5
  )

  const model = policy?.recommendedModel || 'Tecnico defensivo'
  const modelFamily = policy?.modelFamily || 'technical_defensive'
  const engineLabel = lightgbmAllowed
    ? model
    : isStablecoin
      ? 'Modelo de paridad defensivo'
      : modelFamily === 'transfer_learning'
        ? 'Transfer learning requerido'
        : 'Modelo defensivo por madurez/liquidez'

  return {
    isCrypto,
    isStablecoin,
    policy,
    model,
    modelFamily,
    engineLabel,
    historyCandles,
    zeroVolumeRatio: volumeZeroRatio,
    confidenceCap,
    scorePenalty,
    lightgbmAllowed,
    pythonAllowed,
    reasons,
  }
}
