# Output finalisation and settlement

After collection, an attempt's outputs are closed, adopted, finalised into a terminal Run, and later
deleted and settled. The agent owns source values, delivery and absence closure and its replay
tombstone (`agent/src/journal`, `contracts/src/output-source`); the backend owns adoption, artifact
slots, finalisation, deletion intents, retention selection and its own tombstone
(`app/src/adapters/outbound/sqlite`, `app/src/application/output-deletion*`). Production and transfer
are in [output collection](outputs-collection.md); agent native cleanup is in [retirement](retirement.md).

## Closure kinds

| Kind | Agent closure | Backend receipt | Retained after finalisation | Permanent floor |
| --- | --- | --- | --- | --- |
| Source-backed | source + delivery closure (Journal 012–013) | `execution_output_finalizations` (backend 011) | C + M + A + 65536 metadata + 65536 control | backend 2560, agent 4096 |
| Source-free | `OutputAbsence` (Journal 014) | absence proof and receipt (backend 012) | C + R + 65536 metadata + 65536 control | backend 2560, agent 4096 |
| Positive unsent | none | unsent witness only | 65536 control | backend 2560 |

C is charged event bytes (canonical + 128 per row), M the manifest, A declared artifact bytes, R the
provisional result (or zero), P the original `Offer.budget.outputBytes`. Receipt families and their proofs
mutually exclude. A missing source never proves absence, and missing evidence never yields a passed Run.

## Public source values

`contracts/src/output-source` owns the public values; `agent/src/output-source` adds the private
ones and re-exports the public types. Runner JSON schemas define the structural shapes.

| Value | Contents | Cap (UTF-8) |
| --- | --- | --- |
| `SourceBinding` | journal authority, scope, generation 1, intent digest, engine, installed identity, spec digest | — |
| `PublicCore` / `PublicManifest` | binding, sealed `EngineResult` (≤ 65536, ≤ 128 artifacts), raw result, control and verified bytes / + `manifestDigest` | 73728 |
| `PrivateCore` / `PrivateSource` (agent only) | manifest, root identity, wrapper checkpoint, release evidence / + `sourceDigest` | 131072 |
| `SourceReceipt` | authority, scope, both digests | 1024 |
| `SourceEnvelope` | manifest, opaque `sourceDigest`, delivery closure | 75776 |
| `SourceChunkRequest` / `SourceChunk` | both digests, artifact ID, offset, length 1–65536 / + `nextOffset`, `totalBytes`, `eof`, padded base64 | 1024 / 90112 |

- manifestDigest = SHA-256(`beetle-lab.output-manifest.v1\n` + canonical(PublicCore));
  sourceDigest = SHA-256(`beetle-lab.output-source.v1\n` + canonical(PrivateCore)). Canonical JSON
  sorts keys by UTF-16 units, keeps array order and applies no Unicode normalisation; digests are
  lowercase hex. Vectors: `contracts/fixtures/output-source/v1.json`.
- Private paths, runtime IDs, tokens and times never enter `PublicCore`; a private change can keep
  the public digest. Neither digest proves a verdict, file custody or absence.
- `verifySourceEnvelope` checks the seal, manifest digest and receipt tuple; callers must still match
  their retained original. Chunks must satisfy `nextOffset` = offset + decoded bytes, `totalBytes` =
  declared bytes and `eof` iff complete; base64 is validated before decoding.
- Errors are `invalid_input`, `integrity` (validly shaped digest mismatch) and `digest_failed`.

## Delivery closure

Source commit and physical release do not close the event stream. `closeOutputDelivery(receipt)` and
`readOutputDelivery(scope)` (`agent/src/journal/output-delivery-protocol.ts`, wire ≤ 1024 bytes) store
`{version: 1, receipt, finalAgentSeq}`; the worker alone captures `finalAgentSeq` from `last_seq`.

- One transaction verifies the source, intent, released reservation with the source's finished
  evidence and disk hold, then inserts the closure and charges canonical bytes + 256
  (`delivery_bytes`, never refunded). Equal replay returns the stored closure without a second charge.
- A closure fences unseen event inserts and changes to sequence, high-waters, result and checkpoint.
  Exact duplicate replay, ACK, pruning and non-event cancellation metadata stay available.
- Indexed `delivery_pending` is set with the source, cleared only by closure. The scheduler's delivery
  lane pages 1–32 below a captured upper ID, sharing 64 drive slots with the charged and queued lanes.
- The Manager closes only after it marks the entry retiring, drains every public lease except the
  closing drive, drains preparation and watch/timeout closes, then rereads and drains the final
  cancellation chain and closes controller and supervisor. An ambiguous or quota-failed close keeps
  the entry fenced; one reconciliation-only drive may later replay the same close.
- Late cancellation on a closed source writes only non-event metadata and starts no native work.

## Adoption

