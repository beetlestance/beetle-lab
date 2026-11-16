# Private backend settlement evidence

[Contract](../design/lld/output-settlement.md). Backend024 implements exact private
source/absence/positive-unsent transactions. Automatic gateway/driver settlement and
whole-chain native qualification remain separate; public retention is not enabled.

The owning projection reuses current Run/version, one original, zero outbox, no export
links, all backend-file receipts, retained closure/events and immutable cleaned ACK.
Source/absence require the exact ACK-bound agent settlement reply. Unsent cancellation
uses its existing positive witness and a null agent reply. Missing rows grant no credit.

A permanent2560-byte tombstone precedes fixed bounded original purge. Private phases
allow only exact insertion, the current table/original deletion, and exact usage/replay
counter deltas. Nested global, cross-phase and cross-original mutations refuse. Backend
lifetime events use the separately enforced65536-row limit; counts precede projection.
Remaining payload+metadata+cleanup debt is credited once, minus the permanent floor.
Finalization's earlier unused-payload credit is never refunded twice. Already funded
settlement still completes after configured storage limits are lowered.

Run snapshots, attempts, events, output records, cleanup records and execution orders
are removed. Real published input metadata, authoring pins and their complete independent
charge remain. Revisions, global mutation receipts and name indexes also remain. No
secure erase, whole-directory quota or SQLite/WAL block-reclamation claim is made.
Retired Run/attempt/deletion/order identities reject raw SQL recreation and case aliases.

The transaction keeps foreign_keys enabled and defers the existing immediate cycle
through enforced COMMIT. A retained unknown FK child makes COMMIT fail and rolls back
all rows, credit and replay identity. Late aborts and nested writes roll back likewise.
Uncertain rollback/protection restoration poisons future Store commands and attempts
native close once. A rejected worker termination keeps the private call pending.
The unchanged shared transaction implementation moved to a leaf to avoid import cycles.

Source, absence, positively unsent, changed agent commitments, exact replay, lowered
limits, raw SQL immutability, case aliases, bounded codecs, actual compiled worker
commit/reopen, lost replies, held/rejected termination and poisoned close are covered.
Historical fixtures use a frozen real023 initializer. Rewind refuses committed identity
or replay debt, restores exact prior guards and removes only empty024 tables. Older
owning migration assertions still run before024 intentionally amends retained guards.

Initial10cases passed before lint rejected validation/dispatch complexity. Validation
responsibilities were separated without weakening predicates. A subsequent lane failed
a test's nullable-union access at typecheck; corrected before execution. The next lane
passed15cases with1 fixture-cleanup failure: its injected close override leaked into
teardown. Restoring the fixture's native close fixed cleanup without healing poison.
Worker/poison4cases passed, then the complete scoped migration lane passed36cases in
18.53s, types16.28s, lint6.95s, architecture14.79s and docs2.35s. Additional real pinned
input and malformed-worker-boundary checks passed5cases; counts overlap. Source-bound
plans, exact exits and final gates are retained privately. No full-suite claim is made.
Independent review corrections covered single-attempt native close, sticky rejected
termination and case-safe fences. Agent/native behavior is reused from its own evidence;
this metadata lane uses synthetic agent replies and is not cross-service qualification.
