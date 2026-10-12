# Taxflow.AI Production Audit

**Review date:** 2026-10-12  
**Scope:** GitHub source inspection of the default branch. No local execution, staging credentials, production telemetry, or live integration tests were available during this review.  
**Status:** Initial audit; findings are evidence-led but not a penetration test.

## Architecture and feature inventory

Taxflow.AI is a monorepo with a Tauri v2 desktop shell and React/TypeScript/Vite frontend under `apps/desktop`, plus a Node.js/Express API under `services/backend`. The API uses Supabase/PostgreSQL for metadata and a local filesystem vault for document binaries. External integrations include Google Gemini and WhatsApp Cloud API.

Backend route modules present: authentication, clients, documents, extraction, WhatsApp, deadlines, generation, metadata, and notifications. The desktop package's build command is `tsc -b && vite build`. The backend package has start/dev commands, but its test command is a placeholder that exits non-zero. Repository guidance says there is no configured automated test suite or linter.

Presence of route files does not prove end-to-end functionality. Registration, login, upload, extraction, generation, webhook delivery, restore, and packaging have not been executed in this review.

## Findings

### P0 — Authorization with elevated database credentials needs boundary-by-boundary verification
- **Evidence:** `services/backend/db/supabase.js` constructs a Supabase client using `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is privileged and must not be treated as protected by end-user RLS. `services/backend/routes/documents.js` shows document list and item queries without an explicit user/client ownership predicate in the inspected excerpts; `clients.js` does scope client queries by `req.user.id` in several routes.
- **Impact:** A route that trusts an identifier or omits an ownership check could expose or mutate one firm's records from another firm's session.
- **Remediation:** For each endpoint, authorize the parent client against `req.user.id` before document access; scope reads, updates, and deletes to authorized records; test negative cross-tenant cases. Prefer a user-scoped Supabase client where practical and keep service-role usage narrowly encapsulated.
- **Verification:** Integration tests using two separate test users and records; assert user A cannot list, read, mutate, serve, or delete user B's resources.

### P0 — Vault path and upload isolation needs end-to-end verification
- **Evidence:** `services/backend/vault/vaultManager.js` provides path sanitization and containment checks for some directory operations. `routes/documents.js` accepts client/file metadata and base64 payloads; local files are written before metadata persistence.
- **Impact:** Incorrect ownership checks, path resolution, content validation, or failure compensation could expose files, exhaust disk/memory, or leave orphaned files/metadata.
- **Remediation:** Validate ownership before any filesystem operation; constrain resolved paths to the configured vault; impose encoded and decoded size limits; validate extension and file signature; use collision-resistant names; clean up newly written files if metadata insertion fails when safe; add reconciliation for orphaned files.
- **Verification:** Traversal tests, symlink/path containment tests, oversized/malformed uploads, unauthorized client IDs, database-write failure tests, and restore/reconciliation tests.

### P1 — Permissive API defaults
- **Evidence:** `services/backend/index.js` configures wildcard CORS and JSON/form parsers with 100 MB limits.
- **Impact:** Broad browser access and large request bodies increase the attack and resource-exhaustion surface.
- **Remediation:** Use an explicit configurable origin policy compatible with the supported Tauri origins and local development; keep webhook and upload routes deliberately scoped; choose limits based on actual upload transport and enforce per-route limits; add endpoint-specific rate limits.
- **Verification:** Automated CORS tests for allowed/disallowed origins; request-size tests; staging checks for desktop and development origins.

### P1 — WhatsApp webhook trust and idempotency
- **Evidence:** `services/backend/routes/whatsapp.js` has a default verification token, responds 200 before processing, and the inspected POST handler does not visibly verify a request signature or deduplicate message IDs.
- **Impact:** Forged events, duplicate processing, false acknowledgements, or lost events could create incorrect client communications and records.
- **Remediation:** Fail closed when verification configuration is missing; verify Meta's signature over the raw request body; persist event/message IDs with a unique constraint; enqueue durable work before acknowledgement; make outbound sends idempotent where supported.
- **Verification:** Valid/invalid signature tests, replayed webhook tests, provider timeout tests, and durable-queue failure tests.

### P1 — Backend tests are not configured
- **Evidence:** `services/backend/package.json` defines `test` as an intentional error exit; repository instructions say no automated test suite is configured.
- **Impact:** Security and data-integrity regressions can ship without automated detection.
- **Remediation:** Add focused tests for validation, ownership, file boundaries, integration failures, and high-risk workflows; wire tests into CI.
- **Verification:** Execute the tests against a disposable test environment and require CI to fail on a deliberately introduced regression.

### P1 — Error handling and health endpoint disclose too much operational information
- **Evidence:** `services/backend/index.js` returns `err.message` from the global 500 handler and the health payload includes vault path, client count, AI model/configuration status, WhatsApp configuration status, and route inventory.
- **Impact:** Internal errors and infrastructure details can aid attackers or expose sensitive operational information.
- **Remediation:** Return generic 5xx responses with request IDs; log sanitized structured errors server-side; separate public liveness from authenticated/admin diagnostics; do not return local paths or tenant data in public health responses.
- **Verification:** Error-response tests and unauthenticated health endpoint review.

### P2 — Fallback demo data must never be confused with live business records
- **Evidence:** Client, document, and WhatsApp route modules contain in-memory example records; database setup logs that it runs in demo mode when credentials are absent.
- **Impact:** Operators may misinterpret sample records as real data, while demo writes are ephemeral and do not provide production durability.
- **Remediation:** Make demo mode explicit and disabled for production startup; label synthetic data clearly; fail closed for production when required persistence/auth configuration is absent.
- **Verification:** Production-mode startup tests with missing configuration; UI checks that data source and demo state cannot be mistaken for real records.

### P2 — Database schema and policy consistency need full review
- **Evidence:** `services/backend/db/schema.sql` defines RLS policies and metadata tables; the inspected schema includes ownership via `clients.user_id` for some document policies. Other tables/functions and existing deployment migration history were not fully validated.
- **Impact:** Missing policies, inconsistent constraints, non-idempotent migrations, or untested RPCs can create cross-tenant access and integrity issues.
- **Remediation:** Inventory all tables, policies, functions, grants, triggers, indexes, and migrations; test with the real role model; avoid applying the full schema blindly to a populated database.
- **Verification:** Disposable Supabase/PostgreSQL migration run, policy tests under authenticated users, schema diff, and query-plan review.

## Performance and UX
No runtime measurements, browser traces, query plans, load tests, or device compatibility runs were available. Avoid speculative indexing or caching until query patterns and plans are captured. Prioritize bounded queries and upload size controls because they are evident resource-risk areas. Audit UI accessibility and loading/error/empty states with representative desktop and small viewport workflows.

## Verification commands available from repository configuration
- Desktop: `cd apps/desktop && npm ci && npm run build`
- Desktop preview: `cd apps/desktop && npm run preview` (after build)
- Backend: `cd services/backend && npm ci && npm start`
- Backend tests: `cd services/backend && npm test` currently fails by design because the script is a placeholder.
- No configured backend lint command was found in the inspected package manifest.

These commands were discovered from repository configuration; they were not executed during this source-only review.

## Prioritized remediation
1. Cross-tenant data/file authorization tests and fixes.
2. Vault upload/serve path validation, limits, and failure compensation.
3. API CORS, request limits, error responses, and safe health endpoints.
4. WhatsApp signature verification and idempotent durable processing.
5. Automated tests and CI gates for critical flows.
6. Schema/RLS/grant/function audit in disposable environment.
7. Runtime performance baseline, accessibility review, backup/restore drill, and release runbook.

## Readiness
**NOT READY for production release based on currently available evidence.** This verdict reflects critical security and operational requirements that remain unverified, not a claim that a confirmed exploit exists. Reassess after fixes and executed staging tests.
