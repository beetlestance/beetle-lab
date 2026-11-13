# Durable backend retirement ACK

Status: immutable ACK metadata implemented locally; driver/native composition pending.
Parents: [retirement](output-retirement.md), [request projection](backend-retirement-request.md),
[gateway](retirement-gateway.md), [output allocation](output-allocation.md).
Owner: existing backend metadata worker and deletion driver; coordinator reserves
migration IDs and the exact private port before implementation.

## Exact acceptance

The caller supplies a scoped committed deletion key and the actual cleaned reply from
RunnerRetirementGateway. Pending, protocol error, unavailable agent, unknown outcome,
timeout, cancelled request and404 cannot produce an ACK. This private capability must
never be reachable through public request bodies or a generic receipt-import route.

Inside one immediate transaction, derive the expected request again through the same
retained-original/file/event projection as retirementRequest. Do not accept a caller's
request snapshot as authority. Capture the complete reply against that exact request,
including its requestDigest and original physical Journal spelling. Agent namespace/
preparation identities are distinct from backend file namespace/preparation identities;
do not compare or substitute those separate commitments.

Store one canonical closed cleaned reply, <=4096 UTF-8 bytes, per immutable deletion
identity. Retain an exact digest/version and its original binding. An identical replay
returns the first committed row without changing counters/version; any changed scope,
Run, original, physical authority, closure, deletion generation or cleaned commitment
conflicts. A lost COMMIT reply is recovered by immutable read/replay, never a replacement
row or a presumed failure. Reading historical ACK metadata does not perform new IO.

All storage entrypoints, including direct SQL guards, must reject pending/forged shape,
missing backend file receipts, unsent originals, contradictory closure/event evidence,
changed physical bindings, replacement and deletion. Use bounded pure wire validation
and positive retained-row provenance; JSON shape or a matching hash alone is insufficient.
Keep one projection authority, with shared/frozen definitions where SQL guards need it.

## Control reservation

The [dedicated backend control reserve](backend-cleanup-control.md) owns one ACK cell:
<=4096 canonical body bytes plus512 logical row bytes, inside the separately charged
policy1 allowance. Actual logical_bytes equals encoded body length+512. Record/replay
never adds another charge or borrows an agent/old-output allowance. Missing policy1
reservation refuses; legacy top-up must commit before any further effects.

Phase A preserves every existing allocation, payload, finalization, event and replay
identity. ACK persistence does not decrement usage. C5 separately owns settlement and
compact anti-replay identity, including a proof that its tombstone fits its own bucket.

## Transaction-scoped insertion guard

The existing immediate metadata transaction derives the expected request through C4d,
validates the actual cleaned reply and creates one detached canonical body/digest/cost.
The fixed synchronous INSERT installs those four scalars in a private per-DB permit
only for the statement and clears them in finally. Nested insertion refuses. No
callback, await or external permit setter extends this window.

A nondeterministic SQLite function returns integer1 only for that exact deletion ID,
body, digest and logical cost; otherwise0. Missing registration fails closed. The
constant version1 and parent/control/file-custody constraints cover remaining inserted
fields. SQL rejects raw insertion, replacement, updates and deletion. Rollback and a
failed COMMIT leave no permit. One sequential worker owns at most one <=4096-byte body.

This guard vouches for the trusted metadata operation's validated input. It does not
authenticate HTTP or prove native IO; the driver must supply the actual gateway reply.
Read/replay revalidates the stored canonical digest and exact original against retained
rows. Missing ACK is an explicit metadata state, never evidence of rollback or absence.
Record replies match the entire submitted reply at both worker boundaries; read replies
are scoped observational metadata, not a caller-supplied refund capability.

## Driver and discovery boundary

The existing file driver currently discovers pending backend files; it does not find
files_absent originals needing agent retirement. Add bounded separate eligibility
rather than silently broadening the old scan contract. Preserve the unsent no-agent
branch. Limit scanned candidates as well as returned results when skipping existing
ACK rows, and keep cursor progress finite even for an empty eligible result page.

Use the existing sequential driver and shared gateway, not another worker pool or
cleanup scheduler. Each tick derives the durable request; pending schedules a later
bounded turn using that same identity. A cleaned reply is committed through the new
ACK transaction. Neither a timer nor caller cancellation detaches the issued metadata/
HTTP originals. Shutdown retains them through actual settlement and native closes.
Classify recoverable transport/unknown replies separately from permanent conflicting
identity; do not hide failures in an infinite retry loop.

## Required evidence before C4 acceptance

Use actual native roots, authenticated runner TCP and both compiled metadata workers.
Qualify source and absence, pending batches, lost intent/plan/unlink/native receipt/ACK
replies, and reopen before/after each durable boundary. Verify exact replay and unchanged
old charges independently through SQL. Include wrong scope/authority/closure, missing
middle event or file receipt, full control reservation, non200, late cancellation and
failed-close retention. A fake HTTP receipt or row-only test is only local metadata
coverage. Existing normal k6 image smoke and native leaf tests do not close this matrix.

The conservative cold-mailbox association gap remains explicit: missing durable exact
runtime association must stay unresolved, even when container metadata is absent.
C5 settlement and C6 public retention/delete remain blocked by their own positive
receipt, accounting and anti-replay requirements after this boundary is implemented.
