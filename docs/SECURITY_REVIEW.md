# Taxflow.AI Security Review

**Status:** Initial source review; not a penetration test or certification.

## High-priority areas

1. **Elevated database credentials:** Supabase service-role client is used server-side. It can bypass RLS; route-level ownership checks are mandatory.
2. **File authorization:** Validate parent client ownership before all file list/read/serve/delete/upload operations. Keep canonical resolved paths under the configured vault and reject traversal/symlink escapes.
3. **Request perimeter:** Current API entry point configures wildcard CORS and 100 MB JSON/form parsing limits. Replace with an explicit origin policy and route-specific size limits.
4. **Error and diagnostics disclosure:** Global error handler returns internal error messages. Health payload reveals filesystem path, client count, integration configuration, and route list. Use generic public responses and protected diagnostics.
5. **WhatsApp webhook:** Default verification token is unsafe for production. Require configured secrets, verify request signatures against raw request bytes, and deduplicate provider event IDs.
6. **Demo mode:** In-memory sample records exist in routes. Production should fail startup or fail closed if durable persistence and required authentication configuration are absent.
7. **Secrets and logging:** Keep service-role and provider tokens server-only. Avoid logging request bodies, tax identifiers, full file paths, message bodies, or authentication headers. Review current logs and deployment secret settings.
8. **Uploads:** Apply byte limits, content-type and file-signature validation, safe filenames, disk quota checks, and safe cleanup after partial failure.
9. **Data privacy:** Define encryption-at-rest expectations, local vault ACLs, retention/deletion, encrypted backups, restore tests, and audit logs for access to sensitive documents.
10. **Dependency and build security:** Run lockfile-based install, dependency audit, secret scanning, and supported-platform build checks in CI.

## Required evidence before release
- Two-tenant authorization tests for every resource route.
- Negative tests for path traversal, unauthorized file serving, oversized/malformed uploads, invalid webhook signatures, and duplicate webhooks.
- Review of every table's RLS policy, grants, trigger/function security, and RPC permissions.
- Confirmation that no secrets are present in client bundles, repository history, or logs.
- Staging verification of secure transport, platform permissions, and vault filesystem ACLs.

No formal security certification or comprehensive penetration test has been performed as part of this review.
