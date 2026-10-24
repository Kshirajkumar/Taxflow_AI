-- Repairs the backend RPC used to list Telegram files awaiting local sync.
-- Run after telegram.sql and telegram_document_storage.sql.

BEGIN;

ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
  ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT;

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

REVOKE ALL ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_pending_document_sync(UUID, UUID, INTEGER)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
