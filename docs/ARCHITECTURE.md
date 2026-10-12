# Taxflow.AI Architecture

## Current system map

- `apps/desktop/`: Tauri v2 shell; React 18, TypeScript, Vite UI.
- `services/backend/index.js`: Express API entry point, middleware setup, route mounting, health endpoint, 404/error handlers, and listener.
- `services/backend/routes/`: domain route modules for auth, clients, documents, extraction, WhatsApp, deadlines, generation, metadata, and notifications.
- `services/backend/middleware/requireAuth.js`: validates bearer tokens through Supabase Auth and attaches the user to the request.
- `services/backend/db/supabase.js`: server-side Supabase client, configured with a service-role key.
- `services/backend/vault/vaultManager.js`: local filesystem document vault.
- `services/backend/db/schema.sql`: Supabase/PostgreSQL schema and policies.
- External providers: Google Gemini and WhatsApp Cloud API.

## Data flow

1. Desktop UI sends HTTP requests to the local Express API.
2. Private routes validate the Supabase access token.
3. Route modules perform business logic and query Supabase metadata and/or the local vault.
4. AI and messaging routes interact with external providers.
5. API responses are rendered in the desktop UI.

## Trust boundaries

- Desktop UI is untrusted input even when it is a local desktop app.
- Bearer tokens must be validated on the server; client-side route hiding is not authorization.
- The service-role database client can bypass RLS; every request using it must enforce tenant ownership explicitly.
- Local file paths and filenames are untrusted inputs; file access must remain inside the configured vault and require authorization to the parent client.
- Webhook requests are untrusted until signature verification succeeds.
- AI-generated extraction and text are untrusted outputs and require validation/review before being used as authoritative tax data.
- Secrets must remain server-side and must never be returned in health responses or logs.

## Architectural guidance

Keep the current modular monolith unless measurements justify additional infrastructure. Separate transport validation, domain logic, data access, and provider adapters incrementally where this improves testability. Use durable queues only when required for reliable asynchronous webhook/AI work. Preserve local document storage only with explicit backup, encryption-at-rest, access-control, and recovery plans.

## Current limitations

This map is based on source inspection. Actual production topology, network binding, desktop origin behavior, provider credentials, deployed schema, backups, and monitoring configuration remain unverified.
