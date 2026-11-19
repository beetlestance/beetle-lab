# Run lifecycle

The browser enqueues and cancels runs; the backend metadata worker
(`app/src/adapters/outbound/sqlite/`) owns run, attempt and receipt state and merges
agent snapshots; the agent journal (`agent/src/journal/`) owns admission and stop
facts. Wire shapes live in `contracts/api/v2/` and `contracts/runner/v1/`.

## Run states

| State | Entered by | Owner |
| --- | --- | --- |
| `queued` | Enqueue transaction | `sqlite/runs.ts` |
| `dispatching` | First claim (possible delivery) or merged `offered` snapshot | `sqlite/dispatch-claims.ts`, observation |
| `active` | Merged `admitted`, `preparing`, `running`, `stopping` or `collecting` | `sqlite/dispatch-observations.ts` |
| `finalizing` | Merged `lost`/`exited`, or final admission `rejected`/`released` | observation |
| `cancelled` | Cancel of provably unsent work, or finalization | `sqlite/run-cancellations.ts`, output finalization |
| `finished`, `errored` | Finalization from verified result and stop evidence | output finalization |

- Nonterminal runs carry outcome `pending`. Observation never sets outcome or
  validation; it only selects the state above (`app/src/domain/runs/index.ts`).
- Terminal runs (`finished`, `cancelled`, `errored`) never reopen. Later private
  evidence may advance without changing the public Run or its version.
- `Run.version` increments only when the public Run changes; safe-integer
  overflow aborts the whole transaction.
- `validationStatus` starts `pending`. Structural preflight at enqueue is not engine
  validation; semantic validation runs under agent admission
  ([decision 007](../../decisions/007-admitted-validation.md)).

## Intake

`POST …/workspaces/{workspaceId}/runs` (body at most 64 KiB, route and body scope
must match) returns 202 only after the receipt transaction commits. The request
names a saved revision, engine profile, budget, execution policy (`parallel` or
`isolated`) and optional initial note; it carries no configuration, image, capability, path, credential or
environment. GET detail and list are observational and never start work; a scope
mismatch is a scoped not-found, and pages hold at most 100 items.

History supplies optional parallel `contexts`: run/suite/revision IDs, the current
suite name and immutable revision ordinal. One bounded scalar join inside the same
read transaction supplies at most 100 entries; no configuration is read. Schema,
digest and exact page ownership are checked. Missing/corrupt joins fail the read.
Clients reject misaligned metadata; omitted enrichment stays explicitly unknown.
Optional workspace names come from that transaction’s validated workspace guard.
[Optional counts](history-counts.md) share the snapshot without changing run admission.

One immediate transaction in the metadata worker, receipt first:

1. Look up the workspace `requestId` receipt before reading settings, profiles or
   capacity. Equal digest returns the original snapshot and original IDs; a changed
   digest or another operation under the same ID conflicts. The digest covers the
   operation and validated request, excluding allocated IDs and time.
2. Verify workspace, revision and every published input pin; read the immutable
   configuration from the revision.
