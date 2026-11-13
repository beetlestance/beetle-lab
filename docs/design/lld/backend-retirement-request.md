# Backend retirement request projection

Status: read-only metadata boundary; runner dispatch and ACK storage remain pending.
Parents: [output retirement](output-retirement.md), [deletion store](output-deletion-store.md),
[wire values](retirement-wire.md). Owner: existing SQLite output-deletion metadata.

OutputDeletionMetadata.retirementRequest accepts only a scoped Run/deletion key and
returns a closed <=3072-byte OutputRetirementRequest. The compiled worker derives it
inside the existing deletion transaction. No registration, browser closure, path,
current agent authority or native proof enters this method. There is no new table,
state transition, accounting charge, queue or external IO.

The committed deletion must have all files absent and the same exact captured Run
version/attempt/kind/closure digest. Reuse the existing retained-original/finalization
reader: source needs its immutable source+manifest closure; absence needs its actual
retained proof and finalization. Positively unsent deletion refuses this projection;
it keeps its separate no-agent settlement branch. Missing/contradictory evidence
fails rather than synthesizing a request from an active agent registration.

Require the exact captured file count and original slot versions, and one committed
absent record per ordinal with the parent's fixed namespace. At most128 records are
inspected through existing typed file capture. A zero pending counter alone is not
sufficient. A source with zero artifacts is distinct from an unsent attempt.

The retained event cursor must match original run/scope/intent/physical Journal/
generation, be contiguous and confirmed through exactly the closure's final sequence.
Reuse the finalization owner's event predicate for the actual final event and retained
byte horizon; additionally count retained rows in the indexed attempt/generation range
to reject a missing middle event despite unchanged high-water counters. This scalar
aggregate does not load event bodies. Zero sequence requires the actual zero cursor.

Preserve physical/original identity spelling. Shared capture validates the complete
request; worker reply capture also binds scope, Run and deletion IDs before caller
use. Matching reads/reopen return the same immutable request. No valid shape, file
receipt, returned request or files_absent status implies producer cleanup, backend
ACK, refund, purge or authorization for a public delete route.

Acceptance: source with pending/partial/all file receipts; zero-artifact source;
zero/nonzero absence; unsent refusal; scope/closed-key/reply mismatch; missing retained
middle event; actual compiled-worker/native-file progress and reopen; unchanged
producer rows, finalization replay and all existing charges.
