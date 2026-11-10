# Backend output adoption and publication

Status: coordinator draft for independent review. No storage port, schema ID or
finalization implementation is accepted here yet. Uses the existing immutable
[output allocation](output-allocation.md), [event custody](event-custody.md) and
[output transport](output-transfer.md). No second installation usage counter.

## One allowance

Let P be original maximum payload bytes, C the charged retained-control bytes
(canonical events+128 per row), M the canonical PublicManifest bytes, A the safe
sum of all declared artifact bytes, and D any additional durable/staging/report
copies. Before adoption require C+M+A+D<=P with safe integer arithmetic. The whole
manifest counts once as payload, including its embedded EngineResult. Never hide
that result inside the separate65536 metadata allowance. Persist no second complete
result/manifest copy without counting it in D; derive summary views from the one
stored result or explicitly charge any persisted derivative.

Each artifact owns one task-specific staging file followed by same-filesystem
atomic rename; that same content counts once in A. A second temporary/final copy
counts separately in D before writing. Recovery reconciles its existing file/token
before creating another writer; an unresolved old original prevents a replacement.
Do not silently expand P, borrow metadata allowance or rerun the engine on shortage.
Record a storage problem and retain original allocation/source obligations.

Adoption and event ingest serialize in the same metadata worker transaction.
After adoption, C may grow only within P-M-A-D. Thus event ingress and artifact
adoption cannot each promise the same headroom. Even before event closure catches
up, no persisted/written byte can escape the reserved accounting. Extra report
files reserve their own D before creation; on-demand bounded streaming without
persistent copies uses control-process buffer budgets instead.

Partition the65536 metadata allowance:128 artifact slots*384=49152; owner/binding/
closure/event cursor8192; bounded diagnostics4096; fixed auxiliary allowance4096.
Each artifact slot permits canonical state<=256 bytes plus128 row allowance, with
bounded UUID tokens/index/offset/phase/version. Derive expected length/hash/path
from the one manifest and scope from parent FKs. Exact fields and worst-case
canonical lengths still require calculation before port/migration acceptance;
this is logical accounting, not physical SQLite/WAL sizing. No unbounded errors/URLs.
Settings reductions do not invalidate owned reservations or grant permission to
refund them. Physical backing-store free-space checks remain separate safety gates.

## Private lifecycle owner

One OutputCustodyStore in the existing metadata worker owns adoption, transfer
state, publication and terminal accounting; one application use case coordinates
its file adapter, existing event store and shared installation gateway. No network
or filesystem work runs inside a SQL transaction. No periodic whole-history scan.
Discover retained output obligations with a captured upper keyset, pages1..32,
compact items/page<=65536 and cursors<=1024, including released execution records.

adopt captures SourceEnvelope and original EventBinding, validates public digest,
result seal and physical UUID/scope/intent/engine/installed pins against the retained
original, then reserves the exact source/artifact plan. The backend has no prepared
runtime plan: it captures specDigest as authenticated agent evidence covered by
manifestDigest and requires exact replay equality. Original-spec validation remains
the producer Journal guarantee; no current plan/catalogue is substituted. Equal replay returns
the same records; different source/manifest content conflicts. Do not adopt current
catalogue/capability values or choose a new physical Journal. Envelope bytes are
bounded before parsing, native SQL before materialization, RPC before cloning.
The result's canonical65536-byte and128-artifact limits remain independent.

One writer per artifact uses durable random upload identity, bounded append/status
reconciliation and exact expected length/hash from the adopted manifest. Keep
source ID, artifact ID, file token and expected hash immutable. A resumed file is
rehash-verified to full expected SHA256 before publication, including zero bytes.
Original writes, data flush, cached descriptor closes and parent-directory rename
flush must succeed before a file receipt escapes. Lost publication reply reconciles
the same token/path/digest, never creates another uncharged copy or marks missing
files complete. Reuse common local file custody primitives; input lifecycle rows
and engine source paths are not artifact storage authority.

publish verifies every required declared artifact has a successful native receipt,
all writers/transfer originals are quiescent, and the manifest remains exact. Commit
published references atomically; partial/native/SQL failure retains charged staging
and can resume under the same original. No fake empty artifacts, implicit EOF,
missing-file404, source receipt or event ACK authorizes publication or deletion.

## Final result and retained charge

Finalization additionally requires known execution termination, the exact published
source and artifacts, valid result seal/outcome eligibility, and contiguous durable
events through DeliveryClosure.finalAgentSeq under the same physical/source tuple.
There must be no local event beyond that immutable end. Empty batches, remote ACK,
physical CPU release and a provisional engine.result are insufficient.

The app validates execution/exit/completeness evidence and the engine's sealed
outcome; it does not reinterpret k6 metrics or duplicate its compiler/outcome mapper.
The exact eligibility table and error/nonexecution closure port must be reviewed
before finalizer code. Persisted cancellation winning before terminal COMMIT yields
cancelled; a later cancel returns the committed result. Source custody remains
independent of passed/failed/inconclusive and terminal run display.

One immediate transaction closes the event/output obligation, commits immutable
result references and terminal run state, and settles unused payload allowance.
Retain C+M+A+D plus bounded metadata charge; release only the proven unused portion
once all original writers/transfer are quiescent. Lost reply replays exact published
identity/version and cannot double refund. Agent files stay charged until a separate
publication ACK/delete-intent/read-quiescence protocol is reviewed and implemented.
Retention/deletion and nonexecution/error closure remain required first-release work.

## Required evidence

Native files plus real metadata worker: C+M+A+D exact/one-byte-short/overflow,
concurrent event/adoption reserve, settings reduction, commit/serialization rollback,
wrong original/source/UUID, duplicate/resumed appends, partial fsync/close/rename,
zero-byte full hash, reply loss after native/SQL publication, no double-copy/refund,
late/missing events against immutable closure, cancellation before/after terminal
COMMIT, and restart recovery without target execution. Inspect rows/counters/files,
not only return values. No release-qualified or complete R0-R4 claim from this draft.
