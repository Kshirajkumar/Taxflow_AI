-- TaxFlow.AI production RLS migration
-- Run in Supabase SQL Editor after the application tables exist.
-- The Express backend uses service_role for trusted server work. Browser roles
-- are restricted by these policies and never receive secret-table access.

-- Bootstrap missing application relations so this migration is safe on a partially
-- initialized Supabase project. Existing tables and data are preserved.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(255),
  firm_name VARCHAR(255),
  practice_type VARCHAR(100),
  membership_no VARCHAR(100),
  role VARCHAR(100) NOT NULL DEFAULT 'Managing Partner',
  vault_path TEXT,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'Individual',
  pan VARCHAR(10), gstin VARCHAR(15), phone VARCHAR(20), email VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'Active',
  assigned_ca VARCHAR(255), filing_status VARCHAR(100),
  filing_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  vault_folder TEXT, total_docs INT DEFAULT 0, total_ai_calls INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS country_id UUID;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS filing_type VARCHAR(100);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gstin_registered BOOLEAN;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS public.documents_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name VARCHAR(255), file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(30) NOT NULL, file_size_kb NUMERIC(10,2),
  category VARCHAR(50) NOT NULL DEFAULT 'General',
  source VARCHAR(20) DEFAULT 'Manual', status VARCHAR(30) DEFAULT 'Pending',
  vault_path TEXT NOT NULL, assessment_year VARCHAR(10) DEFAULT '2026-27',
  confidence_score NUMERIC(5,2), extracted_data JSONB,
  verified_by VARCHAR(255), verified_at TIMESTAMPTZ,
  whatsapp_message_id UUID, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.compliance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name VARCHAR(255), form_type VARCHAR(50) NOT NULL,
  due_date DATE NOT NULL, status VARCHAR(30) DEFAULT 'Pending',
  progress INT DEFAULT 0, assigned_to VARCHAR(255), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_phone VARCHAR(20) NOT NULL, sender_name VARCHAR(255),
  direction VARCHAR(10) NOT NULL, message_type VARCHAR(20) DEFAULT 'text',
  body TEXT, media_mime_type VARCHAR(100),
  vault_file_ref UUID REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  wa_message_id VARCHAR(255), status VARCHAR(30) DEFAULT 'received',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.extracted_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL, field_value TEXT,
  confidence NUMERIC(5,2), is_verified BOOLEAN DEFAULT FALSE,
  correction TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.documents_metadata(id) ON DELETE SET NULL,
  operation VARCHAR(50) NOT NULL, model_used VARCHAR(100) DEFAULT 'gemini-1.5-flash',
  input_tokens INT DEFAULT 0, output_tokens INT DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0, duration_ms INT,
  success BOOLEAN DEFAULT TRUE, error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL, entity_type VARCHAR(50), entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL, secret_name VARCHAR(120) NOT NULL,
  vault_secret_id UUID NOT NULL, description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_name VARCHAR(120),
  UNIQUE (owner_user_id, provider, secret_name)
);
ALTER TABLE public.integration_secrets ADD COLUMN IF NOT EXISTS model_name VARCHAR(120);

