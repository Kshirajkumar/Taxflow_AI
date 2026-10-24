-- Run after schema.sql and create_taxflow_storage_bucket.sql.
-- Portal clients authenticate separately from staff and can only upload documents.

CREATE TABLE IF NOT EXISTS public.client_portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email TEXT,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  invitation_pending BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.client_portal_access
  ADD COLUMN IF NOT EXISTS invited_email TEXT,
  ADD COLUMN IF NOT EXISTS invitation_pending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.client_portal_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_portal_access FROM anon, authenticated;
GRANT ALL ON public.client_portal_access TO service_role;
DROP POLICY IF EXISTS client_portal_access_service_role ON public.client_portal_access;
CREATE POLICY client_portal_access_service_role ON public.client_portal_access
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.documents_metadata
  ALTER COLUMN vault_path DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

CREATE INDEX IF NOT EXISTS documents_metadata_portal_client_created_idx
  ON public.documents_metadata(client_id, created_at DESC)
  WHERE source = 'Portal';

CREATE TABLE IF NOT EXISTS public.document_sync_receipts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents_metadata(id) ON DELETE CASCADE,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id, document_id)
);

ALTER TABLE public.document_sync_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_sync_receipts FROM anon, authenticated;
GRANT ALL ON public.document_sync_receipts TO service_role;
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
    AND d.source = 'Portal'
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

REVOKE ALL ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER)
  TO service_role;

NOTIFY pgrst, 'reload schema';
