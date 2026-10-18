-- Repair Telegram attachment writes for the trusted backend only.
-- Run in the Supabase project configured by the backend, then redeploy/restart
-- the backend with that project's SUPABASE_SERVICE_ROLE_KEY. Never expose this
-- key to the desktop app.

BEGIN;

-- Keep the intake bucket private and aligned with the backend's file-size limit.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('taxflow-intake', 'taxflow-intake', FALSE, 20971520)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

GRANT USAGE ON SCHEMA storage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "TaxFlow service role manages intake" ON storage.objects;
CREATE POLICY "TaxFlow service role manages intake"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'taxflow-intake')
  WITH CHECK (bucket_id = 'taxflow-intake');

-- The backend links the private object to a client-owned metadata record.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents_metadata TO service_role;
ALTER TABLE public.documents_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_metadata_service_role ON public.documents_metadata;
CREATE POLICY documents_metadata_service_role
  ON public.documents_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Notify PostgREST so the backend sees the updated database objects/policies.
NOTIFY pgrst, 'reload schema';

COMMIT;