`OutputCustodyStore` (`app/src/ports/output-custody.ts`) runs in the metadata worker, serialised with
event ingest. Before adoption C + S + D ≤ P (S: provisional result carrier); afterwards C + M + A + D ≤ P
(D: any extra persisted copy). The manifest, including its result, counts once as payload. Both the
application preflight and native SQL enforce these sums; no adoption changes the installation charge. One
`execution_output_payloads` row holds a result (≤ 65536 bytes) or the manifest (≤ 73728); an atomic update
replaces the result with its manifest, which is then immutable. The execution snapshot is a result-free
header ≤ 2048 bytes with a monotonic `result_observed` flag. Header-only admission and release updates use
the metadata allowance and succeed even when P cannot hold a result; a result that does not fit refuses
its own transaction without being dropped, enlarging P or acknowledging events.

- Request ≤ 79872, state ≤ 65536, cursor ≤ 1024 bytes, scan 1–32. Adoption validates the envelope
  digest, seal and physical UUID, scope, intent, engine and installed identity against the retained
  original Offer; `specDigest` is opaque authenticated evidence. Case-fold-ambiguous IDs reject.
- One transaction stores the manifest carrier, a compact closure (≤ 2048 bytes) and one slot per
  artifact (version 1, offset 0, transferring, fresh UUID token, ≤ 384 bytes with row allowance). It
  refuses if events are durable above `finalAgentSeq`; afterwards native guards reject such events.
  Equal replay returns the same tokens; different content conflicts.
- The 65536 metadata allowance logically covers 128 slots × 384, binding and cursor 8192, diagnostics
  4096 and auxiliary 4096. Adoption never sets `result_observed`.

## Source-backed finalisation

`finalize` (`app/src/ports/output-finalization.ts`, request and reply ≤ 4096 bytes) is one immediate
transaction with no file or network work. A matching receipt replays even with a stale Run version;
otherwise the current active attempt and expected version are required. Missing prerequisites return
pending; corrupt or contradictory evidence fails. It requires, in order:

1. The sole adopted source, verified against the original Offer and generation 1 binding.
2. `execution_charged` = 0 and released/settled admission. The stop evidence must bind
   exactly to `finalAgentSeq`; a higher header fails before any write.
3. Exactly the manifest's artifact count (≤ 128), all published at declared bytes, identity set,
   writer null. Zero artifacts are valid only with a verified source.
4. Contiguous events with count = durable = full ACK confirmation = `finalAgentSeq`, none above.
5. Retained C + M + A ≤ P in safe integers; persisted cancellation read in the same transaction.

| Evidence (first match wins) | Run state / outcome / reason |
| --- | --- |
| Wrapper OOM | errored / inconclusive / `memory_limit` |
| Durable system stop or explicit wrapper system reason with known exit | errored / inconclusive / that cause (unknown exit stays pending) |
| Persisted user cancellation | cancelled / inconclusive |
| Missing wrapper exit code or OOM flag | pending `exit_evidence` |
| Cancelled wrapper or child, or a stop request, without persisted user intent | pending `exit_evidence` |
| Nonzero wrapper exit | errored / inconclusive / explicit reason, else `engine_crash` |
| Explicit wrapper failure reason at exit 0 | errored / inconclusive / that reason |
| Sealed child error or lost | errored / inconclusive / its reason or `execution_lost` |
| Exit 0, no OOM, no reason, completed child | finished / sealed passed, failed or inconclusive |

A `stop_evidence` wait refreshes the scope-bound snapshot after the agent closes delivery.
The first durable stop leaves the exit witness intact. Completed execution passes validation.
Sealed `invalid_config` fails it. Migration 039 credits P − (C + M + A) once, projects the
Run and closes `event_pending`, fencing events, cursors, slots and snapshots.

## Source-free closure

Journal `closeOutputAbsence(scope)` runs only after the Manager's native retirement barrier and reads
every fact from stored owners. `OutputAbsence` (≤ 2048 bytes) binds scope, intent, physical Journal UUID,
`finalAgentSeq`, rejected or released admission and a reason. Eligible: rejected with no reservation;
never started (no create or start token, reservation aborted); settled with failed collection. Never with
a committed source, pending intent, unknown launch or release, or timeout. Closure charges proof bytes
+ 256, fences later launch, collection and source work, and alone clears indexed absence debt.
`OUTPUT_REJECTION_REASONS` maps cancellation → `cancelled`, `staging_policy` → `setup_failed`,
unsupported, unapproved or unavailable controls → `unsupported_capability` and minimum, ceiling or
impossible request → `budget_unavailable`. A never-started original reports its durable stop reason, else
`setup_failed`; a settled one with failed collection its typed stop or exit reason, else
`artifact_incomplete`. Outcomes are cancelled or errored/inconclusive, never finished: a system cause
wins, then persisted user cancellation. A proof whose only reason is `cancelled` (a runner stop, not user
intent) waits for the backend's persisted cancellation. The backend (`app/src/ports/output-absence.ts`,
≤ 4096 bytes) adopts one canonical proof only if no source, manifest or slot exists, then finalises with
header `lastSeq` = `finalAgentSeq` and full ACK, crediting P − (C + R) once.

## Deletion

