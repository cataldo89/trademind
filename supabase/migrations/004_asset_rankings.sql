-- Migration: 004_asset_rankings.sql
-- Purpose: Create table for storing ML asset rankings

CREATE TABLE IF NOT EXISTS public.asset_rankings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid null references auth.users(id) on delete cascade,
    run_id uuid not null default gen_random_uuid(),
    symbol text not null,
    market text not null check (market in ('US', 'CL')),
    rank integer not null,
    score numeric not null,
    signal text not null check (signal in ('BUY', 'HOLD', 'AVOID')),
    confidence numeric,
    risk numeric,
    main_reasons jsonb not null default '[]'::jsonb,
    model_name text not null default 'lightgbm_asset_ranker',
    model_version text,
    model_status text,
    generated_at timestamptz not null default now()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS asset_rankings_user_generated_idx ON public.asset_rankings(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS asset_rankings_symbol_generated_idx ON public.asset_rankings(symbol, generated_at DESC);
CREATE INDEX IF NOT EXISTS asset_rankings_market_signal_idx ON public.asset_rankings(market, signal);
CREATE INDEX IF NOT EXISTS asset_rankings_run_rank_idx ON public.asset_rankings(run_id, rank);

-- RLS Policies
ALTER TABLE public.asset_rankings ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own rankings or global rankings (user_id is null)
CREATE POLICY "Users can read own or global rankings"
ON public.asset_rankings FOR SELECT
USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow authenticated users to insert their own rankings (if needed)
CREATE POLICY "Users can insert own rankings"
ON public.asset_rankings FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Service role bypasses RLS inherently, so backend API can insert global rankings (user_id = null)
