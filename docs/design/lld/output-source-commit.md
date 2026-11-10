# Durable collected output source

Status: proposed exact private commit boundary; independent review required before
implementation. Extends [verified source](output-source.md), using existing
[collected facts](output-collection-custody.md) and [disk holds](disk-retention.md).
No HTTP transport, file deletion or backend publication is introduced here.

## Ownership and values

The controller alone creates a collected observation after stopped control
verification, stopped runtime observation and successful original reader/collector
closes. A plain object cannot establish those process-owned facts. The private
Journal method accepts data from that trusted owner, never an HTTP DTO. Pure codecs
validate/copy/hash data; journal transactions validate durable original identity.

All objects have exactly the declared own enumerable data fields. Reject symbols,
hidden fields, accessors, unsupported prototypes, proxies/traps that fail capture,
sparse arrays, nonfinite numbers and unsafe counters. Capture owned frozen values
before serialization/await; no mutable caller object enters the worker message.
Reuse existing bounded JSON encoding, result seal, checkpoint and identity codecs.

| Value | Exact fields |
| --- | --- |
| SourceBinding | journalAuthority, organizationId, workspaceId, attemptId, generation=1, intentDigest, engine, installedIdentity, specDigest |
| PublicCore | version=1, binding:SourceBinding, result:EngineResult, resultFileBytes, controlBytes, verifiedBytes |
| PublicManifest | all PublicCore fields plus manifestDigest |
| PrivateCore | version=1, manifest:PublicManifest, root:OutputRootIdentity, checkpoint:WrapperCheckpoint, release:ReleaseEvidence |
| PrivateSource | all PrivateCore fields plus sourceDigest |
| SourceReceipt | version=1, journalAuthority, key:Scope, manifestDigest, sourceDigest |
| CollectedSource | collectionId, binding:SourceBinding, collection:successful OutputCollectionResult, checkpoint:WrapperCheckpoint, release:ReleaseEvidence |

SourceBinding UUIDs/digests and engine/installedIdentity use existing Offer and
authority validators. specDigest is the immutable prepared runtime SHA256.
Root fields/bounds are exactly OutputRootIdentity; checkpoint is an owned existing
WrapperCheckpoint, not a second checkpoint grammar. ReleaseEvidence uses existing
scope/launch/runtime validators with collection.state=finished and runtime.state=
stopped; absent runtime or failed collection cannot create a verified source.

Result-file bytes1..1048576 and control bytes0..67108864 remain raw native counts.
verifiedBytes equals their sum plus all declared artifact bytes, exactly under the
original output budget. Reject arithmetic overflow. Canonical EngineResult remains
<=65536 UTF-8 bytes and<=128 artifacts. Reuse verifyEngineResultSeal and compare its
entire result to the durably journaled result; the seal is not a raw-file digest.

## Identity and bounds

Use existing encodeCanonicalJson: UTF16 lexical object keys, original array order,
finite JSON numbers and no Unicode normalization. Hash UTF-8 with SHA256, lowercase
64 hex. Prefixes include exactly one trailing LF, without a BOM:

- manifestDigest = SHA256(`beetle-lab.output-manifest.v1\n` + canonical(PublicCore)).
- sourceDigest = SHA256(`beetle-lab.output-source.v1\n` + canonical(PrivateCore)).

Only the digest's own top-level field is absent from its preimage. In particular,
sourceDigest covers manifestDigest and both digests cover the complete result seal.
Private runtime IDs, create/start tokens, observation times/evidence IDs, root
paths/ownership and checkpoint identities never enter PublicCore. They remain
covered by sourceDigest. A private custody change can retain the public digest
while changing sourceDigest. Neither digest proves a test verdict or file absence.

PublicManifest <=73728 UTF-8 bytes; PrivateSource <=131072; SourceReceipt <=1024.
Bound original capture before materialization: depth<=64, nodes<=65536, per-array
and object fields<=4096, additionally existing result schema and artifact limits.
Do not stringify unbounded foreign values and check only afterward. Independent
codec vectors must freeze exact preimage bytes/digests, key reordering, non-ASCII
values, array order, raw/canonical result differences and private/public changes
before consumers implement this interface.

## Pure codec interface

[Private types/constants](../../../agent/src/output-source/index.ts) declare the
following functions for the later codec implementation: captureCollectionIntent
(unknown)->CollectionIntent; prepareOutputSource(unknown, ResultDigest)->PrivateSource;
verifyOutputSource(unknown, ResultDigest)->PrivateSource; receiptForOutputSource
(unknown, ResultDigest)->SourceReceipt. Each returns owned recursively frozen data.
These functions grant no durable, filesystem or release authority.

Accepted input grammars are exactly CollectionIntent for capture, CollectedSource
for prepare, and complete PrivateSource for verify/receipt. Receipt creation fully
verifies the source first; it must never extract unchecked digests or scope.
All codecs validate locally available relationships: binding/result/release scope
and generation agree; result.engineId=binding.engine.id; release.specDigest matches
binding.specDigest; collectionId=release.collection.evidenceId on prepare;
checkpoint.offset=controlBytes; verifiedBytes is the exact safe raw/control/artifact
sum. Intent capture also matches binding/launch scope/spec, verifies checkpoint
device=root.device and begunAt>=runtime.observedAt>launch.settledAt. Definitive
launch epoch/startToken shape remains consistent with its disposition. Prepare
checks the complete success/custody envelope; verify rechecks these relationships
from its manifest/root/checkpoint/release and validates both stored digests.
Original budget, durable intent/launch/checkpoint equality, installed authority,
file integrity/quiescence and retained hold permission remain Journal/controller
checks; a pure codec cannot prove them or grant release from a valid digest.