CREATE TABLE IF NOT EXISTS public.supported_countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code VARCHAR(10) NOT NULL UNIQUE, country_name VARCHAR(120) NOT NULL,
  tax_authority_name TEXT, portal_name TEXT, portal_url TEXT,
  currency_code VARCHAR(10) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.filing_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES public.supported_countries(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL, name VARCHAR(200) NOT NULL, description TEXT,
  filing_category VARCHAR(100), filing_frequency VARCHAR(100),
  output_format VARCHAR(50), accepted_file_types TEXT[],
  government_portal_name TEXT, government_portal_url TEXT,
  specification_version TEXT, specification_url TEXT,
  format_definition JSONB, validation_rules JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

BEGIN;

-- Required privileges for direct authenticated catalog reads and backend writes.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

-- User profile: one row per authenticated account.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
CREATE POLICY user_profiles_select_own ON public.user_profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
REVOKE ALL ON public.user_profiles FROM anon;
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO service_role;

-- Client registry: the ownership root for all client-linked records.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clients_select_own ON public.clients;
CREATE POLICY clients_select_own ON public.clients FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS clients_insert_own ON public.clients;
CREATE POLICY clients_insert_own ON public.clients FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS clients_update_own ON public.clients;
CREATE POLICY clients_update_own ON public.clients FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS clients_delete_own ON public.clients;
CREATE POLICY clients_delete_own ON public.clients FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.clients FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO service_role;

-- Client-owned records. NULL client_id is intentionally inaccessible to browser roles.
ALTER TABLE public.documents_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents_metadata FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_select_own ON public.documents_metadata;
CREATE POLICY documents_select_own ON public.documents_metadata FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS documents_insert_own ON public.documents_metadata;
CREATE POLICY documents_insert_own ON public.documents_metadata FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS documents_update_own ON public.documents_metadata;
CREATE POLICY documents_update_own ON public.documents_metadata FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS documents_delete_own ON public.documents_metadata;
CREATE POLICY documents_delete_own ON public.documents_metadata FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.documents_metadata FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents_metadata TO authenticated, service_role;

ALTER TABLE public.compliance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compliance_select_own ON public.compliance_tasks;
CREATE POLICY compliance_select_own ON public.compliance_tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS compliance_insert_own ON public.compliance_tasks;
CREATE POLICY compliance_insert_own ON public.compliance_tasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS compliance_update_own ON public.compliance_tasks;
CREATE POLICY compliance_update_own ON public.compliance_tasks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS compliance_delete_own ON public.compliance_tasks;
CREATE POLICY compliance_delete_own ON public.compliance_tasks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.compliance_tasks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_tasks TO authenticated, service_role;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_select_own ON public.whatsapp_messages;
CREATE POLICY whatsapp_select_own ON public.whatsapp_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS whatsapp_update_own ON public.whatsapp_messages;
CREATE POLICY whatsapp_update_own ON public.whatsapp_messages FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.whatsapp_messages FROM anon;
GRANT SELECT, UPDATE ON public.whatsapp_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.whatsapp_messages TO service_role;

ALTER TABLE public.extracted_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_fields FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extracted_fields_select_own ON public.extracted_fields;
CREATE POLICY extracted_fields_select_own ON public.extracted_fields FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS extracted_fields_update_own ON public.extracted_fields;
CREATE POLICY extracted_fields_update_own ON public.extracted_fields FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.user_id = (SELECT auth.uid())));
REVOKE ALL ON public.extracted_fields FROM anon;
GRANT SELECT, UPDATE ON public.extracted_fields TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.extracted_fields TO service_role;

-- AI telemetry and integration metadata are backend-only. RLS is enabled with
-- no authenticated policies, so accidental browser queries return zero rows.
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_usage_log TO service_role;

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_secrets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.integration_secrets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_secrets TO service_role;

-- Notifications are user-owned and server-triggered.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE ALL ON public.notifications FROM anon;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;

-- Reference data is readable but not writable by application users.
ALTER TABLE public.supported_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supported_countries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supported_countries_read_active ON public.supported_countries;
CREATE POLICY supported_countries_read_active ON public.supported_countries FOR SELECT TO authenticated
  USING (is_active = true);
REVOKE ALL ON public.supported_countries FROM anon;
GRANT SELECT ON public.supported_countries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supported_countries TO service_role;

ALTER TABLE public.filing_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filing_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS filing_types_read_active ON public.filing_types;
CREATE POLICY filing_types_read_active ON public.filing_types FOR SELECT TO authenticated
  USING (is_active = true);
REVOKE ALL ON public.filing_types FROM anon;
GRANT SELECT ON public.filing_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.filing_types TO service_role;

-- Vault RPC remains backend-only. The function is optional until the Vault
-- reader migration is installed, so do not abort this RLS migration if it is
-- not present yet.
DO $$
BEGIN
  IF to_regprocedure('public.get_vault_secret(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_vault_secret(UUID) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_vault_secret(UUID) TO service_role';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
