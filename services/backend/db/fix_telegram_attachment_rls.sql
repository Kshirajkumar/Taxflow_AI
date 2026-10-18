-- Repair Telegram attachment writes for the trusted backend only.
-- The backend must use SUPABASE_SERVICE_ROLE_KEY; never use this key in the desktop app.

BEGIN;

-- Inbound Telegram bytes are stored in the private intake bucket by the backend.
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE storage.objects TO service_role;

DROP POLICY IF EXISTS "TaxFlow service role manages intake" ON storage.objects;
CREATE POLICY "TaxFlow service role manages intake"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'taxflow-intake')
  WITH CHECK (bucket_id = 'taxflow-intake');

-- The backend links the private object to a client-owned metadata record.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents_metadata TO service_role;

DROP POLICY IF EXISTS documents_metadata_service_role ON public.documents_metadata;
CREATE POLICY documents_metadata_service_role
  ON public.documents_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