Throw OutputSourceError: invalid_input for malformed fields/bounds/relationships,
integrity for a validly shaped result/manifest/source digest mismatch, digest_failed
for a throwing digest provider or non-lowercase/non-64-hex provider result. Reuse
the result-seal verifier, mapping its errors to these codes without hiding failure.
[Version1 vectors](../../../agent/test/output-source/vectors/v1.json) freeze complete
preimages/digests and lengths for base, key order, private root changes, raw-result
whitespace and artifact order. They are synthetic content facts, not source receipts.

## Private Journal surface

`commitOutputSource(observation: CollectedSource): Promise<SourceReceipt>`.
`readOutputSource(key: Scope): Promise<PrivateSource | null>`.
These use existing bounded original RPC credits, request IDs, worker timeout and
shutdown ownership. They are not admission commands or public HTTP routes.
[Collection intent](output-collection-intent.md) must commit before invoking the
collector; it owns the added begin/read operations and absent-source recovery gate.
The controller captures one immutable request and evidence identity before issue.
After a lost commit reply, read/replay that exact request; never infer a retry of
target execution. Only the intent contract's proven-absent-source recovery permits
artifact recollection. Pending/failed native operations retain owners.

Commit is one immediate worker transaction with no filesystem/network operation:

1. Require matching pending collection intent and collectionId; validate opened
   journal UUID and exact original scope/intent/engine/installed
   descriptor pins, reservation specDigest/create/runtime binding and disk hold.
2. Require a definitive durable launch settlement and compare the release launch
   tuple using the existing release validator. Runtime and collection observations
   occur strictly after settlement, with a known stopped runtime and closed launch.
3. Require the exact stored wrapper checkpoint, offset=collection.custody.controlBytes,
   checkpoint.wrapperSeq=accepted wrapper high-water, and exact stored EngineResult.
   stopped_verified itself remains a controller-owned observation, not a fabricated
   durable flag; a live/provisional reader may not submit this method.
4. Derive/validate both digests from owned data, then store source, source charge
   and intent pending->sourced transition
   atomically. Existing exact source replay returns the original receipt without
   another charge. Same original with any different private source conflicts.

An existing source replay may be read after release and remains immutable.
First creation requires an active charged reservation; old released originals
without a source return null, never derive source authority from snapshots.
readOutputSource selects one bounded record directly, without scanning history,
catalogue resolution, engine restart or execution restaging. Journal UUID rotation
never adopts an older source. Native source-file reopening belongs to later reads.

## Quota and finished release

Reserve the next agent migration only after this contract and vectors are reviewed.
One output_sources row per attempt FK-bound to reservation/original scope stores
canonical PrivateSource JSON, both digests and charged_bytes. No duplicate manifest
or artifact list. The charge is UTF-8 stored JSON bytes+256, maximum131328.
accepted_attempts.source_bytes is zero iff no source, otherwise equals that charge.
Identity/source/digests/charge are immutable; reject UPDATE/REPLACE/DELETE and counter
forgery, including recursive triggers off. No new source enumeration is required.

Add source_bytes and collection_bytes to every spool/snapshot/checkpoint/hold quota preflight
and SQL sum check. Source insert and parent charge rollback together, including
late COMMIT failure. ACK/prune cannot refund source or hold charges. Reads exclude
oversized/corrupt native JSON before it crosses into JavaScript. Revalidate stored
digests and durable scope facts on read; no synthetic zero/success on corruption.

New collection.finished release requires the matching committed SourceReceipt and
the exact PrivateSource.release observation. Capture it once; do not regenerate
evidence IDs/timestamps between source commit, ambiguous replay and release.
Bind receipt outside existing ReleaseEvidence as a separate required private
release-command field when collection.state=finished. collection.failed carries no
source receipt; its intent/no-intent authorization follows the collection-intent
contract and retains both disk holds.
Existing already-released replay remains readable without backfilling a receipt.

A source COMMIT failure cannot be relabeled collection.failed to obtain release.
Keep physical release pending, preserve disk holds and original request, expose the
storage failure, and reconcile exact source state. On restart, an existing source
supplies its original release request/receipt before any recollection or restaging.
For absent source, recover the durable intent instead of converting an expired
deadline into failed release. This grants no publication or native-file refund.

## Required acceptance

Use real stopped control/collector files plus native SQLite assertions for the
connected commit/reopen/replay path. Cover wrong UUID/scope/engine/pins/spec/launch,
checkpoint/result mismatch, provisional reads and held/failed original closes.
Cover exact quota/one-byte short, lowered quota, source mutation/REPLACE/deletion,
oversized native rows, late transaction failure and genuinely withheld worker
reply. Inspect source rows, charges and disk holds independently of returned success.
Finished release must fail on missing/wrong/conflicting receipt without changing
reservation or counters; failed collection retains unknown disk files. Shutdown
must drain issued source originals; no power-loss claim from graceful reopen tests.
