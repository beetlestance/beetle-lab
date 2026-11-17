# Output collection and transfer

Run outputs cross three boundaries: engine staging to the agent Journal (collection and durable
source), agent to backend (runner source transfer) and backend storage to the browser (artifact
downloads). The agent owns guarding, collection, source commit and the source routes
(`agent/src/collection`, `agent/src/output-source`, `agent/src/journal`, `agent/src/output-transfer`);
the backend owns transfer, native artifact files, publication metadata and downloads (`app/`).
Source values, delivery closure, adoption, finalisation, deletion and settlement are in
[output settlement](outputs-settlement.md).

## Pipeline

Each step needs the genuine output of the step before it. Valid JSON, HTTP 404, a stopped
container, an event ACK, CPU release or a timeout never substitutes for a step.

| Step | Owner | Durable record | Grants | Does not grant |
| --- | --- | --- | --- | --- |
| Live guard | `agent/src/guard`, `agent/src/staging/output-scan.ts` | none | stop request on breach | hard quota, proof the test stopped |
| Control intake | `agent/src/collection/control`, Journal | wrapper checkpoint | `stopped_verified` prefix | release, finalisation |
| Collection intent | Journal 012 `output_collection_intents` | intent: pending, sourced or failed | running the collector | file integrity |
| Collection | `agent/src/collection/output` | none | content and custody observation | authentication, release |
| Source commit | Journal 012 `output_sources` | `PrivateSource`, `SourceReceipt` | finished physical release | publication, deletion |
| Physical release | Journal admission | reservation released, disk hold retained | CPU/RAM/PID/isolation release | disk refund, event closure |
| Delivery closure | Journal 013 | closure with `finalAgentSeq` | source routes | publication |
| Transfer | `app/src/application/output-transfer` | artifact slots, native files | artifact publication | terminal Run |
| Download | `app/src/adapters/inbound/http/run-artifacts` | none | verified bytes of a published artifact | anything else |

## Live output guard

A soft stop, not a hard quota: enumeration is not linearizable and cannot contain a hostile same-UID
writer. Scan and timing limits are in `agent/src/guard/CONTEXT.md`. Each entry charges max(size,
blocks × 512). Exceeding the attempt budget stops that watch; free space at or below the reserve
requests `output_limit` for every watch; staleness, clock failure or rollback requests
`artifact_incomplete`. An incomplete scan is unknown, never a partial total. One stop request per
watch, never retried. A fresh launch waits for the first complete scan; recovered work attaches before
reconciliation and never restages. A watch close never certifies that the runtime exited.

## Control intake and collection

`control.ndjson` frames are UTF-8 `ControlEvent` lines of at most 64 KiB, 65536 records and 64 MiB
per file (`agent/src/control-protocol/types.ts`); agent enrichment adds 512 bytes and public batches
stay at 100 records / 256 KiB. A live torn tail waits; a stopped torn tail fails. The checkpoint
(device/inode strings, offset, wrapper sequence, prefix SHA-256, batch digest) commits with its batch,
projections and quota charges in one transaction. Stopped collection rehashes the full prefix.

Collection (`collectOutputs`) starts only after stopped runtime, settled launch, `stopped_verified`
intake and a committed collection intent.

- `engine-result.json` is at most 1 MiB raw and must match its content seal, scope, installed engine
  and the journaled result. The seal is not a raw-file digest.
- Each declared artifact is streamed in 64 KiB windows and must match its declared length and
  SHA-256. IDs and paths are unique after case folding; reserved names and aliases reject. Root and
  ancestors, owner, 0700 directories, 0600 single-link files and stable identities are checked
  before and after reads, and by name again after every descriptor close.
- `verifiedBytes` = raw result + `controlBytes` + declared artifact bytes ≤ admitted output budget;
  undeclared files are the guard's concern. One call gets ≤ 5 min (`OUTPUT_COLLECTION_MAX_MS`), no retry.
- Success adds immutable `custody`: `resultFileBytes` (1–1048576), `controlBytes` (0–67108864) and the
  root identity (directory ≤ 4096 bytes, uid, device, inode, `modifiedNs`, `changedNs`, native values
  as decimal strings) within 32 KiB, published only after every read and close succeeds and the
  final cancellation and deadline fences pass. It is an observation, not authentication.
- `k6-diagnostics.json` is an ordinary declared artifact: ≤ 256 enum records in 32768 bytes, no native text.

## Native output custody

| Owner | Limit |
| --- | --- |
| Output-native registry (`agent/src/collection/native-custody`) | 4 lifetimes: collection ≤ 2, range ≤ 2, cleanup ≤ 2 borrowed from free credits |
| Agent source routes | 2 source originals, each with one of 32 server request slots, reserved before body parse |
| Backend runner client | source calls use at most 2 of the 8 ordinary gateway credits |
| Backend byte store (`app/src/adapters/outbound/files/outputs`) | 2 jobs, one original per upload token |
| Transfer owner / output runtime / downloads | 2 run transfers / 2 active bindings / 1 HTTP download, no queues |

