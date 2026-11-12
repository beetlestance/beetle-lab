# Standalone exports

Public index exports bounded logical create/cancel command capture and scoped
create/cancel/get/list use cases. Allocation IDs/time are excluded from create
replay identity; cancel includes job ID. Receipts are checked against original
intent; current reads never seed from stale replay receipts. No compiler or engine
effects occur here. ExportStore owns durable transactions; export-runtime owns
private reconciliation through the one shared installed gateway and output owner.

Checks: app/test/exports. Contract: docs/design/lld/export-publication.md.
