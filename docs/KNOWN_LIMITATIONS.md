# Taxflow.AI Known Limitations

This list reflects the initial source-only review on 2026-10-12 and must be updated as tests run.

- No local build or automated runtime tests were executed during this review.
- Backend `npm test` is a placeholder that exits with an error.
- No configured CI workflow was found in the repository tree inspected.
- Cross-tenant access behavior with the service-role Supabase client is not fully verified.
- Full RLS/grant/function/trigger coverage across the deployed database is not verified.
- Vault backup, encryption-at-rest, filesystem ACLs, recovery, and reconciliation are not verified.
- WhatsApp webhook signature validation, durable queueing, and duplicate-event protection are not verified.
- AI provider timeouts, quotas, prompt-injection boundaries, output validation, and cost limits are not verified.
- Production-mode behavior when Supabase credentials are absent is not verified.
- API CORS behavior, request-size limits, and rate limits require implementation and testing.
- No performance baseline, load test, accessibility audit, or supported-OS release test was executed.
- Production topology, monitoring, alerting, backup restoration, and rollback have not been verified.
