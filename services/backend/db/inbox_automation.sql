-- Inbox automation: shared templates, country time zones, and server-side Telegram schedules.
-- Run in the Supabase SQL Editor for your project. Safe to run multiple times.

-- ==============================================================================
-- 1. MESSAGE TEMPLATES TABLE (Shared Defaults + Private User Templates)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  cat         VARCHAR(50) NOT NULL DEFAULT 'Utility',
  body        TEXT NOT NULL,
  protected   BOOLEAN NOT NULL DEFAULT FALSE,
  template_key TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS template_key TEXT;

ALTER TABLE public.message_templates
  ALTER COLUMN user_id DROP NOT NULL;

WITH ranked_defaults AS (
  SELECT id,
         row_number() OVER (PARTITION BY template_key ORDER BY created_at, id) AS row_number
  FROM public.message_templates
  WHERE protected = TRUE
    AND template_key IN ('website_link', 'portal_link', 'docs', 'pending', 'itr', 'portal_invite')
    AND user_id IS NOT NULL
)
DELETE FROM public.message_templates AS template
USING ranked_defaults AS ranked
WHERE template.id = ranked.id
  AND ranked.row_number > 1;

UPDATE public.message_templates AS template
SET user_id = NULL,
    updated_at = clock_timestamp()
WHERE template.protected = TRUE
  AND template.template_key IN ('website_link', 'portal_link', 'docs', 'pending', 'itr', 'portal_invite')
  AND template.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.message_templates AS shared
    WHERE shared.template_key = template.template_key
      AND shared.user_id IS NULL
  );

DELETE FROM public.message_templates AS template
WHERE template.protected = TRUE
  AND template.template_key IN ('website_link', 'portal_link', 'docs', 'pending', 'itr', 'portal_invite')
  AND template.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.message_templates AS shared
    WHERE shared.template_key = template.template_key
      AND shared.user_id IS NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_shared_template_key_idx
  ON public.message_templates(template_key)
  WHERE user_id IS NULL AND template_key IS NOT NULL;

