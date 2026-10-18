-- Run after telegram.sql and the documents_metadata table have been created.
-- Telegram file bytes remain in the configured Local Vault; these columns link
-- Telegram messages to the document metadata needed by the authenticated UI.

ALTER TABLE public.telegram_messages
  ADD COLUMN IF NOT EXISTS telegram_file_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS vault_file_ref UUID,
  ADD COLUMN IF NOT EXISTS file_download_error TEXT,
  ADD COLUMN IF NOT EXISTS attachment_download_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attachment_download_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attachment_download_next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS attachment_download_started_at TIMESTAMPTZ;

ALTER TABLE public.telegram_messages
  DROP CONSTRAINT IF EXISTS telegram_messages_attachment_download_status_check;
ALTER TABLE public.telegram_messages
  ADD CONSTRAINT telegram_messages_attachment_download_status_check
  CHECK (attachment_download_status IN ('pending', 'downloading', 'failed', 'saved'));

UPDATE public.telegram_messages
SET attachment_download_status = CASE
  WHEN vault_file_ref IS NOT NULL THEN 'saved'
  WHEN file_download_error IS NOT NULL THEN 'failed'
  ELSE 'pending'
END
WHERE telegram_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS telegram_messages_attachment_download_queue_idx
  ON public.telegram_messages(attachment_download_next_attempt_at, created_at)
  WHERE direction = 'inbound' AND telegram_file_id IS NOT NULL AND vault_file_ref IS NULL
    AND attachment_download_status = 'pending';

ALTER TABLE public.documents_metadata
  ADD COLUMN IF NOT EXISTS telegram_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS documents_metadata_telegram_message_id_unique
  ON public.documents_metadata(telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_source_check;
ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_source_check
  CHECK (source IN ('WhatsApp', 'Telegram', 'Manual', 'Portal', 'Upload'));

ALTER TABLE public.documents_metadata
  DROP CONSTRAINT IF EXISTS documents_metadata_file_type_check;
ALTER TABLE public.documents_metadata
  ADD CONSTRAINT documents_metadata_file_type_check
  CHECK (file_type IN ('PDF', 'PNG', 'JPG', 'JPEG', 'WEBP', 'XLS', 'XLSX', 'CSV', 'DOC', 'DOCX', 'OTHER'));

NOTIFY pgrst, 'reload schema';
