-- News sentiment feature store for Finnhub + Marketaux + FinBERT.

CREATE TABLE IF NOT EXISTS public.news_sentiment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  as_of TIMESTAMPTZ NOT NULL,
  horizon_days INTEGER NOT NULL CHECK (horizon_days > 0),
  sent_mean_raw_finnhub DOUBLE PRECISION,
  sent_mean_raw_marketaux DOUBLE PRECISION,
  sent_mean_finbert DOUBLE PRECISION NOT NULL DEFAULT 0,
  sent_share_negative DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (sent_share_negative >= 0 AND sent_share_negative <= 1),
  sent_count_articles INTEGER NOT NULL DEFAULT 0 CHECK (sent_count_articles >= 0),
  sent_trend_1d DOUBLE PRECISION,
  sent_trend_5d DOUBLE PRECISION,
  sent_trend_20d DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, as_of, horizon_days)
);

CREATE INDEX IF NOT EXISTS news_sentiment_symbol_as_of_idx
  ON public.news_sentiment(symbol, as_of DESC);

CREATE INDEX IF NOT EXISTS news_sentiment_symbol_horizon_as_of_idx
  ON public.news_sentiment(symbol, horizon_days, as_of DESC);

ALTER TABLE public.news_sentiment ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.news_sentiment TO authenticated;
GRANT ALL ON TABLE public.news_sentiment TO service_role;

DROP POLICY IF EXISTS "Authenticated users can read news sentiment" ON public.news_sentiment;
CREATE POLICY "Authenticated users can read news sentiment"
  ON public.news_sentiment
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage news sentiment" ON public.news_sentiment;
CREATE POLICY "Service role can manage news sentiment"
  ON public.news_sentiment
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
