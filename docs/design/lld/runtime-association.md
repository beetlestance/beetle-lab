# Durable runtime/mailbox association

Status: source-local recovery primitive; full cross-service native acceptance remains separate.
Extends [runtime retirement](runtime-retirement.md) and [C1 reserve](staging-namespace.md).

## Authority and ordering

A cold backend cannot associate an existing mailbox volume merely from its name,
labels or options after the original container has disappeared. Before a container
DELETE, inspect the exact released runtime ID and full pinned spec, require stopped
state, and verify its actual mailbox mount and volume metadata. Only then mint a
private process-local observation. Journal client commit accepts that opaque token;
caller records and fabricated tokens cannot substitute for an observation.

Commit one immutable record before dispatching container deletion. It binds exact
original scope/generation/intent, retirement request digest, installation and prepared
task namespace identities, verified daemon ID, runtime ID, spec digest and mailbox
name. Journal reuses current retirement eligibility and released reservation; SQL
guards also bind installed daemon and prepared task mailbox. Exact replay is free;
replacement/update/delete and changed identities refuse. Migration021 adds no records,
rebinds no namespace and changes no existing charges.

An unknown commit permits no DELETE. Retain the actual worker carrier through its
termination and recover only through the same immutable record after reopen. Failed
termination stays pending, retaining the runtime original through close. The shared
termination promise keeps its failure; observing rejection prevents an unhandled
promise without declaring drainage. Current producer retirement authority must still
be valid throughout the calling runtime operation.

## Cold recovery

Production RuntimeRetirement binds the actual Journal association port. The backend
captures its methods before native awaits. For a missing original, read the exact
record, match current plan/original/daemon/runtime/spec/mailbox, and mint an internal
resume capability bound to this mailbox owner. Raw persisted values are metadata;
there is no exported constructor for observed or resume capabilities.

The resume restores historical association only. Fresh Docker checks still require
both original ID and original name absence, exact current volume labels/options,
nonforce volume DELETE and positive post-delete absence. A changed daemon, replacement
runtime/volume configuration or wrong spec cannot inherit custody. Actual absence of
both original and volume can succeed through the existing positive chain without
inventing an association. No record,404, timeout, transport close or caller boolean
alone grants whole-run cleanup or refund authority.

A matched live-mailbox runtime requires persistence before deletion. Adapter-only
fixtures supply explicit synthetic persistence; production always uses the existing
Journal worker. Runtime/native/gateway pools and public wire messages are unchanged.

## Bounds and accounting

Canonical record<=1536 UTF-8 bytes; logical row allowance512; named cell<=2048.
All UUIDs/digests, daemon<=128 and mailbox<=128 have closed syntax. Escaped command
frames<=4096 and reply wrapper<=2048; one original-keyed row, no history scan.
The maximal-field test proves the complete encoded value fits.

C1's full196608 reservation is unchanged. Named buckets now total169984 and explicit
slack26624. The2048 cell is allocated from prior28672 slack, documented in the single
control-budget owner; no hidden consumer, ceiling increase or second quota charge.
Original source/event/retention bytes and cleanup reserve remain charged. C5 separately
owns settlement and compact anti-replay retention.

## Acceptance boundary

Cover native observation before commit and commit before DELETE, cancellation and
failed/unknown commits, actual compiled-worker lost reply/termination/reopen, exact
replay, fresh cold backend, foreign identity/configuration, migration preservation/
rollback, immutable SQL guards and held/rejected carrier close. Synthetic Docker
responses qualify adapter ordering, not Linux daemon behavior. C4h's full native
roots/authenticated runner HTTP/both-workers lane must compose this primitive before
C4 is accepted. No settlement, public retention/delete or release claim follows here.
