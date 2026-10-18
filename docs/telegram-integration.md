# Telegram intake integration

TaxFlow receives client documents through a verified Telegram bot webhook. Telegram is an inbound collection channel; outbound messages remain separate and require an approval workflow.

## Production setup

Configure these server-only variables on the backend:

```text
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_BOT_USERNAME=<bot username without @>
TELEGRAM_WEBHOOK_SECRET=<high-entropy secret>
TELEGRAM_WEBHOOK_AUTO_CONFIGURE=true
SUPABASE_URL=<Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SUPABASE_STORAGE_BUCKET=taxflow-intake
PUBLIC_URL=https://<public-backend-host>
```

Set `TELEGRAM_WEBHOOK_AUTO_CONFIGURE=true` on exactly one Render service for each bot. Leave it unset or set it to `false` on any other service that shares the same bot token: Telegram allows only one active webhook per bot, and a second service can otherwise replace the first service's webhook at startup. `PUBLIC_URL` must be the public HTTPS base URL of the one service that owns the webhook.

Ensure `clients`, `user_profiles`, and `documents_metadata` exist. Run `npm run migrate:telegram` from `services/backend` with `DATABASE_URL` set, or apply these files in order in the Supabase SQL Editor:

1. `services/backend/db/telegram.sql`
2. `services/backend/db/telegram_document_storage.sql`
3. `services/backend/db/create_taxflow_storage_bucket.sql`

The Storage migration creates the private `taxflow-intake` bucket, restricts direct `anon`/`authenticated` object access, adds object/checksum metadata and per-device sync receipts, and replaces old machine-specific vault paths in cloud profiles. Do not expose the service-role key or make the bucket public.

## Message and file flow

1. A client links a private Telegram chat to a TaxFlow client record. Incoming messages are matched by the linked chat; unlinked chats and group messages are ignored.
2. The webhook persists the inbound Telegram message and queues supported media immediately.
3. In production, the backend downloads the bytes from Telegram and uploads them directly to private Supabase Storage. It does not rely on Render's ephemeral filesystem for these Telegram originals. Metadata records the object key and SHA-256 checksum.
4. The signed-in desktop app polls for pending Telegram documents, downloads each through the authenticated API, verifies its checksum, and atomically saves it under `<selected vault>\clients\<client>\<year>\<month>\Raw`.
5. After a successful local write, the desktop records a per-device sync receipt. The private cloud object is intentionally retained for recovery and syncing another authorized device; sync is not a move operation.

The desktop app retries unsynced documents on its next polling cycle. If no storage bucket is configured in production, attachment processing reports an error instead of treating the Render disk as durable storage. In development, without a bucket configured, the existing backend-local vault behavior remains available.

The authenticated Telegram status endpoint checks the active webhook URL, pending Telegram updates, database migration columns, and Storage bucket availability. The desktop Telegram panel displays warnings when those backend settings do not agree.

## Webhook and operations

Register the configured webhook over HTTPS at `/api/v1/telegram/webhook`. Keep the webhook secret and bot token out of source control and logs. The backend verifies Telegram's `X-Telegram-Bot-Api-Secret-Token` header, deduplicates updates, enforces the Telegram download size limit, and exposes failed attachments for retry in the inbox.

The Telegram source object is durable cloud storage; the desktop folder is a local working copy. Back up the desktop vault separately, and use an explicit retention/deletion policy if cloud copies should ever be removed. A desktop configured in browser-only mode cannot write to a local folder; local sync requires the installed Tauri app.
