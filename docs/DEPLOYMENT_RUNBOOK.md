# Taxflow.AI Deployment Runbook

## Current state
The repository describes a desktop application with a local Express API, Supabase metadata, and local document vault. Exact release packaging, signing, updater strategy, network binding, backup destination, and monitoring are not verified.

## Configuration
Use a local untracked `.env` for backend configuration. The backend example file documents required configuration, including Supabase and provider variables. Do not commit live credentials. Verify every variable against `services/backend/.env.example` before a release. Never expose `SUPABASE_SERVICE_ROLE_KEY`, Gemini keys, or WhatsApp tokens to the frontend.

## Pre-release
1. Confirm the release commit and inspect the diff.
2. Install dependencies from lockfiles in a clean environment.
3. Run backend tests, desktop TypeScript/build checks, and dependency/secret scans.
4. Apply schema changes only to a disposable database first; review SQL and capture a verified backup before any production migration.
5. Confirm the vault path is on a protected, non-synced disk with least-privilege filesystem ACLs.
6. Confirm webhook signature verification, origin policy, body limits, and production mode behavior.
7. Exercise sign-in, client CRUD, upload/serve, extraction, deadline, generation, and webhook flows in staging.
8. Verify monitoring, backup restore, and rollback steps before rollout.

## Known repository commands
- Desktop build: `cd apps/desktop && npm ci && npm run build`
- Backend start: `cd services/backend && npm ci && npm start`
- Backend tests: `cd services/backend && npm test` (currently a placeholder that fails).

## Rollback
- Stop or roll back the desktop/backend release using the chosen release mechanism.
- Do not automatically reverse database migrations that may have changed or deleted data. Prefer backward-compatible expand/migrate/contract changes and forward fixes where necessary.
- Restore metadata and vault files only from a backup whose restore procedure has been tested.
- Reconcile document metadata and physical files after rollback.
- Verify login, client access, document retrieval, and critical API health before reopening access.

## Incident handling
Record incident time, affected release, request/correlation IDs, scope, data-integrity status, mitigation, and recovery evidence. Do not place tokens, raw client documents, PAN/GSTIN, or sensitive message bodies in incident logs.