-- 1. Website link template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- 2. Client portal website link template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'portal_link', 'Client portal website link', 'Client portal', 'Hello {name}, you can sign in to your TaxFlow client portal and upload your requested documents here: {portalLink}', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- 3. GST documents request template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'docs', 'GST documents request', 'Utility', 'Hello {name}, please upload your {period} sales & purchase invoices through your secure client portal: {portalLink}. Deadline: {due}.', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- 4. Missing document template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'pending', 'Missing document', 'Utility', 'Hi {name}, we have not received the {doc} for {period} yet. Please upload it through your secure client portal: {portalLink}.', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- 5. ITR documents template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'itr', 'ITR documents', 'Utility', 'Hi {name}, to file your ITR please upload Form 16 / 26AS, bank interest certificates, and investment proofs through your secure client portal: {portalLink}.', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- 6. Secure portal invitation template
INSERT INTO public.message_templates (user_id, template_key, name, cat, body, protected)
VALUES (NULL, 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hi {name}, open this private link from your CA to access your documents and upload files using our secure file-transfer service: {portalLink}

Use the same email address your CA has on file. Please do not send tax, financial, identity, or other sensitive documents in Telegram.', TRUE)
ON CONFLICT (template_key) WHERE user_id IS NULL AND template_key IS NOT NULL
DO UPDATE SET name = EXCLUDED.name, cat = EXCLUDED.cat, body = EXCLUDED.body;

-- Message templates RLS
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_select_policy ON public.message_templates;
CREATE POLICY message_templates_select_policy ON public.message_templates
  FOR SELECT
  TO authenticated, service_role
  USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS message_templates_insert_policy ON public.message_templates;
CREATE POLICY message_templates_insert_policy ON public.message_templates
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (user_id = auth.uid() OR auth.uid() IS NULL);

DROP POLICY IF EXISTS message_templates_update_policy ON public.message_templates;
CREATE POLICY message_templates_update_policy ON public.message_templates
  FOR UPDATE
  TO authenticated, service_role
  USING (user_id = auth.uid() AND protected = FALSE)
  WITH CHECK (user_id = auth.uid() AND protected = FALSE);

DROP POLICY IF EXISTS message_templates_delete_policy ON public.message_templates;
CREATE POLICY message_templates_delete_policy ON public.message_templates
  FOR DELETE
  TO authenticated, service_role
  USING (user_id = auth.uid() AND protected = FALSE);


-- ==============================================================================
-- 2. SUPPORTED COUNTRIES AND TIMEZONES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.supported_countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(10) NOT NULL UNIQUE,
  country_name VARCHAR(120) NOT NULL,
  tax_authority_name TEXT,
  portal_name TEXT,
  portal_url TEXT,
  currency_code VARCHAR(10) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.supported_countries (id, country_code, country_name, tax_authority_name, portal_name, portal_url, currency_code, is_active)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'IN', 'India', 'Income Tax Department / GSTN / TRACES', 'Income Tax e-Filing / GST Portal', 'https://www.incometax.gov.in/', 'INR', TRUE),
  ('10000000-0000-4000-8000-000000000002', 'US', 'United States', 'Internal Revenue Service', 'IRS e-file / MeF', 'https://www.irs.gov/e-file-providers', 'USD', TRUE),
  ('10000000-0000-4000-8000-000000000003', 'AE', 'United Arab Emirates', 'Federal Tax Authority', 'EmaraTax', 'https://eservices.tax.gov.ae/', 'AED', TRUE),
  ('10000000-0000-4000-8000-000000000004', 'SG', 'Singapore', 'Inland Revenue Authority of Singapore', 'myTax Portal', 'https://mytax.iras.gov.sg/', 'SGD', TRUE),
  ('10000000-0000-4000-8000-000000000005', 'GB', 'United Kingdom', 'HM Revenue & Customs', 'HMRC online services / MTD', 'https://www.gov.uk/government/organisations/hm-revenue-customs', 'GBP', TRUE)
ON CONFLICT (country_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.supported_country_timezones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES public.supported_countries(id) ON DELETE CASCADE,
  timezone_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_id, timezone_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS supported_country_timezones_one_default_idx
  ON public.supported_country_timezones(country_id)
  WHERE is_default = TRUE;

INSERT INTO public.supported_country_timezones (country_id, timezone_name, is_default)
SELECT country.id, timezone.timezone_name, timezone.is_default
FROM (
  VALUES
    ('IN', 'Asia/Kolkata', TRUE),
    ('US', 'America/New_York', TRUE),
    ('US', 'America/Chicago', FALSE),
    ('US', 'America/Denver', FALSE),
    ('US', 'America/Phoenix', FALSE),
    ('US', 'America/Los_Angeles', FALSE),
    ('US', 'America/Anchorage', FALSE),
    ('US', 'Pacific/Honolulu', FALSE),
    ('AE', 'Asia/Dubai', TRUE),
    ('SG', 'Asia/Singapore', TRUE),
    ('GB', 'Europe/London', TRUE)
) AS timezone(country_code, timezone_name, is_default)
JOIN public.supported_countries AS country USING (country_code)
ON CONFLICT (country_id, timezone_name)
DO UPDATE SET is_default = EXCLUDED.is_default;

ALTER TABLE public.supported_country_timezones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supported_country_timezones FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.supported_country_timezones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supported_country_timezones TO service_role;
DROP POLICY IF EXISTS supported_country_timezones_service_role ON public.supported_country_timezones;
CREATE POLICY supported_country_timezones_service_role
  ON public.supported_country_timezones FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);


