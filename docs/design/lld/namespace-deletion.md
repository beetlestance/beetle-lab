# Empty namespace deletion

Status: locally implemented; [evidence](../../verification/namespace-deletion.md).
Owner: namespace deletion application/SQLite participant and existing public DELETEs.
This does not introduce recursive cleanup, change Run retention or imply freed bytes.

## Contract

Delete organisation/workspace/nonroot folder using its existing scoped request,
expectedVersion and immutable requestId. Resolve scope before exposing existence;
wrong owner returns not_found, stale version conflicts. Root-folder deletion refuses.
Only empty namespaces can be deleted. Workspace may contain its automatic root and
settings only. Any child folder, suite, input (including retained deleted metadata),
Run, retention epoch/snapshot, settlement floor or other FK-protected owner refuses.
Organisation must have no workspace. Folder must have no child/suite/input.
Previously used workspaces can remain intentionally undeletable because replay and
retention identities are permanent. Clear errors explain retained dependencies;
no automatic cascade, reference pruning or refund is offered.

One BEGIN IMMEDIATE reads the shared receipt before the live entity. An exact old
request replays its acknowledgement after deletion; changed reuse conflicts. Old
CREATE receipts may still name the removed identity but never recreate it.
No transaction callback, native effect or external service crosses the worker.

## Permanent identity and funding

Migration026 adds an immutable marker independent of parent FKs. It records fixed
kind/id/scope/version plus original root/settings IDs. Its maximum logical charge
is2048 bytes, including the bounded acknowledgement/row allowance, paid against
current installation storage minus free-space reserve before removal. No spare
allowance or metadata refund is assumed. Full capacity refuses atomically.
Marker/schema/request fields are bounded. SQL validates original owner/version/
root/settings binding. Its insertion atomically charges and removes only the exact
settings/root/entity; FK refusal rolls everything back. SQL and public creation
reject reuse of deleted entity, root and settings IDs, including case aliases.
Markers cannot be updated/replaced/deleted and have no expiry/refund.
Existing global receipts stay retained; harmless history search metadata uses its
existing scoped delete/cascade rules. No old data is charged during migration.

## Responses and lifecycle

DeletionReceipt version is old+1, state tombstoned, cleanup complete. Complete means
empty namespace metadata removal only; it is not an output-cleanup or physical-free
space proof. Validate receipt identity/scope/request/version at both worker edges.
Unknown writes retain exact request identity for explicit retry; no automatic retry
with a fresh version. UI confirmation displays empty-only protection and retires
callbacks on scope/session change. Public guards run before body parsing.

## Acceptance

Actual SQLite/compiled worker: empty success, root/nonempty/foreign/stale refusal,
exact replay/reopen, shared request conflicts, late failure rollback, full-capacity
boundaries, immutable/case-alias markers and no old receipt resurrection. Preserve
retention/settlement data and counters. Check workspace root/settings atomicity and
search metadata. Actual configured application: registered/authenticated routes,
scoped errors and lost-reply replay. Provisional UI: confirmation, unknown retry,
late callbacks and navigation after acknowledgement. Native release/browser and
recursive maintenance remain separate; no schema guard is weakened for deletion.
