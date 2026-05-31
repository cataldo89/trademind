-- Phase 7: asynchronous quant jobs and market-data cache.
-- Keeps the current local quant-engine usable while giving the cloud migration
-- the same durable contract.

CREATE TABLE IF NOT EXISTS quant_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('workflow_analyze', 'sentiment_scan', 'backtest')),
  symbol TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  timeframe TEXT,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  result JSONB,
  error_code TEXT,
  error_message TEXT,
  lease_owner TEXT,
  leased_until TIMESTAMPTZ,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS quant_jobs_user_idempotency_idx
  ON quant_jobs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS quant_jobs_user_created_idx
  ON quant_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS quant_jobs_worker_queue_idx
  ON quant_jobs(status, priority, created_at)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS quant_job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES quant_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired', 'progress')),
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quant_job_events_job_created_idx
  ON quant_job_events(job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_data_cache (
  symbol TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('US', 'CL')),
  range TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'yahoo-chart',
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  source_etag TEXT,
  PRIMARY KEY (symbol, market, range, provider)
);

CREATE INDEX IF NOT EXISTS market_data_cache_expiry_idx
  ON market_data_cache(expires_at);

CREATE OR REPLACE FUNCTION set_quant_job_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quant_jobs_updated_at ON quant_jobs;
CREATE TRIGGER trg_quant_jobs_updated_at
  BEFORE UPDATE ON quant_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_quant_job_updated_at();

CREATE OR REPLACE FUNCTION enqueue_quant_job_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO quant_job_events(job_id, user_id, status, message, metadata)
  VALUES (
    NEW.id,
    NEW.user_id,
    NEW.status,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'job queued'
      ELSE 'job status changed'
    END,
    jsonb_build_object('kind', NEW.kind, 'symbol', NEW.symbol, 'market', NEW.market)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quant_jobs_insert_event ON quant_jobs;
CREATE TRIGGER trg_quant_jobs_insert_event
  AFTER INSERT ON quant_jobs
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_quant_job_event();

DROP TRIGGER IF EXISTS trg_quant_jobs_status_event ON quant_jobs;
CREATE TRIGGER trg_quant_jobs_status_event
  AFTER UPDATE OF status ON quant_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enqueue_quant_job_event();

CREATE OR REPLACE FUNCTION claim_next_quant_job(
  p_worker_id TEXT,
  p_kinds TEXT[] DEFAULT ARRAY['workflow_analyze', 'sentiment_scan', 'backtest'],
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF quant_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id
    FROM quant_jobs
    WHERE kind = ANY(p_kinds)
      AND attempts < max_attempts
      AND (
        status = 'queued'
        OR (status = 'running' AND leased_until < NOW())
      )
    ORDER BY priority ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE quant_jobs job
  SET
    status = 'running',
    attempts = job.attempts + 1,
    lease_owner = p_worker_id,
    leased_until = NOW() + make_interval(secs => p_lease_seconds),
    started_at = COALESCE(job.started_at, NOW()),
    error_code = NULL,
    error_message = NULL
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION complete_quant_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_status TEXT,
  p_result JSONB DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS quant_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_job quant_jobs;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'INVALID_JOB_STATUS';
  END IF;

  UPDATE quant_jobs
  SET
    status = p_status,
    result = p_result,
    error_code = p_error_code,
    error_message = p_error_message,
    lease_owner = NULL,
    leased_until = NULL,
    completed_at = NOW()
  WHERE id = p_job_id
    AND lease_owner = p_worker_id
  RETURNING * INTO updated_job;

  IF updated_job.id IS NULL THEN
    RAISE EXCEPTION 'JOB_NOT_CLAIMED_BY_WORKER';
  END IF;

  RETURN updated_job;
END;
$$;

ALTER TABLE quant_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quant_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own quant jobs" ON quant_jobs;
CREATE POLICY "Users can insert own quant jobs"
  ON quant_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own quant jobs" ON quant_jobs;
CREATE POLICY "Users can read own quant jobs"
  ON quant_jobs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can cancel own queued quant jobs" ON quant_jobs;
CREATE POLICY "Users can cancel own queued quant jobs"
  ON quant_jobs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'queued')
  WITH CHECK (auth.uid() = user_id AND status = 'cancelled');

DROP POLICY IF EXISTS "Users can read own quant job events" ON quant_job_events;
CREATE POLICY "Users can read own quant job events"
  ON quant_job_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can read market data cache" ON market_data_cache;
CREATE POLICY "Authenticated users can read market data cache"
  ON market_data_cache
  FOR SELECT
  TO authenticated
  USING (expires_at > NOW());
