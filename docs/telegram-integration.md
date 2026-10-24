# Telegram messaging integration

Telegram is a text-only communication and client-connection channel. It does not accept, download, send, store, or sync client documents. Clients use the secure client portal for document uploads; staff use the portal and the existing TaxFlow document workflows.

## Production setup

Configure the bot token, username, webhook secret, and relay settings as server-only environment variables. Keep `TELEGRAM_WEBHOOK_AUTO_CONFIGURE=false` on the TaxFlow backend when using the separate Telegram relay service. The relay service alone registers the Telegram webhook and forwards verified updates to the TaxFlow backend over HTTPS. Configure `CLIENT_PORTAL_URL` to the deployed portal's HTTPS origin. Do not expose Supabase service credentials to the desktop or client portal.

Apply the backend database migrations before deploying code that depends on the Telegram messaging and portal schema. From the backend directory, run `npm run migrate:telegram` with a valid `DATABASE_URL` for the intended Supabase project. Alternatively, run the SQL migration files listed in `BACKEND_GUIDE.md` in order. The final `decommission_telegram_file_transfer.sql` migration sanitizes legacy message previews and removes Telegram attachment fields/document links. It preserves historical document metadata and Storage objects; it does not erase files.

Keep the private `taxflow-intake` bucket available to the backend service role for client-portal document storage. Never grant public or direct `anon`/`authenticated` access to this bucket, and never commit database passwords, bot tokens, or service-role keys.

## Message and file flow

1. Staff use **Connect client** to create a one-time Telegram start link. The backend stores the hashed Telegram connection token and returns the start link for the CA to share directly with the client.
2. The client opens the Telegram start link in a private chat. After validating and recording the Telegram account connection, TaxFlow creates a client-specific portal invitation in Supabase, stores its token hash, and sends two separate messages in order: a text-only welcome/privacy message, then the secure client-portal invitation link with enrollment instructions. The invitation is tied to the client's email and is not created until the client has connected.
3. Telegram sends updates to the standalone relay service. The relay verifies the webhook secret and forwards updates to TaxFlow over HTTPS. It acknowledges Telegram only after a successful backend response; transient failures return HTTP 503 so Telegram can retry. TaxFlow deduplicates retried update IDs.
4. TaxFlow persists and processes text messages only. Media updates are acknowledged and discarded without downloading, storing, replying with an upload link, or accessing document tables.
5. Clients upload documents through the secure client portal. Portal documents are stored in private Supabase Storage and can be synced to an authorized desktop local vault.

The authenticated Telegram status endpoint checks the webhook and required messaging/link schema. Portal configuration and document upload readiness are handled separately. Persistent setup warnings remain visible until the underlying configuration or database issue is corrected; short-lived local sync notices dismiss automatically.

## Legacy data and migration

Deploy the backend version that no longer references Telegram attachment fields before applying the cleanup migration. To perform the complete schema migration, run `npm run migrate:telegram` from `services/backend`; the migration runner executes the legacy-data sanitization and schema cleanup last. Do not manually delete rows from `storage.objects` or historical document metadata as part of this separation. If permanently erasing old Telegram-uploaded files is ever required, handle it as a separately authorized Storage cleanup with a verified object inventory and retention approval.