3. Resolve installation, organisation and workspace settings against installed policy.
   Budget/profile must fit installed ceilings; unknown or reduced live capacity queues until dispatch.
   The three settings versions and [requester label](authoring.md#run-requester) are snapshotted into the run.
4. Bind the trusted installed profile to the revision engine and config version,
   then build the complete immutable Offer. Its `intentDigest` is canonical JSON
   of the Offer without that field, prefixed `beetle-lab.run-offer.v1\n`; secrets
   are referenced, never resolved.
5. Check the installation queue bound, then insert run (`queued`, version 1),
   attempt 1, execution intent (immutable queue order and logical cost), cleanup
   control and dispatch outbox. The outbox references the attempt's single stored
   Offer copy. A supplied non-null note is normalized and inserted at note version 1
   with its search postings inside this transaction; it never enters the Offer.
   Omitted/null notes remain unwritten (version 0). Any note failure rolls back admission.
6. Store the original Run reply in the receipt and commit. No HTTP, file or agent
   call happens inside the transaction.

The queue bound is a trusted installation option (default 256, range 1 to 4096)
counting nonterminal runs and export jobs together through indexed pending
projections; a full queue returns `queue_full`. The profile registry holds at most
32 profiles in 32 KiB and is empty by default, which refuses enqueue but keeps
replay and reads. Offer at most 2 MiB, configuration 1 MiB, Run snapshot 64 KiB.
A refusal leaves no run, attempt, outbox or receipt row. A lost 202 may only replay
the identical request. Intake never reopens a run and no transport retry creates a
new attempt.

## Observation merge

`mergeAttemptObservation` (`app/src/domain/runs/`, shared owner
`app/src/domain/attempt-observation/`) is pure: snapshot at most 73728 bytes,
input envelope at most 148608 bytes, exact identity and generation 1.

- State, phase, result and first public exit are atomic with agent `lastSeq`.
  At equal `lastSeq` snapshots must be canonically equal; a difference fails.
- Across sequences the later projection wins, validated for forward consistency
  in either arrival order. Result and exit never change or disappear; phase never
  rewinds; `offered` follows nothing; `admitted` follows only `offered` or
  `admitted`; `stopping` → `lost` | `exited`; `lost` → `exited`. Active states are
  not ranked: `running` → `preparing` is legitimate. Wrapper phase and result may
  still arrive after a terminal state.
- Each snapshot needs `retainedStartSeq ≤ lastSeq + 1`, checked without overflow. An
  older reply never adds a witness that the retained higher-sequence snapshot lacks.
- Independent facts: remote cancel flag ORs inside the snapshot; retained-start
  cursor takes the maximum; admission merges by its partial order below.
- Public `cancellationRequested` stays backend user intent; the remote flag (also
  set by system stops) is separate. `systemStopReason` is immutable (including null) and can arrive at the same sequence.

The `observe` transaction requires a prior possible-delivery record and matching
journal authority, stores generation 1 and the merged snapshot, projects the Run,
then deletes the outbox. It clears `executionCharged` only on matched admission
`rejected` or `released`; that cannot be recharged and output allocation stays
charged. It never ACKs events or finalizes (`app/test/storage/dispatch-observations.test.ts`).

## Admission evidence

`AttemptSnapshot.admission` (`contracts/runner/v1/attempt-admission.schema.json`) is
projected by the journal from the same command as the snapshot, never defaulted:

| State | Meaning |
| --- | --- |
| absent | No tracked admission facts; grants nothing |
| `queued` | Owned queue record pending, no reservation |
| `charged` | Active durable reservation for generation 1 |
| `rejected` | Queue closed with a final policy reason (including `cancelled`), no reservation |
| `released` | Reservation irreversibly released: `never_started` or `settled` |

Partial order: absent → `queued` → `charged` → `released`, or `queued` → `rejected`.
Missing or earlier facts never erase known ones; incomparable pairs or conflicting
reasons fail closed; a final fact may arrive first.

- `never_started` requires no create token, start token or runtime ID, with abort
  and launch closure recorded. `settled` requires definitive launch settlement plus
  runtime stopped or absent and collection finished or failed.
- Timeout, 404, terminal events, snapshot state or cancellation alone never release.
- A final policy refusal (`agent/src/journal/admission-refusal.ts`) atomically stores the
  original Offer and a closed queue row with its decision before returning: no pending
  slot, reservation, event, staging or launch. The snapshot reader validates both before
  commit, so an unrepresentable fact or later write failure rolls back both. A candidate
  that cannot be projected is rejected without being persisted.
- A rejected Offer replay cannot re-enqueue; pending-queue cancellation is a final
  rejection; cancelling a charged reservation stays charged until release.
- Release is about execution admission only; it never proves result completeness
  and never authorises evidence deletion. Rejection or `never_started` proves no
  engine launched, which finalization may use; it never means pass.

## Cancellation

`POST …/runs/{runId}/cancel` (`CancelRunRequest`: scope, `requestId`) returns 202
with the Run. It records monotonic intent without an expected version; acceptance
never claims physical stop.

| Case | Result |
| --- | --- |
| Terminal | Unchanged; outcome never rewritten |
| Provably unsent: one attempt, outbox `possible_delivery=0`, no generation, execution record or output allocation | Outbox deleted; `cancelled`/`inconclusive`, reason `cancelled`; validation preserved |
| Otherwise | `cancellationRequested=true`; bindings, charges and result custody retained |
| Already requested | No version change |

Agent side: `cancelOriginal` (`POST /runner/v1/attempts/{attemptId}/cancel-original`,
body the exact Offer) shares Offer ingress slots and limits. One journal transaction
stores or matches the Offer, persists cancellation and first cause, and, only if it
inserted the receipt, an immutable `cancelled_originals` marker projecting admission
`rejected`/`cancelled` with no queue, reservation or launch. A later identical PUT
returns that receipt. If PUT won first, execution may exist and stays charged until
release. Unknown-route responses from older agents retain uncertainty; no PUT fallback.
A marker found alongside any queue entry, reservation, event or native evidence means
the journal is corrupt, and the read fails closed (`agent/src/journal/fresh-refusal.ts`).
The marker lives as long as its receipt, so pruning never lets the Offer be admitted
later; an older receipt without admission facts stays unknown and never gains one.

## Pinning

`POST …/runs/{runId}/pin` and `…/unpin` (`RunPinRequest`: scope, `requestId`) return
200 with a `RunPinReceipt` (`pinned`, and `pinnedAt` when pinned). The server clock
stays outside the intent digest, so a replayed `requestId` returns the first receipt.

| Case | Result |
| --- | --- |
| Pin a pinned run, unpin an unpinned run | No-op success with the current state |
| Nonterminal run (including `finalizing`) | 409 `conflict`, reason `active` |
| Run already admitted for removal | 409 `conflict`, reason `cleanup_in_progress` |
| 256 pins already in the workspace | 409 `conflict`, reason `pin_limit` |
| Manual delete of a pinned run | 409 `protected_dependency`, reason `pinned` |

Reads return `pinned` and `pinnedAt`. Pin, unpin and removal admission serialize in
one metadata write transaction ([storage](storage.md#atomic-operations)); historical
mode refuses both routes with 403 and shows backup-time pins read-only.

## Stop reasons

The agent supervision transaction stores the first stop cause: `cancelled`,
`timeout`, `output_limit`, `artifact_incomplete` or `clock_integrity`. A command may
name a reason only with `cancel: true` (otherwise `invalid_input`); without one the
cause is `cancelled`. A control-intake or checkpoint failure requests
`artifact_incomplete`, never a user cancellation. First cause
wins across repeats, races and restart. `stop_immediate` is sticky and can escalate
a graceful user cancel without changing attribution. `cancelRequested` means any
stop was requested, not user cancellation. Runner HTTP cancel supplies only
`cancelled`; `InstallationController.stop` takes the system causes. User cancel and
timeout get graceful stop; output and artifact causes kill immediately; clock
integrity forces emergency kill. Final outcome uses verified result, runtime
evidence and the durable cause, never the `cancellation.requested` event alone.

Dispatch, delivery, event custody, agent scheduling, capacity polling and shutdown
ordering are in [run delivery](run-delivery.md).

## Related

- [Run delivery](run-delivery.md)
- [Decision 007: admitted validation](../../decisions/007-admitted-validation.md)
- [Decision 009: result seal](../../decisions/009-result-seal.md)
- [Decision 022: admission evidence](../../decisions/022-admission-evidence-snapshot.md), [023: cancelling an unacknowledged original](../../decisions/023-cancel-unacknowledged-original.md)
- [System overview](../overview.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/runs.ts` | `65bcf86f1368` |
| `app/src/adapters/outbound/sqlite/run-list-context.ts` | `6cd619fdff36` |
| `contracts/api/v2/run.schema.json` | `15d4a6199c19` |
| `app/src/adapters/outbound/sqlite/run-cancellations.ts` | `60e439b897cb` |
| `app/src/adapters/outbound/sqlite/run-pins/` | `5b6f4e05f29b` |
| `app/src/application/runs/pin.ts` | `7883e8e6d0eb` |
| `app/src/domain/runs/index.ts` | `a0f48647f5b4` |
| `app/src/domain/attempt-observation/` | `83555f76b2f3` |
| `contracts/runner/v1/attempt-admission.schema.json` | `b63de455d6f6` |
| `agent/src/journal/cancel-original.ts` | `21cddd6e5807` |
