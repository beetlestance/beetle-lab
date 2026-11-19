# Retirement

Retirement removes a performance Run's retained agent output after the backend has
removed its own published files; namespace deletion and workspace retirement are in
[namespaces](namespaces.md). The backend owns deletion intent, request projection, dispatch and ACK storage
(`app/`); the agent owns producer fencing, runtime removal, native inventory, removal
and the cleanup receipt (`agent/`). The wire values live in `contracts/src/output-retirement`.
A pinned Run never gets a deletion intent: Begin refuses it with `run_pinned` ([storage](storage.md#retention-and-space)).

## Authority chain

Each step needs the genuine output of the previous one; a stored row, valid JSON,
HTTP 404, stopped container or timeout never substitutes.

| Step | Owner | Durable record | Grants | Does not grant |
| --- | --- | --- | --- | --- |
| Deletion intent | backend output-deletion metadata | deletion row, file progress | backend file removal | agent absence |
| Request projection | `output-deletion/retirement-request.ts` | none (read-only) | one closed request | dispatch, ACK |
| Retirement intent | agent Journal 017 (`retirement-values`) | immutable request, namespace, task snapshot | durable fence on new producer work | drain, absence |
| Producer barrier | `producer-retirement` + `producer-gate` | none | process-local quiescence token | runtime removal |
| Runtime absence | `runtime-retirement` | runtime association (Journal 021) | process-local `RuntimeAbsent` token | file absence |
| Inventory | `task-inventory` | plan (Journal 018) | opaque post-close observation | deletion permission |
| Native removal | `native-removal` | progress (Journal 019) | one reverse-order step | receipt |
| Cleanup receipt | `native-receipt` | receipt (Journal 020) | `cleaned` reply | ACK, refund |
| ACK | `output-deletion/acks.ts` (backend migration 022) | canonical cleaned reply | input to settlement | refund, purge |

Settlement (tombstone, purge, refund) is a separate transaction after the ACK.
Process-local tokens are bound to one physical Journal, revoked on owner close and
re-established after restart from live ownership and fresh native inspection.

## Agent retirement states

| State | Permitted progress | Forbidden inference |
| --- | --- | --- |
| Retiring | Immutable intent fences source reads, staging, collection, launch, delayed recovery | Caller timeout does not drain an issued original |
| Prepared | Persist the observed native plan before any unlink | A digest recomputed from paths is not custody |
| Cleaning | Replay that exact plan, one entry per progress version | A missing entry without its plan is not absence |
| Cleaned | Receipt committed after all original closes and current absence | Receipt alone does not purge or refund |

Progress versions (`agent/src/cleanup-control/progress.ts`): prepared has count 0,
version 1; cleaning starts at count 0, version 2; each version removes exactly one
entry in reverse plan order (unlink or rmdir, parent fsync, cached close);
`files_absent` has the full count and version count + 2 (maximum 514). Exact replay
is idempotent; skips, rollback, foreign plan and premature closure reject.

One retirement per original attempt: the same request replays; a changed deletion,
purpose, closure or namespace conflicts; transport failure never adds a generation.

## Messages

Schemas, canonical digest and byte caps: `contracts/src/output-retirement`.

| Value | Bound | Invariant |
| --- | --- | --- |
| `OutputRetirementRequest` | ≤3072 UTF-8 bytes | Protocol 1, performance purpose, generation 1, deletion version 1; source closure (source and manifest digests, final sequence) or absence closure (proof digest, final sequence) |
| `OutputRetirementReply` | ≤4096 UTF-8 bytes | `pending` or `cleaned`; echoes every request identity and the digest of the complete request |
| Cleaned extras | 64 lowercase hex each | `namespaceIdentity`, `preparationIdentity` (= agent task namespace identity, not the backend file-preparation commitment), `cleanupReceiptDigest` |

- No path, filename, artifact list, quota or quiescence flag; original attempt and
  Journal authority spelling preserved exactly, backend UUIDs canonical.
- Reply capture recomputes the request digest (trusted injected SHA-256) and compares
  every field; generated client shape validation is insufficient.
- `pending` forbids cleaned fields; unknown fields reject. The receipt digest
  identifies a committed receipt, not cryptographic IO proof.

## Transport

| Side | Behaviour |
| --- | --- |
| Agent route `POST /runner/v1/attempts/{attemptId}/output-retirement` (`agent/src/transport/retirement.ts`) | Bearer auth, scoped organisation/workspace/generation headers, path/body binding; body `journalAuthority` must equal the current physical authority |
| Agent budget | Takes one of the two shared source-operation slots and the 30 s request budget before body intake; waits for result and settlement |
| Agent status codes | 200 pending/cleaned; 400 invalid input; 409 conflict or authority mismatch; 429 capacity; 503 unavailable; 500 malformed producer reply |
| Backend gateway (`app/src/adapters/outbound/runner/retirement.ts`) | Shares the runner gateway's origin, token and two source credits; fixed 5 s deadline including DNS; reply read ≤4096 bytes; non-200 or redirect yields no evidence |

Disconnect, deadline or abort never releases an issued original: slot and credit
stay held until service settlement and socket closure. Without validated evidence
the call fails and a later tick reuses the same durable request; no compensation.

## Agent pipeline

`agent/src/retirement-pipeline` composes producer, runtime, inventory, removal and
receipt owners against the exclusively opened Journal.

1. Reserve one of at most 2 pipeline entries before capturing input; at capacity it
   refuses even a duplicate. Same scope and digest share the original work.
2. Snapshot one fixed ≤30 s budget, rechecked after every helper and before each phase.
3. Await producer retirement result and carrier settlement; require the genuine barrier.
4. Remove the runtime, then read the stored plan; only if absent, inventory and persist.
   A partially removed task never yields a fresh plan.
5. Perform at most 16 reverse-plan steps per tick (configurable 1–16), then reply `pending`.
6. Only after `files_absent`, finalise the receipt with a fresh native absence check
   (also on replay) and reply `cleaned`.

Conflicts, corrupt state, deadline and cancellation fail, never `pending`; no
background continuation. Shutdown awaits issued calls, refuses unknown retained
entries, then closes receipt, removal, inventory, runtime and producer owners.

An operator-only reconcile entry, never coalesced with a tick, handles a prepared task whose
folder facts went stale after a renumbered root ([decision 030](../../decisions/030-task-folder-reconciliation.md)):
producer and runtime retirement, refusal once settled or once any plan exists, an inventory-style read
under the live root with unchanged owner, group and mode, then Journal 027 `reconciliation_json`, which
later plans must match; no plan, removal or receipt. Operators run the agent entry with `reconcile [--apply]`
offline in a one-off container named as the agent: same process owner, no server or scheduler.

## Fencing and ordering

- Producer gate (`agent/src/producer-gate`): one gate per Journal shared by
  installation, Stager and output reader; ≤64 entries and ≤64 leases. A read lease is
  acquired before the first await, then the durable gate and local fence are checked
  before native IO. After restart the Journal intent, not an empty set, excludes reads.
- Producer retirement (`agent/src/producer-retirement`, ≤64 originals): one ≤30 s
  monotonic budget starts before preflight. The local gate is fenced before begin is
  awaited; once begin is issued, a failed or unknown commit keeps intake fenced until
  actual carrier settlement and exact status reconciliation. Failed close is sticky.
- Runtime retirement (`agent/src/runtime-retirement`, ≤64 attempts): binds the original
  runtime ID before observation, freshly qualifies the installed daemon, deletes only
  that ID with `force=false`, `v=false`, then confirms ID and name absence. Same-name
  replacement, renamed original, running/paused/unknown state or changed daemon refuse.
  Never-started originals need positive no-token/no-runtime facts and issue no mutation.
  A mailbox volume is removed only with a persisted runtime association; a cold
  missing container with an unassociated volume stays unresolved.
- Retirement intent (`agent/src/journal/retirement/eligibility.ts`): begin needs
  performance purpose, the current Journal authority, control version 1, a released
  admission reservation, a bound installed namespace and a matching closure whose last
  sequence equals `finalAgentSeq` and is acknowledged; a changed source root or task
  anchor is `recovery_required`. Preflight and begin share one validator; begin never
  relies on preflight.
- Durable SQL guards fence admission, preparation, launch, collection and source
  publication after the intent; read-only replay and observation stay available.

## Native limits

Owned by `agent/src/cleanup-control/limits.ts`; enforced by `task-inventory`,
`native-removal` and the plan codec.

| Limit | Value |
| --- | --- |
| Plan entries (including task root) | 512 |
| Path depth / relative path | 32 levels / 4096 UTF-8 bytes |
| Canonical plan | 128 KiB |
| Progress / receipt value | 8192 / 4096 bytes |
| Read window / issued operation | 64 KiB / 30 s |
| Inventory descriptors / cached-close records | 71 / 1539 per operation |

Inventory runs on Linux only. It derives the task path from the `RuntimeAbsent` token
and verified installed root (never a caller path), requires all four role folders to match
the anchor (or reconciled) facts and prepared task state, opens through held-parent `/proc/self/fd` paths with `NOFOLLOW`,
compares `mnt_id` to refuse nested mounts, and refuses links, special files, invalid
UTF-8, foreign ownership and unexpected modes (directories 0700, files 0400 or 0600).
Directory size and times are not identity. Over-bound work stays pending and
charged. No atomic snapshot against a privileged host actor is claimed.

## Capacity

Both sides reserve cleanup capacity before admitting work, so a full payload pool
cannot block cleanup. Control data consumes its bucket, never a second charge; this
is logical accounting, not disk or WAL preallocation.

| Reserve | Owner | Size | Taken |
| --- | --- | --- | --- |
| Agent control v1 | `agent/src/cleanup-control/limits.ts` | 196 608 bytes (named buckets 169 984, slack 26 624) | At admission, for performance and export purpose |
| Backend policy 1 | `app/src/adapters/outbound/sqlite/cleanup-control` (migration 021) | 65 536 bytes per original | At Run enqueue, before execution intent or receipt |

Backend policy 1 buckets: deletion intent 4096; 128 file cells × 384 = 49 152; ACK
4096 + 512 = 4608; tombstone 2048 + 512 = 2560; ledger row 1024; slack 4096.
The ledger row is immutable; exact replay never charges again. Originals without a
ledger row are positively unreserved and need explicit `reserveControl` top-up under
current storage policy before deletion preparation, removal or agent retirement.
Insufficient capacity rolls enqueue back or defers cleanup; data and charges stay.
At delivery the claim adds only the control an original still lacks (nothing for a
funded Run, 65 536 bytes for a legacy one); a failed claim rolls back its new output
charges and keeps any earlier enqueue reservation.

## Backend projection, dispatch and ACK

- Projection derives the request inside the deletion transaction from the committed
  row only: all files absent, exact Run version/attempt/closure, one absent record per
  ordinal (≤128), and a contiguous retained event range through the closure's final
  sequence (a row count rejects a missing middle event). Unsent deletions refuse.
- The driver (`app/src/application/output-deletion-runtime`) is one sequential child
  alternating file progress, retirement and settlement turns, each with a fixed 30 s
  budget including discovery. Retirement discovery buffers ≤32 candidates with a
  finite cursor. `pending` defers. Transport failures, timeouts and `retry: transport`
  errors back off from 1 s, doubling to 30 s, reuse the same request and reset after a
  validated reply; any other refusal fails the turn.
- The ACK transaction re-derives the expected request (never a caller snapshot),
  captures the cleaned reply and stores one canonical body ≤4096 bytes per deletion
  (cost body + 512) through a statement-scoped permit checked by an SQL function; raw
  insert, update, replace and delete reject. Identical replay returns the first row,
  any change conflicts, and a lost COMMIT reply is recovered by read and replay.

## Unsent and no-task branches

A proven unsent cancellation (untouched outbox removed, no execution record or
allocation) never calls the agent; a 404 or failed transport cannot prove unsent. Rejected and
never-started originals use separately funded branches (`agent/src/no-task-receipt`,
`agent/src/rejected-cleanup-policy`, Journal 023–024) that verify absence without
unlinking and never borrow the other branch's funding.

## Retired runtime association

Before container deletion the journal commits one immutable record of the inspected
stopped runtime, spec and mailbox volume (≤ 1536 bytes in the 2048-byte bucket of
`agent/src/cleanup-control/limits.ts`); an unknown commit permits no delete. Cold
recovery reuses only an exactly matching record and still proves absence first.

## Related

- [Recovery](recovery.md), [outputs settlement](outputs-settlement.md), [namespaces](namespaces.md)
- [Decision 018: Docker host trust boundary](../../decisions/018-docker-host-trust-boundary.md), [decision 030: task folder reconciliation](../../decisions/030-task-folder-reconciliation.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/src/output-retirement/` | `43a6df3cf8bc` |
| `agent/src/cleanup-control/` | `df348f0e5282` |
| `agent/src/retirement-pipeline/` | `fd680b9ef3ea` |
| `agent/src/transport/retirement.ts` | `01fa56695d4b` |
| `app/src/adapters/outbound/sqlite/output-deletion/` | `9c4e8dc70ef4` |
