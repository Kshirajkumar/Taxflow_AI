-- Run after telegram.sql and the documents_metadata table have been created.
-- Telegram file bytes remain in the configured Local Vault; these columns link
-- Telegram messages to the document metadata needed by the authenticated UI.

ALTER TABLE public.telegram_messages
  ADD COLUMN IF NOT EXISTS telegram_file_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_file_name TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS vault_file_ref UUID,
  ADD COLUMN IF NOT EXISTS file_download_error TEXT;

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

NOTIFY pgrst, 'reload schema';
