-- Migration: 007_ranking_validation_runs.sql
-- Purpose: Track walk-forward validation metrics for the LightGBM Ranker

CREATE TABLE IF NOT EXISTS public.ranking_validation_runs (
    run_id uuid primary key default gen_random_uuid(),
    generated_at timestamptz not null default now(),
    universe text not null,
    symbols_count integer not null,
    model_name text not null,
    model_version text not null,
    top_symbols jsonb not null default '[]'::jsonb,
    horizon_days integer not null,
    return_1d numeric not null,
    return_5d numeric not null,
    return_10d numeric not null,
    hit_rate_5d numeric not null,
    precision_at_10 numeric not null,
    max_drawdown numeric not null,
    benchmark_symbol text not null,
    benchmark_return numeric not null,
    passed_validation boolean not null,
    notes text
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS ranking_validation_runs_generated_at_idx ON public.ranking_validation_runs(generated_at DESC);
CREATE INDEX IF NOT EXISTS ranking_validation_runs_model_version_idx ON public.ranking_validation_runs(model_version);

-- RLS Policies
ALTER TABLE public.ranking_validation_runs ENABLE ROW LEVEL SECURITY;

-- Allow public read (anyone can view metrics)
CREATE POLICY "Users can read ranking validation runs"
ON public.ranking_validation_runs FOR SELECT
USING (true);
