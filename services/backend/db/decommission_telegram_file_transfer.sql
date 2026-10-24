-- Separates Telegram text history from client-portal document storage.
-- Historical rows remain in place; Telegram attachment metadata is scrubbed
-- before the deprecated columns and document/message link are removed.

BEGIN;

DROP INDEX IF EXISTS public.telegram_messages_attachment_download_queue_idx;
DROP INDEX IF EXISTS public.documents_metadata_telegram_message_id_unique;

DO $$
DECLARE
  media_filter TEXT := 'm.message_type IN (''image'', ''document'', ''audio'', ''photo'', ''video'', ''voice'', ''animation'', ''sticker'', ''unsupported'')';
  message_media_filter TEXT := 'message_type IN (''image'', ''document'', ''audio'', ''photo'', ''video'', ''voice'', ''animation'', ''sticker'', ''unsupported'')';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'telegram_messages' AND column_name = 'telegram_file_id'
  ) THEN
    media_filter := media_filter || ' OR m.telegram_file_id IS NOT NULL';
    message_media_filter := message_media_filter || ' OR telegram_file_id IS NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'telegram_messages' AND column_name = 'telegram_file_name'
  ) THEN
    media_filter := media_filter || ' OR m.telegram_file_name IS NOT NULL';
    message_media_filter := message_media_filter || ' OR telegram_file_name IS NOT NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'telegram_messages' AND column_name = 'vault_file_ref'
  ) THEN
    media_filter := media_filter || ' OR m.vault_file_ref IS NOT NULL';
    message_media_filter := message_media_filter || ' OR vault_file_ref IS NOT NULL';
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'metadata'
    )
  THEN
    EXECUTE format(
      'UPDATE public.notifications n
       SET message = %L
       FROM public.telegram_messages m
       WHERE n.event_type = %L
         AND n.metadata ->> %L = m.id::text
         AND (%s)',
      'Telegram file transfer is disabled. Use the secure client portal for documents.',
      'telegram.message_received',
      'message_id',
      media_filter
    );
  END IF;

  EXECUTE format(
    'UPDATE public.telegram_messages
     SET body = %L, message_type = %L
     WHERE (%s)',
    'Telegram file transfer is disabled. Use the secure client portal for documents.',
    'text',
    message_media_filter
  );
END;
$$;

ALTER TABLE public.telegram_messages
  DROP CONSTRAINT IF EXISTS telegram_messages_attachment_download_status_check,
  DROP COLUMN IF EXISTS telegram_file_id,
  DROP COLUMN IF EXISTS telegram_file_name,
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS vault_file_ref,
  DROP COLUMN IF EXISTS file_download_error,
  DROP COLUMN IF EXISTS attachment_download_status,
  DROP COLUMN IF EXISTS attachment_download_attempts,
  DROP COLUMN IF EXISTS attachment_download_next_attempt_at,
  DROP COLUMN IF EXISTS attachment_download_started_at;

ALTER TABLE public.documents_metadata
  DROP COLUMN IF EXISTS telegram_message_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
