# Standalone exports

Public index exports bounded logical create/cancel command capture and scoped
create/cancel/get/list/latest-revision use cases. Latest wrappers validate nested
scope/revision and job state semantics; absence differs from a missing revision. Allocation IDs/time are excluded from create
replay identity; cancel includes job ID. Receipts are checked against original
intent; current reads never seed from stale replay receipts. No compiler or engine
effects occur here. ExportStore owns durable transactions; export-runtime owns
private reconciliation through the one shared installed gateway and output owner.

Checks: app/test/exports. Contract: docs/system/contracts/exports.md.