`beginOutputDeletion` (`app/src/adapters/outbound/sqlite/output-deletion`, migration 013) admits one
intent per Run: terminal with a matching source or absence receipt, released execution and closed events,
or a positively unsent attempt (no execution, outbox or allocation; missing or legacy rows never prove
it). Begin replay by request receipt precedes version checks. Source intents pin every published slot
(≤ 128). No row, charge or usage changes; the intent excludes new artifact reads, and a reader already
holding a file's token blocks its preparation and removal until the read physically settles.
`files_absent` means only that every captured backend file has an exact receipt.

| File phase | Next step | Rule |
| --- | --- | --- |
| `pending_preparation` | native `prepareRemoval`, then `recordPlan` | Plan binds record, deletion ID/version and namespace; no unlink yet |
| `prepared` | native `remove`, then record the absence receipt | Only the persisted plan; lost replies reuse it |
| `absent` | none | Exact native receipt only |

- Native deletion checks the published identity, inode, size and single link, unlinks through the
  shared checked primitive, fsyncs the parent and confirms absence after every close. Staging and
  unknown files are preserved; a missing file never yields a fresh plan. Bytes cap 8192.
- The driver (`app/src/application/output-deletion-runtime`) is one sequential child of the output
  runtime with one 30 s budget per turn, one intent and one ordinal at a time. Busy defers; permanent
  failures fence and notify. Unknown outcomes reread durable rows; no replacement token.

## Retention selection

`app/src/domain/retention` evaluates one workspace, newest first by `requestedAt` and ID, under the
inherited installation → organisation → workspace policy (manual by default). Age, count and storage
rules form a union; unknown completed bytes poison storage selection only. Active, pinned, protected,
unknown or cleaning work is excluded (pinned Runs still count toward completed and storage figures).

- A preview page reads ≤ 100 Run headers with a stored prefix and reserves 131072 logical bytes (≤ 8
  live pages); the first preview in a workspace pays a permanent 512-byte epoch row. Pages are immutable;
  a preview replays for 15 min. Full slots refuse a new page and never evict an applied one
  (`app/src/adapters/outbound/sqlite/retention-accounting`).
- Apply refuses missing, consumed or expired pages. An expired unapplied preview may be swept, refunding
  only its charge. An applied page stays charged until all members settle permanently, then expires 15 min
  after that is first observed or on acknowledgement; a Run vanishing unsettled is an error.
- A workspace epoch advances on selection-relevant change, including pin and unpin; derived history-cache writes leave it unchanged. Continuation and
  Apply reject epoch or settings-version drift. Apply begins all ≤ 100 captured candidates or none via
  receipt-first Begin, rechecking pins in its admission transaction regardless of the epoch ([pins, parent previews, `driverState`](storage.md#retention-and-space)).

## Settlement

Physical cleanup and accounting are separate. Settlement runs only after the backend stores the
immutable cleaned ACK ([retirement](retirement.md)). Shape, digests, a missing row, 404 or time never
grant a refund; uncertainty keeps all debt.

1. The backend requests agent settlement with the exact `RetirementRequest` and SHA-256 of the
   canonical cleaned reply (`contracts/src/output-settlement`).
2. The agent fences new retirement, inventory, removal and receipt work on that original
   (`agent/src/cleanup-access`: 64 originals, 256 leases, 2 fences) and drains their originals.
3. Journal 022 atomically writes a tombstone (≤ 3584 + 512 bytes), purges the original's rows and disk
   hold and moves 4096 bytes to replay debt; replies bind request, cleaned-reply and tombstone digests.
4. Backend migration 024 requires the terminal one-attempt original with no dispatch outbox row, no export
   job linked to the attempt or its queue order, every backend file receipt, the retained closure and
   events and the cleaned ACK. It inserts its 2560-byte tombstone, purges per-Run rows and credits the
   remaining payload, metadata and control once. Global receipts, revisions, input pins and blobs stay.

Each store has its own transaction; neither infers the other's commit. Recovery finishes from
agent-tombstoned, backend-charged state; lost replies replay from the tombstone, and the retirement
endpoint replays the cleaned reply after compaction. A tombstone fences late Offer, cancel, admission
and producer work; it never re-executes. Counters move by deltas, never history sums. Positive unsent
settles in the backend alone. Rejected never-admitted originals use a 16384-byte funded no-task branch
(Journal 023–025, v2 tombstone, ≤ 64 funded); admitted abort-before-staging uses the v1 hold transfer
(Journal 026). A history job meeting a deleting Run defers 30 s; an exact tombstone marks it retired.

## Related

- [Output collection and transfer](outputs-collection.md)
- [Retirement](retirement.md)
- [Decision 009: result seal](../../decisions/009-result-seal.md)
- [Decision 011: k6 outcome evidence](../../decisions/011-k6-outcome-evidence.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/src/output-source/` | `dd6d7cd8f8e7` |
| `agent/src/journal/output-delivery-protocol.ts` | `23234170ace9` |
| `app/src/adapters/outbound/sqlite/output-finalization/` | `fa47885187b8` |
| `app/src/adapters/outbound/sqlite/output-absence/` | `0f2d925087dc` |
| `app/src/adapters/outbound/sqlite/output-deletion/` | `9c4e8dc70ef4` |
| `app/src/adapters/outbound/sqlite/backend-settlement/` | `7f81a1b56b08` |
