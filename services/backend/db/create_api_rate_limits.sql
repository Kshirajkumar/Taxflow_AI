-- TaxFlow.AI: distributed API rate limiting
--
-- Counters live in Postgres so limits remain consistent across backend
-- instances and process restarts. The table and function are backend-only.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key          TEXT NOT NULL,
  window_started_at   TIMESTAMPTZ NOT NULL,
  request_count       INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at          TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_key, window_started_at)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.api_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry
  ON public.api_rate_limits (expires_at);

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_bucket_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  retry_after_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_request_count INTEGER;
BEGIN
  IF p_bucket_key IS NULL OR length(p_bucket_key) = 0
    OR p_limit IS NULL OR p_limit < 1
    OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit arguments';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds);

  DELETE FROM public.api_rate_limits
   WHERE bucket_key = p_bucket_key
     AND expires_at < clock_timestamp();

  INSERT INTO public.api_rate_limits (
    bucket_key, window_started_at, request_count, expires_at, updated_at
  ) VALUES (
    p_bucket_key, v_window_start, 1, v_expires_at, clock_timestamp()
  )
  ON CONFLICT (bucket_key, window_started_at)
  DO UPDATE SET
    request_count = public.api_rate_limits.request_count + 1,
    updated_at = clock_timestamp()
  RETURNING api_rate_limits.request_count INTO v_request_count;

  RETURN QUERY SELECT
    v_request_count <= p_limit,
    greatest(p_limit - v_request_count, 0),
    greatest(1, ceil(extract(epoch FROM (v_expires_at - clock_timestamp())))::INTEGER);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_api_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(TEXT, INTEGER, INTEGER)
  TO service_role;

NOTIFY pgrst, 'reload schema';