- Capacity is reserved before input capture; refusal issues no filesystem call. Readers overlap;
  cleanup excludes any owner bound to an equal, ancestor or descendant directory and any unbound one.
- Cancellation and deadlines are stop hints: every issued open, read, write, sync and close stays
  owned until it settles. A failed close is sticky: owner, scope, slot and credit stay held until
  process exit and no positive result follows.

## Collection intent and source commit

The controller persists an intent, collects, commits the source, then releases with the receipt
(codecs `agent/src/output-source`, storage `agent/src/journal/output-source*.ts`). The six operations
are controller-only, share two large-original credits and do no file or network work in a transaction.

| Operation | Wire contents, UTF-8 cap |
| --- | --- |
| `outputCollectionBegin` | canonical `CollectionIntent`, 32768 bytes |
| `outputCollectionRead`, `outputSourceRead` | owned Scope; reply value or null |
| `outputSourceCommit` | `PrivateSource` prepared by the parent, 131072 bytes; the worker re-verifies it |
| `outputSourceRelease` / `outputCollectionFailed` | `SourceReceipt`, 1024 bytes / `FailedOutputCollection`, 8192 bytes |

Charges: intent canonical bytes + 256 (≤ 33024, `collection_bytes`) and source canonical bytes + 256
(≤ 131328, `source_bytes`). Each is zero exactly when its row is absent, counts in every quota
preflight and SQL sum, and is never refunded by ACK or pruning. Rows, digests and charges reject
UPDATE, REPLACE and DELETE, including with recursive triggers off.

- The intent binds a stable `collectionId`, `SourceBinding`, the checked root identity, the exact
  wrapper checkpoint, the definitive launch settlement and the stopped runtime evidence, with
  `begunAt` ≥ runtime observation > launch settlement.
- Commit requires the matching pending intent, `collectionId` = `release.collection.evidenceId`,
  identical root, checkpoint, launch and runtime, checkpoint offset = `controlBytes`, wrapper sequence
  = accepted high-water and the full result equal to the journaled one. The source row and pending →
  sourced commit together. A first source needs an active charged reservation.
- Finished release requires the exact receipt; it reuses the stored release observation and moves the
  disk hold active → retained in the same transaction. Ordinary release rejects finished collection,
  and rejects failed release while an intent exists.
- Only the uninterrupted controller may mark an intent failed: after all originals quiesce, before any
  success or commit attempt, in the same worker epoch (random per open, not Journal authority). A
  recreated controller is always in recovered mode. A commit or quota failure is never relabelled failed.
- Lost replies replay the captured request and return the same record without a second charge.

| Source | Intent | Meaning and permitted action |
| --- | --- | --- |
| present | sourced | Committed: reuse its receipt and release; never recollect |
| absent | pending | Unresolved. After old owners quiesce, one artifact-only recovery collection under a fresh ≤ 5 min budget reuses the intent; failure stays pending, charged and visibly errored |
| absent | failed | Committed failed release; replay only |
| absent | absent | Never began (new-protocol rows only); failed release needs stopped and quiescence proofs |
| any contradiction | any | Unavailable and charged |

Restart reads the source, then the intent, before any recovery, restaging or launch. No TTL, 404 or
elapsed execution deadline grants release.

## Source transfer

