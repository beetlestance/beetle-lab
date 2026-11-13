# Durable backend retirement ACK

Status: proposed next implementation boundary; not storage/refund authority.
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

## Control reservation prerequisite

The [dedicated cleanup reservation](backend-cleanup-control.md) owns the proposed
receipt cell of4096 body bytes plus512 logical row bytes,
with one cell per original. This is a proposed bound, not a measured SQLite/WAL quota.
Before implementation, identify and review the actual reservation owner, immutable
allowance and admission point for these bytes. Existing retained65,536-byte metadata
allowance must not be treated as proven spare capacity merely because it is charged.
Audit overlapping control consumers before carving out a receipt cell; otherwise add
an explicitly accounted reservation before destructive work. Do not allocate one
unbounded receipt per retry, silently expand quota, create default-zero charges or
refund old charges to make an ACK fit. Full control capacity must fail charged and
recoverably before issuing new effects. Agent Journal and backend reservations remain
separate authorities; one service cannot borrow the other's unused control bytes.

Phase A preserves every existing allocation, payload, source/absence finalization,
event, replay identity and charge. If explicit additional control reservation is needed,
revise and review the parent accounting contract first. ACK persistence itself performs
no purge or refund. C5 separately owns exact-once settlement and compact anti-replay
identity; a late Offer must remain unable to rerun after payload removal.

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
