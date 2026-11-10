# Durable output collection intent

Status: reviewed contract/types and locally verified stopped-root producer;
durable gate/controller wiring remains required. Extends [source commit](output-source-commit.md). This gate distinguishes interrupted source collection
from collection that never began. It does not establish file integrity or outcome.

## Before collecting

After a definitive launch settlement, known runtime stop and stopped control-prefix
verification, persist an intent before invoking the output collector. The existing
control file owner must additionally capture immutable OutputRootIdentity from its
checked directory descriptor. Extend only stopped_verified ControlReadValue with
required root:OutputRootIdentity; live/provisional values cannot carry it. The
controller waits successful original reader close and final named-root checks
before submitting that snapshot. Reuse one shared root-fact capture/type owner for
control and output collection rather than adding a second filesystem verifier.

| CollectionIntent field | Exact value |
| --- | --- |
| version | 1 |
| collectionId | Canonical UUID captured once before first intent issue |
| binding | SourceBinding from the source commit contract |
| root | Actual checked OutputRootIdentity, not just a path or desired plan |
| checkpoint | Exact owned WrapperCheckpoint from stopped control verification |
| launch | Exact definitive stored LaunchSettlement |
| runtime | Existing ReleaseEvidence.runtime, state=stopped/source=supervisor |
| begunAt | Safe wall-clock integer, >=runtime.observedAt>launch.settledAt |

Root path/uid also match the original prepared runtime mount; root identity cannot
be replaced by current catalogue defaults or a newly created same-name directory.
Use existing closed capture/UUID/checkpoint/scope/launch codecs and the source
contract's independent serialization limits. Intent canonical JSON<=32768 UTF-8
bytes, including root, with depth<=64 and nodes<=65536. No unbounded Offer/config
or separately duplicated artifact list is retained in this intent.

## Private Journal operations

`beginOutputCollection(intent: CollectionIntent): Promise<CollectionIntent>`.
`readOutputCollection(key: Scope): Promise<CollectionIntent | null>`.
The controller holds one stable collectionId, root/launch/checkpoint observation
and runtime evidence ID across an ambiguous begin reply. Begin validates opened
UUID, original pins, active reservation, retained hold, settled launch, exact
checkpoint and journaled result in one immediate worker transaction. Exact replay
returns the same intent; differing replay conflicts. It performs no file IO.

One output_collection_intents row per attempt FK-binds the original, stores the
canonical immutable intent JSON, phase pending/sourced/failed, charged_bytes and
created_epoch. created_epoch is the Journal worker's random per-open UUID; the
worker supplies it, never a caller field. It is not physical journalAuthority and
never survives an owner restart as an active epoch. Reads need not expose it.

Charge intent JSON bytes+256, maximum33024. accepted_attempts.collection_bytes is
zero iff no intent, otherwise equals that immutable charge. Include it alongside
source_bytes and hold_bytes in every journal quota preflight and SQL sum check.
Intent row/charge/phase guard atomically; deny arbitrary UPDATE/REPLACE/DELETE and
counter forgery, including recursive triggers off. Terminal phase does not refund
metadata or disk promises. Fresh insert cannot adopt an already released original.

## Source commit and ordinary failure

CollectedSource additionally requires collectionId. Commit requires the matching
pending intent, exact binding/root/checkpoint/launch/runtime identity and
release.collection.evidenceId=collectionId. Set collection.observedAt only after
the actual successful collection quiesces, >=begunAt and >launch.settledAt. Root
and output facts must agree with the intent; any intervening root change refuses
source creation. Successful source insertion and intent pending->sourced occur in
the same immediate transaction with their exact immutable charges. Exact source
replay remains available after phase sourced and execution release.

The uninterrupted trusted controller may close a genuinely failed collector only
after all original IO/closes successfully quiesce, before any successful collection
or source commit attempt. Add a private failed-collection release command carrying
collectionId and normal failed ReleaseEvidence. In one transaction it requires a
pending intent created in this still-live worker epoch and atomically marks it
failed with physical release. A failed close does not satisfy that condition.
The controller retains whether success/source issue occurred; it may never relabel
a source quota/commit failure as a collector failure. JSON cannot prove this trust
condition; no HTTP route or general caller may issue this command.
Reconstructing a controller around an existing intent always enters recovered
semantics, even if its Journal worker/created_epoch is unchanged. Epoch equality
alone never grants the original controller's process-owned failure-close authority.

No-intent failed release is allowed only when source collection never began, for
example no stopped journaled result, and all existing stopped/quiescence proofs
hold. Failed release must never ignore an existing pending or sourced intent.
Already-released historical records replay their existing facts without backfill.

## Restart and ambiguous outcomes

Read durable source first, then the intent, before catalogue execution recovery,
restaging or starting any new original. A committed source wins: use its exact
receipt/release observation; do not recollect or regenerate source identity.

Pending intent + absent source is unresolved collection custody, including both
never-finished collection and successful collection with rolled-back source commit.
It is never automatically collection.failed. After old process/Journal/native
original owners are known quiescent, a serialized source read can permit an
artifact-only recovery collection under a fresh bounded per-operation budget
(<=existing OUTPUT_COLLECTION_MAX_MS), independent of the elapsed execution
timeout. It reuses collectionId/root/checkpoint/launch/runtime observations, verifies
the same stopped control prefix and root through existing file owners, and never
restages inputs or relaunches the engine. Missing pinned roots/profile or unknown
runtime stop makes recovery unavailable, not permission to adopt current values.

Successful recovery can produce a new immutable commit request using the original
intent and newly verified raw file facts. This is the sole explicit exception to
the source draft's no-recollection rule: it requires proven source absence and no
unresolved source write. Source presence or unknown read/commit outcome forbids it.
Repeated failed source insertion retains the same captured request in that owner.

A recovered pending intent whose collection fails or times out stays pending,
charged and visibly errored. It cannot use the uninterrupted-owner failed-close
path: created_epoch differs after Journal recreation. This conservative rule is
necessary because the pre-collection gate cannot prove a previous collector never
succeeded. No TTL, generic404 or elapsed execution deadline grants release.
Pending intent + source conflict/corruption also stays charged and unavailable.

Absent source + absent intent means this protocol never began source collection,
only for new-protocol records; it grants no source authority to old released rows.
An intent with sourced phase must have exactly its corresponding source; failed
phase must have matching physical failed release. Native guards and read validation
refuse contradictions before returning any receipt or granting collection/release.

Acceptance includes intent COMMIT loss/rollback before collector start, source
COMMIT failure after successful real collection, actual owner recreation with an
expired execution deadline, root replacement, failed recovery collection and
recovered successful collection. Inspect actual rows/counters and process/file
quiescence; no successful-source reopen test substitutes for absent-source recovery.
Include controller close/recreation with the same live Journal worker: its pending
intent still cannot turn an earlier successful collection into failed release.
