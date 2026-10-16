# Intake-to-output delivery phases

This plan divides the 11 outstanding items from the production review into two phases.

## Phase 1 — secure intake foundation

1. Confirm the migration against the live Supabase project and verify RLS with authenticated firm/client access.
2. Replace shared-token assumptions with authenticated user/session identity and server-side authorization.
3. Make Telegram client and period routing deterministic; unresolved data stays quarantined.
4. Persist every routed inbound document into the canonical `Raw` folder before extraction.
5. Keep Raw originals immutable, hash-addressed, and retained after approval.
6. Make extraction orchestration server-owned and record the document state transition.

Phase 1 exit criteria: a test Telegram document is signature-verified, de-duplicated, routed to exactly one client and period, saved in `Raw`, extracted from the server-side original, and visible in the review queue without losing the original.

## Phase 2 — approved outputs and production operations

7. Build versioned deterministic filing/extraction output engines.
8. Validate every generated file against its official schema and retain run, engine, period, and source-document metadata.
9. Add transactional approvals, maker-checker permissions, immutable approved revisions, and complete exportable audit events.
10. Build persistent scheduled outbound messaging with consent, approval, retries, opt-out, and delivery status.
11. Execute live end-to-end certification with Telegram, Supabase RLS, the canonical vault, AI extraction, review, approval, and artifact verification.

Phase 2 exit criteria: no output is marked approved unless the server can verify the exact generated artifact, the approval identity and version are recorded, and the complete run passes live ownership, schema, and regression tests.