`GET /runner/v1/attempts/:id/source` (reply ≤ 75776 bytes), `POST …/source/chunk` (body ≤ 1024,
reply ≤ 90112 bytes) and `GET …/source/absence` (reply ≤ 2048 bytes) use bearer authentication, scoped
headers, exact attempt and physical authority and `Connection: close`. Values are defined in
[settlement](outputs-settlement.md#public-source-values).

| Condition | Status, reason, retry |
| --- | --- |
| Known original whose source or closure is not yet durable | 409 `source_pending`, transport |
| Durable source-free closure | 409 `source_absent`, never |
| Missing, mutated or unusable native file; other unavailable source | 409 `source_unavailable`, never |
| Wrong source, manifest or artifact selector / malformed or beyond-end range | 409 `conflicting_digest` / 400 `invalid_protocol` |
| Unknown original / physical mismatch | 404 `attempt_not_found` / 409 `authority_mismatch` |
| Intake saturated | 429 `budget_unavailable`, transport |

- A chunk names one declared artifact, an offset and a length of 1–65536; offset = total bytes returns
  empty base64 with `eof` after a real checked open and close. Paths are never accepted.
- The range reader pins the stored root tuple before any payload read and through the final checks.
  Same-size mutation between reads can change bytes, so chunks are provisional until the backend
  verifies the whole-file SHA-256. A disconnect or deadline never releases an issued read or credit.

## Backend artifact files

The output runtime (`app/src/bootstrap/output-runtime`) opens before capacity is advertised and owns
`dataRoot/outputs/{staging,published}` plus the SQLite lease `namespace.sqlite`, created only fresh.

- Paths derive only from organisation/workspace/run/attempt/upload-token UUIDs, never engine paths.
  Expected length and SHA-256 come from the adopted manifest.
- `prepare` reconciles the existing token or creates an empty staging file for fresh state only; it
  never truncates an unexplained tail. `append` takes 1–65536 bytes at exactly the durable offset,
  compares any overlap and writes the suffix. Per-operation deadline ≤ 300000 ms.
- Publication is a no-overwrite hard link, verified two-alias custody, then staging unlink: one inode
  charged once. Receipts need full length and SHA-256, file and parent flushes, successful closes and
  post-close named checks. A changed published file is never rehashed into a new receipt.

| Writer transition | Precondition | Effect |
| --- | --- | --- |
| `claimArtifact` | transferring, writer null | set UUID writer |
| `recordProgress` | same writer, native receipt | store identity, monotonic offset ≤ expected |
| `beginPublication` | same writer, full offset, staging identity | transferring → publishing |
| `recordPublication` | publishing, published native receipt | published identity, writer null |

Each write needs the exact slot version and advances it by one; equal replay returns current state.
Guards (backend migration 010) reject phase regression, offset reduction, writer replacement and
DELETE/REPLACE; elapsed time never steals a writer. The transfer owner fences an artifact's producer
before publication, awaits native result and settlement before recording it, and reports published
only when every declared artifact is published with no writer. The runtime then finalises
([settlement](outputs-settlement.md#source-backed-finalisation)); pending or a version conflict leaves
the attempt discoverable for a later pass, with no new test effects.

## Artifact downloads

`listRunArtifacts` (`/runs/:run/attempts/:attempt/artifacts`, limit 1–100, cursor ≤ 512 bytes, reply
≤ 73728 bytes) reports `ready` only with a matching finalisation and fully published slots, `absent`
with no items after source-free finalisation, otherwise `pending`. The requested attempt is used even
when another is active. GET has no write, ACK or accounting effect.

The content route (`…/artifacts/:artifact/content`) needs the local session guard, five UUID
parameters, no query or body and at most one byte range (416 if unsatisfiable).
`contracts/src/artifact-download.ts` fixes the attachment name and media type by kind. One native range
job, 30 s deadline; EOF follows the native result, settlement and post-close checks, and full reads
also match the SHA-256. Midstream errors destroy the response. Busy defers publication, never fails it.

## Storage accounting

Backend allocation (`app/src/adapters/outbound/sqlite/output-reservations.ts`) charges each claimed
original `Offer.budget.outputBytes` + 65536 metadata (+ 65536 cleanup control, see
[retirement](retirement.md#capacity)) to `installation_storage_usage`, requiring usage + charge +
reserve ≤ min(installation storage, source ceiling). Physical release and lower settings keep it.

Agent disk holds (`agent/src/journal/disk-retention`, Journal 011): one immutable hold per admitted
original records output and staging bytes plus 512 metadata bytes. Release and abort move both into
retained totals once; only [settlement](outputs-settlement.md#settlement) removes a hold.
`DiskRetention` reports held count (≤ 4096) and output, staging, replay and cleanup bytes. Admission
fits active + candidate + retained disk; only active work counts for CPU, RAM, PIDs and isolation. A
full hold count defers with `retention_capacity`, disk pressure with `budget_unavailable`.

The staging namespace (`agent/src/staging-namespace`, Journal 016) binds root identity and a nonce
marker (change requires recovery); task directories are committed before any provider writes.

## Related

- [Output settlement](outputs-settlement.md) and [retirement](retirement.md)
- Decisions [006](../../decisions/006-agent-staging.md), [009](../../decisions/009-result-seal.md), [027 collection recovery](../../decisions/027-conservative-collection-recovery.md), [028 native diagnostics](../../decisions/028-enum-only-native-diagnostics.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `agent/src/collection/` | `99495d3544f4` |
| `agent/src/journal/output-source-protocol.ts` | `abf27b5726ea` |
| `agent/src/transport/sources.ts` | `2d8d61a92c3b` |
| `app/src/ports/output-bytes.ts` | `0fb052d91eac` |
| `app/src/adapters/outbound/sqlite/output-artifacts/` | `d1a175d8859e` |
| `agent/src/guard/` | `a02c2f2011b4` |
