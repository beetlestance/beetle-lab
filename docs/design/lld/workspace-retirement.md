# Retiring used workspaces

Status: user-approved correction; locally implemented, candidate qualification pending.
Evidence: [focused worker/application checks](../../verification/workspace-retirement.md).
Owner: namespace deletion, SQLite visibility boundary and public access composition.
Public API request/receipt shapes stay unchanged. No recursive physical cleanup.

## Meaning of delete

A workspace may be retired with saved suites, published inputs and terminal history.
It disappears from normal workspace lists, organisation aggregates and public
workspace-scoped access. Its canonical name, root/settings, revisions, history,
receipts, pins, replay floors and paid storage remain. Retirement frees no bytes.
A new workspace UUID may reuse its visible name; the retired identity never revives.
Normal organisation deletion still refuses retained workspace dependencies.
Logical organisation retirement is outside this correction.

Queued/active/unresolved execution or export work and unfinished input intake
refuse retirement. Retained output holds/history are paid data, not active work.
Already-issued delivery/cleanup/settlement/maintenance keeps its original private
authority; a new user mutation or unissued retention Apply cannot acquire it.

One BEGIN IMMEDIATE reads the exact deletion receipt first, checks scoped identity,
expected version and quiescence, reserves the existing2048-byte marker and retires
the workspace. Exact DELETE replay returns the original acknowledgement; changed
intent conflicts. A fresh request for an already retired workspace is not_found.
No receipt, file, pin, epoch, snapshot or counter is pruned or refunded.
Cleanup complete means logical visibility retirement, not physical deletion.

## Storage invariant

Migration028 adds an irreversible private retired flag. Keep the existing private folded_name UNIQUE key without rebuilding FK-linked
workspace rows. It is the active-name key: active rows use canonical folded names.
Retirement switches only this private uniqueness key to char(1)||UUID and sets retired=1.
Public name validation excludes control characters; ordinary names cannot claim
that reserved key. Historical labels derive from canonical name, never the retired uniqueness key.

The immutable marker and flag must agree in the same transaction. SQL rejects
raw flag toggles, reserved-key insertion, retired-row changes/removal and fresh
user-owned child/admission inserts under retired scope. Source root/settings/name/
version facts remain intact. Existing markers and migrations stay immutable.
An indexed active-page view bounds pagination/counts without scanning tombstones.

## Public and private access

Private shared Entities/Runs/Settings lookups remain available for retained work.
The public namespace get/list boundary hides retired workspaces. Every authenticated
workspace-param HTTP route checks this visibility before its handler/body work;
authorization still precedes existence checks. Exact workspace DELETE replay is
routed to the receipt-first deletion owner instead of being rejected by this gate.

Fresh worker mutation commands also check visibility before ordinary receipt replay.
SQL blocks fresh user work as a final guard. Historical read-only mode may view
retained scope using its separate authority and still refuses every mutation.

Organisation overview/counts/recent activity exclude retired scope. Parent retention
discovery skips it. Fresh previews and previously unissued Apply refuse it; exact
already-applied maintenance originals can finish. Existing progress/ACK/settlement
reads never depend on the public visibility check.

## Verification

Use real worker/SQLite transactions and configured authenticated HTTP routes:

- Retire a used workspace; preserve original rows, bytes, pins, receipts and floors.
- Hide direct/aggregate access, fence old mutation replay and stale preview Apply.
- Keep exact DELETE replay, wrong-owner/version/capacity and rollback behavior.
- Refuse active Run/export and unfinished upload work; permit paid terminal history.
- Reuse the visible name with a fresh UUID; forbid old ID/root/settings resurrection.
- Prove raw flag/key mutation guards, indexed active pagination and late rollback.
- Exercise existing private maintenance and historical reads after retirement.
- Verify migration/reopen/FKs and a browser deletion/navigation acknowledgement.

No user installation is migrated by implementation tests. Batch the new runtime
candidate qualification after this production change and other required corrections.
