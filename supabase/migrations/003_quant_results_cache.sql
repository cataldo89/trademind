-- Create table for durable quant results caching
CREATE TABLE IF NOT EXISTS public.quant_results_cache (
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    result JSONB NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT quant_results_cache_pkey PRIMARY KEY (symbol, market)
);

-- Add index for efficient expiration cleanup
CREATE INDEX IF NOT EXISTS idx_quant_results_cache_expires_at ON public.quant_results_cache(expires_at);

-- Enable RLS
ALTER TABLE public.quant_results_cache ENABLE ROW LEVEL SECURITY;

-- PostgREST Policies (Supabase requires explict GRANTs for anon/authenticated)
GRANT ALL ON TABLE public.quant_results_cache TO anon;
GRANT ALL ON TABLE public.quant_results_cache TO authenticated;
GRANT ALL ON TABLE public.quant_results_cache TO service_role;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access to quant_results_cache for everyone"
    ON public.quant_results_cache FOR SELECT
    USING (true);

-- Allow service_role to manage the cache
CREATE POLICY "Allow service_role to insert/update quant_results_cache"
    ON public.quant_results_cache FOR ALL
    USING (true)
    WITH CHECK (true);
