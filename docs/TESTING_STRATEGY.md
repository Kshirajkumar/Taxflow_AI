# Taxflow.AI Testing Strategy

## Current baseline
The backend package's `npm test` script is a placeholder that exits with an error. The desktop build command runs TypeScript project checks and Vite build. No backend test framework or CI workflow was established from the inspected package configuration.

## Required layers

### Unit
- Request schema validation and normalization.
- Vault path containment and filename sanitization.
- Tax/document extraction normalization and confidence handling.
- Deadline calculations with time-zone and boundary dates.
- Error-to-HTTP status mapping.
- Idempotency key and duplicate webhook event handling.

### Integration
- Supabase repository operations against a disposable database.
- Authenticated tenant scoping for every client-owned resource.
- Upload metadata persistence and cleanup on failed database writes.
- File serving authorization and file-not-found behavior.
- AI provider timeout, quota, malformed response, and unavailable credential behavior.
- WhatsApp signature verification and outbound provider failures.

### End-to-end
- Sign up/sign in/sign out and expired session.
- Create a client, upload a document, extract fields, review/verify, and reopen after restart.
- Create/update/complete a compliance deadline.
- Generate a draft notice and verify that it is clearly a draft pending professional review.
- Webhook ingestion and duplicate delivery.
- Account deletion and related metadata/file lifecycle.

### Security and isolation
Use two independent synthetic firms. Confirm firm A cannot list, read, update, delete, serve, extract, or generate against firm B's resources. Test missing/expired tokens, forged client IDs, traversal strings, malformed payloads, oversized uploads, SQL filter abuse, and secret leakage in responses.

### Reliability and performance
- Concurrent duplicate submissions and simultaneous record edits.
- Provider timeout and rate-limit responses.
- Database unavailable, pool exhausted, and interrupted file writes.
- Baseline, load, spike, and soak tests against isolated staging only.
- Record p50/p95/p99 latency, error rate, CPU/memory, query counts, disk use, and queue depth where applicable.

### Accessibility and compatibility
Keyboard-only navigation, visible focus, labels, contrast, zoom, reduced motion, small desktop windows, supported OS builds, and screen-reader checks for core workflows.

## Commands currently discoverable
- `cd apps/desktop && npm ci && npm run build`
- `cd services/backend && npm ci && npm start`
- `cd services/backend && npm test` (currently a known failing placeholder, not a passing test suite).

## Acceptance rules
- A test counts as passed only if it was executed and actual output was reviewed.
- External integration tests must use controlled test credentials or provider sandboxes.
- Database/security tests must use disposable or staging data, never destructive production actions.
- Skipped tests are reported as unverified.
- CI must run relevant tests, TypeScript checks, and production builds before merge.
