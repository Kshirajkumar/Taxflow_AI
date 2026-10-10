-- TaxFlow.AI: server-side integration secret registry
--
-- IMPORTANT:
--   Do not store raw API keys in this table.
--   Store the actual value in Supabase Vault and save only the Vault UUID here.
--   The backend is the only component that should read this table.
--
-- Before using this migration, enable the Supabase Vault extension from:
-- Database -> Extensions -> Vault

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            VARCHAR(40) NOT NULL
                      CHECK (provider IN ('gemini', 'vision', 'chat', 'whatsapp', 'other')),
  secret_name         VARCHAR(120) NOT NULL,
  vault_secret_id     UUID NOT NULL,
  description         TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, provider, secret_name)
);

CREATE INDEX IF NOT EXISTS idx_integration_secrets_owner
  ON public.integration_secrets(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_integration_secrets_provider
  ON public.integration_secrets(owner_user_id, provider);

-- Defense in depth: even authenticated browser users receive no table access.
-- The Node/Express backend uses the Supabase server secret and bypasses RLS.
ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integration_secrets FROM anon, authenticated;

DROP POLICY IF EXISTS "No browser access to integration secrets"
  ON public.integration_secrets;

-- No SELECT/INSERT/UPDATE/DELETE policies are intentionally created.
-- Backend-only access is enforced by the revoked grants plus server-side auth.

DROP TRIGGER IF EXISTS trg_integration_secrets_updated_at
  ON public.integration_secrets;

CREATE OR REPLACE FUNCTION public.update_integration_secrets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_integration_secrets_updated_at
  BEFORE UPDATE ON public.integration_secrets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_integration_secrets_updated_at();

NOTIFY pgrst, 'reload schema';
