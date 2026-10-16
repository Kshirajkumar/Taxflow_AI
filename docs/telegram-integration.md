# Telegram intake integration

Taxflow receives Telegram documents through the verified bot webhook. Telegram is an inbound collection channel; outbound messages are intentionally separate and require an approval workflow.

## Production configuration

Set these server-only environment variables:

```text
TELEGRAM_BOT_TOKEN=<BotFather token>
TELEGRAM_WEBHOOK_SECRET=<random high-entropy secret>

For a hosted deployment, configure Supabase Storage as the encrypted object store:

```text
SUPABASE_URL=<Supabase project URL>
SUPABASE_SERVICE_ROLE_KEY=<server-only service-role key>
SUPABASE_STORAGE_BUCKET=taxflow-intake
```

Apply `services/backend/db/create_taxflow_storage_bucket.sql` and
`services/backend/db/add_telegram_client_identity.sql` before starting the
service. Add the client's Telegram username or numeric Telegram user ID to
`public.clients`. The relay will also accept an explicit caption such as
`client=sharma September 2026`; unresolved or ambiguous routing remains in
quarantine.
```

Register the webhook over HTTPS with the Telegram Bot API. Keep the secret out of source control and logs:

```powershell
curl.exe -X POST "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/setWebhook" `
  -H "content-type: application/json" `
  -d (@{ url = 'https://api.example.com/api/v1/integrations/telegram/webhook'; secret_token = $env:TELEGRAM_WEBHOOK_SECRET; allowed_updates = @('message','edited_message','channel_post') } | ConvertTo-Json -Compress)
```

The relay validates `X-Telegram-Bot-Api-Secret-Token`, downloads document/photo bytes through the Bot API, encrypts the relay spool, computes SHA-256, applies deterministic client/period routing, and quarantines unresolved metadata. Telegram `update_id` values provide idempotency; duplicate updates do not create duplicate documents.

The server must run behind TLS, enforce request-size limits, keep the bot token and Supabase service-role key server-side, and expose health/metrics without exposing message contents or credentials. When Supabase Storage is configured, spool and published files are encrypted before upload, so a free host's ephemeral local filesystem is not the source of truth.
