# Telegram intake integration

TaxFlow receives client documents through a verified Telegram webhook and private Supabase Storage. The recommended Render topology uses the separate Telegram Bot service as the sole webhook owner and synchronously relays verified updates to the TaxFlow backend. Outbound messages and file attachments require explicit CA approval.

## Production setup

Configure these server-only variables on the backend:

```text
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_BOT_USERNAME=<bot username without @>
TELEGRAM_WEBHOOK_SECRET=<high-entropy secret>
TELEGRAM_WEBHOOK_AUTO_CONFIGURE=false
TELEGRAM_WEBHOOK_RELAY_URL=https://<telegram-relay-host>/telegram/webhook
SUPABASE_URL=<Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SUPABASE_STORAGE_BUCKET=taxflow-intake
```

On the separate Telegram Bot Render service, set `TELEGRAM_BOT_TOKEN`, `TAXFLOW_TELEGRAM_WEBHOOK_URL=https://<taxflow-backend-host>/api/v1/telegram/webhook`, and `TELEGRAM_WEBHOOK_SECRET`. On the TaxFlow backend, use the same bot token and exact webhook secret, set `TELEGRAM_WEBHOOK_AUTO_CONFIGURE=false`, and set `TELEGRAM_WEBHOOK_RELAY_URL` to the bot service's HTTPS `/telegram/webhook` URL. The bot service alone registers the webhook with Telegram; never enable webhook auto-configuration on both services because Telegram permits only one active webhook per bot. Keep Supabase service credentials and the Storage bucket configuration on TaxFlow only.

Ensure `clients`, `user_profiles`, and `documents_metadata` exist. Run `npm run migrate:telegram` from `services/backend` with `DATABASE_URL` set, or apply these files in order in the Supabase SQL Editor:

1. `services/backend/db/telegram.sql`
2. `services/backend/db/telegram_document_storage.sql`
3. `services/backend/db/create_taxflow_storage_bucket.sql`

The Storage migration creates the private `taxflow-intake` bucket, restricts direct `anon`/`authenticated` object access, adds object/checksum metadata and per-device sync receipts, and replaces old machine-specific vault paths in cloud profiles. Do not expose the service-role key or make the bucket public.

## Message and file flow

1. A client links a private Telegram chat to a TaxFlow client record. Incoming messages are matched by the linked chat; unlinked chats and group messages are ignored.
2. Telegram sends updates to the standalone bot service. It checks Telegram's webhook secret and forwards the original update to TaxFlow over HTTPS with the shared secret. It only acknowledges Telegram after TaxFlow responds successfully; relay failures return HTTP 503 so Telegram can retry. TaxFlow deduplicates retried update IDs.
3. The TaxFlow webhook persists the inbound Telegram message and starts downloading supported media immediately.
4. In production, the backend downloads the bytes from Telegram and uploads them directly to private Supabase Storage. It does not rely on Render's ephemeral filesystem for these Telegram originals. Metadata records the object key and SHA-256 checksum.
5. The signed-in desktop app polls for pending Telegram documents, downloads each through the authenticated API, verifies its checksum, and atomically saves it under `<selected vault>\clients\<client>\<year>\<month>\Raw`.
6. After a successful local write, the desktop records a per-device sync receipt. The private cloud object is intentionally retained for recovery and syncing another authorized device; sync is not a move operation.

The desktop app retries unsynced documents on its next polling cycle. If no storage bucket is configured in production, attachment processing reports an error instead of treating the Render disk as durable storage. In development, without a bucket configured, the existing backend-local vault behavior remains available.

The authenticated Telegram status endpoint checks the active webhook URL, pending Telegram updates, database migration columns, and Storage bucket availability. The desktop Telegram panel displays warnings when those backend settings do not agree.

## Webhook and operations

The bot service registers Telegram's webhook over HTTPS at its own `/telegram/webhook` endpoint. Keep the webhook secret and bot token out of source control and logs. Both services validate the `X-Telegram-Bot-Api-Secret-Token` header; TaxFlow deduplicates updates, enforces Telegram's 20 MiB inbound download limit, and exposes failed attachments for retry in the inbox.

Outbound text and file attachments are staged for CA review before the UI submits the explicit approval. The TaxFlow backend streams a selected local file to Telegram as a photo when it is a JPEG/PNG up to 9 MiB; other supported attachments are sent as documents. The app limits outbound files to 25 MiB. The backend records the approval and Telegram delivery status in the existing `telegram_messages` table. Delivery failures should be checked in the conversation before retrying because a network interruption can make the remote delivery outcome uncertain.

No additional SQL migration is required for the relay or outbound file route; the existing Telegram message and document-storage schema is used.

The Telegram source object is durable cloud storage; the desktop folder is a local working copy. Back up the desktop vault separately, and use an explicit retention/deletion policy if cloud copies should ever be removed. A desktop configured in browser-only mode cannot write to a local folder; local sync requires the installed Tauri app.