-- ==============================================================================
-- 3. SCHEDULES TABLE (One-time and Daily Recurring Messages)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_message_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  message_body TEXT NOT NULL CHECK (char_length(message_body) BETWEEN 1 AND 4096),
  repeat_mode TEXT NOT NULL CHECK (repeat_mode IN ('once', 'daily')),
  timezone_name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  local_time TIME,
  next_run_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  occurrence_count INTEGER NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  lease_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_message_schedules_repeat_fields_check CHECK (
    (repeat_mode = 'once' AND scheduled_at IS NOT NULL AND local_time IS NULL)
    OR (repeat_mode = 'daily' AND scheduled_at IS NULL AND local_time IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS telegram_message_schedules_due_idx
  ON public.telegram_message_schedules(next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS telegram_message_schedules_owner_created_idx
  ON public.telegram_message_schedules(owner_user_id, created_at DESC);

ALTER TABLE public.telegram_message_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_message_schedules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_message_schedules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_message_schedules TO authenticated, service_role;
DROP POLICY IF EXISTS telegram_message_schedules_owner_policy ON public.telegram_message_schedules;
CREATE POLICY telegram_message_schedules_owner_policy
  ON public.telegram_message_schedules FOR ALL
  TO authenticated, service_role
  USING (owner_user_id = auth.uid() OR auth.uid() IS NULL)
  WITH CHECK (owner_user_id = auth.uid() OR auth.uid() IS NULL);

CREATE OR REPLACE FUNCTION public.claim_due_telegram_message_schedules(p_limit INTEGER DEFAULT 20)
RETURNS SETOF public.telegram_message_schedules
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT schedule.id
    FROM public.telegram_message_schedules AS schedule
    WHERE schedule.status = 'active'
      AND schedule.next_run_at <= clock_timestamp()
      AND (schedule.lease_until IS NULL OR schedule.lease_until < clock_timestamp())
    ORDER BY schedule.next_run_at, schedule.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  )
  UPDATE public.telegram_message_schedules AS schedule
  SET lease_until = clock_timestamp() + INTERVAL '5 minutes',
      last_attempt_at = clock_timestamp(),
      attempt_count = schedule.attempt_count + 1,
      updated_at = clock_timestamp()
  FROM due
  WHERE schedule.id = due.id
  RETURNING schedule.*;
$$;

CREATE OR REPLACE FUNCTION public.finish_telegram_message_schedule(
  p_schedule_id UUID,
  p_succeeded BOOLEAN,
  p_error TEXT DEFAULT NULL,
  p_next_run_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_schedule public.telegram_message_schedules%ROWTYPE;
BEGIN
  SELECT * INTO v_schedule
  FROM public.telegram_message_schedules
  WHERE id = p_schedule_id
    AND status = 'active'
    AND lease_until IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule is not currently claimed';
  END IF;

  IF p_succeeded THEN
    UPDATE public.telegram_message_schedules
    SET status = CASE WHEN repeat_mode = 'once' THEN 'completed' ELSE 'active' END,
        next_run_at = CASE WHEN repeat_mode = 'once' THEN NULL ELSE p_next_run_at END,
        occurrence_count = occurrence_count + 1,
        attempt_count = 0,
        lease_until = NULL,
        last_sent_at = clock_timestamp(),
        last_error = NULL,
        updated_at = clock_timestamp()
    WHERE id = p_schedule_id;
  ELSE
    UPDATE public.telegram_message_schedules
    SET status = CASE WHEN attempt_count >= 5 THEN 'failed' ELSE 'active' END,
        next_run_at = CASE
          WHEN attempt_count >= 5 THEN NULL
          ELSE clock_timestamp() + (LEAST(POWER(2, attempt_count), 30)::INTEGER * INTERVAL '1 minute')
        END,
        lease_until = NULL,
        last_error = LEFT(COALESCE(p_error, 'Telegram delivery failed.'), 1000),
        updated_at = clock_timestamp()
    WHERE id = p_schedule_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_telegram_message_schedules(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_telegram_message_schedule(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_telegram_message_schedules(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_telegram_message_schedule(UUID, BOOLEAN, TEXT, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
