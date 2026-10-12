# Taxflow.AI Performance Review

## Baseline status
No executable runtime environment, real workload, browser trace, query plan, production metrics, or provider telemetry was available for this source review. Numeric performance claims would be fabricated, so no before/after measurements are reported.

## Source-observed risks
- Express JSON and URL-encoded request parsers are configured for 100 MB payloads, increasing per-request memory pressure.
- Document list queries shown in the inspected route source use `select('*')` and do not show pagination. Large datasets may create oversized responses and high database/network cost.
- Vault usage scans recursively read directory entries and stat files; avoid calling this synchronously on frequent public health checks as the vault grows.
- Several route modules contain fallback in-memory records, which are not a production persistence mechanism.
- AI and WhatsApp calls need explicit provider timeouts and bounded retry policies; actual current latency behavior has not been measured.

## Measurement plan
1. Establish representative synthetic data volume and core workflows.
2. Record desktop startup, route load, upload/extraction completion, and UI responsiveness.
3. Capture API p50/p95/p99 latency, request size, error rate, CPU/memory, and event-loop delay.
4. Capture query plans and rows scanned/returned for the most frequent list/detail queries.
5. Measure upload memory/disk use and vault scan time with growing file counts.
6. Load test staging at baseline, expected load, spike, and soak profiles.
7. Optimize the highest verified bottleneck and compare under the same workload.

## Guardrails
- Add database-level pagination and explicit selected columns where compatible with the UI contract.
- Set body limits according to actual upload design and enforce limits on decoded bytes.
- Avoid adding speculative indexes or caches without query-plan and invalidation evidence.
- Never load test production without explicit approval and a rollback/capacity plan.
