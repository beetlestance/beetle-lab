# Backend source adoption store

Status: implemented and independently reviewed; [local evidence](../../verification/output-adoption.md)
records SQLite and compiled-worker limits. [Output adoption](output-adoption.md) owns accounting; [payload storage](output-payload.md)
owns the single result/manifest body. Application migration009 implements this
store; agent Journal migration numbers are independent. No artifact writer,
finalization or deletion authority is granted by this prerequisite.

## Scope and bounds

The private OutputCustodyStore port owns scan/load/readSource/adopt in the existing
metadata worker. It creates no new connection, background loop or network pool.
Adoption request<=79872 bytes; state/page<=65536; source<=75776; cursor<=1024;
scan limit1..32. Capture closed bounded input before hashing/cloning. Request and
reply limits apply on both sides of worker RPC. adopt/readSource share the existing
two-large-original worker allowance, reserved before capture and held through the
actual original; do not add a pool.
Bound native SELECT text before materialization. Do not persist an RPC receipt
containing another complete source/result copy.

Use the retained EventBinding: namespace/run/attempt/intent/generation1 and exact
physical Journal UUID. Read the immutable original Offer with its existing2MiB
native CASE bound, then match manifest engine and installed identity. Verify the
shared source envelope/result seal/digests and exact scope/intent/physical binding.
Treat authenticated specDigest as opaque original agent evidence. Reject artifact
IDs ambiguous under case folding before creating any token. Current catalogue,
capability, profile or logical cursor cannot replace these original facts.

## Transaction

In one immediate metadata transaction, confirm the owned acknowledged execution
and output allocation, compare any existing provisional carrier result, enforce
C+M+A+D<=P and replace/insert the sole canonical manifest carrier. Refuse an
existing durableThrough or highest retained event above finalAgentSeq. Once adopted,
a native insert ceiling rejects every new event above that immutable end; equal
retained replays at/below it remain valid. Persist only
compact closure/source identity and one compact initial slot per declared artifact.
Use fresh random UUID upload tokens once, preserving them on equal replay. No
file operation occurs in this transaction. Tokens are natively unique within each
attempt/path namespace; a UUID collision aborts atomically. All versions start1 and are safe
integers. Different source/manifest/closure conflicts without changing rows,
versions, tokens or counters. A lost committed reply replays the same state.

Adoption can precede the backend observation of physical release, but terminal
finalization still requires that observation. Never set result_observed merely
because a manifest was adopted. No installation charge changes: these bytes remain
inside the already held payload+65536 reservation. The event guard shares the
carrier charge and continues to enforce one original P.

Each stored artifact slot is closed {v,t,o,p,i,w}: safe version, UUID token, safe
offset, phase, nullable64hex native identity and nullable UUID writer. Worst-case
canonical219 bytes plus128 row allowance<=384. Store ordinal0..127 with parent FK;
derive artifact ID/expected size/SHA from the manifest when returning state.
Initial phase=transferring, offset=0, identity/writer=null. Native guards reject
replacement/deletion/invalid scope or slot bounds; subsequent writer transitions
remain fenced until their separate contract is implemented.

Compact closure/source/binding/header metadata fits the8192 base allowance; keep
canonical closure<=2048 and enforce the bound natively. Do not store another full
envelope. readSource reconstructs it from the sole immutable manifest and closure,
then uses shared semantic validation. load returns compact state, never a second
persisted summary body. Missing source under a valid retained original returns
pending/null; wrong original returns not_found/conflict rather than another scope.

## Discovery and evidence

A dedicated indexed output_pending obligation survives physical execution release.
Scan acknowledged records, including blocked NULL-authority records as unbound.
Capture a fixed upper (queue_order,attempt_id), page by that keyset and installation/
output-specific cursor, and stop at its end. No whole-history scan or terminal/refund
mutation is introduced here. Future settlement alone will clear that obligation.

Actual metadata worker proof: exact original pins and negative cross-scope/physical/
installed identity; valid and one-byte-short combined allowances; result-before-
manifest and manifest-before-result snapshots; event/adoption serialization; native
slot/header bounds and unsafe integers; lost COMMIT reply/reopen with identical
manifest, closure and tokens; finite-upper indexed discovery including released
and unbound originals. Inspect durable rows/counters as well as returned values.
