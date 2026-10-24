-- Private object storage for client-portal uploads.
-- Telegram attachments are directed to the portal instead of being stored from chat.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('taxflow-intake', 'taxflow-intake', FALSE, 20971520)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents_metadata TO service_role;
ALTER TABLE public.documents_metadata ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_metadata_service_role ON public.documents_metadata;
CREATE POLICY documents_metadata_service_role
  ON public.documents_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS documents_metadata_pending_local_sync_idx
  ON public.documents_metadata(created_at, id)
  WHERE source = 'Telegram' AND storage_object_path IS NOT NULL AND file_sha256 IS NOT NULL;

UPDATE public.user_profiles
SET vault_path = 'desktop-local'
WHERE vault_path IS NOT NULL AND vault_path <> 'desktop-local';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'vault_folder'
  ) THEN
    UPDATE public.clients SET vault_folder = NULL WHERE vault_folder IS NOT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.document_sync_receipts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id, document_id)
);

ALTER TABLE public.document_sync_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS document_sync_receipts_document_idx
  ON public.document_sync_receipts(document_id);

DROP FUNCTION IF EXISTS public.list_pending_document_sync(UUID, UUID, INTEGER);

CREATE FUNCTION public.list_pending_document_sync(
  p_user_id UUID,
  p_device_id UUID,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  document_id UUID,
  client_name TEXT,
  file_name TEXT,
  file_sha256 TEXT,
  created_at TIMESTAMPTZ,
  source TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id,
         COALESCE(d.client_name, c.name)::TEXT,
         d.file_name::TEXT,
         d.file_sha256::TEXT,
         d.created_at,
         d.source::TEXT
  FROM public.documents_metadata d
  JOIN public.clients c ON c.id = d.client_id
  WHERE c.user_id = p_user_id
    AND d.source IN ('Telegram', 'Portal')
    AND d.storage_object_path IS NOT NULL
    AND d.file_sha256 IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.document_sync_receipts r
      WHERE r.user_id = p_user_id
        AND r.device_id = p_device_id
        AND r.document_id = d.id
        AND r.file_sha256 = d.file_sha256
    )
  ORDER BY d.created_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
