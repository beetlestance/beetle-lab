# Run delivery

The backend metadata worker (`app/src/adapters/outbound/sqlite/dispatch-*.ts`,
`event-custody/`) owns claims, charges and durable event custody; the delivery
runtime (`app/src/adapters/outbound/runner/delivery/`) carries one original Offer or
event batch at a time to the agent over the shared runner gateway; the agent
scheduler and the backend capacity poller run beside it. Run states, intake,
observation and cancellation are in [run lifecycle](run-lifecycle.md).

## Dispatch storage

`DispatchStore` (`app/src/ports/dispatch.ts`) is installation-private: `scan`,
`readOffer`, `claim`, `observe`. `DispatchKey` is the run ID plus the five-field
attempt identity with generation 1. Each method is its own worker transaction.

| Rule | Behaviour |
| --- | --- |
| Discovery | Lanes `queued` and `reconcile`; cursors bind installation, lane and a captured upper order, so arrivals wait for the next pass and blocked prefixes are revisited. Order is the immutable queue order, never `requestedAt`. Discovery grants no authority. |
| Offer read | Returns the stored parsed Offer; it must equal its canonical round trip and exact key. Shares the worker's two large-original slots with suite reads. |
| Claim | `claimed` or `replay` permits a PUT of that same original; `acknowledged` forbids PUT; `blocked` carries a typed `DispatchBlockReason`. |
| First claim | Atomically inserts the execution record with the journal authority UUID from the current capacity observation, reserves run output, sets `possible_delivery=1` with immutable `first_delivery_at`, and moves the run to `dispatching`. Persisted before any PUT. The capacity lease is rechecked before commit. |
| Replay | Once delivery is possible, replay keeps the original charge and Offer and bypasses new-work policy. |
| Uncertainty | Lost reply, timeout, 404, 429 or profile drift never proves absence and never frees charge. `possible_delivery` never returns to 0; an outbox row with a possible delivery is deleted only after a matched observation stores generation 1, a stored generation never rewinds, and active runs and attempts cannot be deleted. |
| Legacy | Records without a journal authority or execution intent block all fresh claims with `ownership_unknown`; nothing adopts or recreates them. |

| Limit | Value |
| --- | --- |
| Scan page | 1 to 32 items, reply at most 64 KiB, cursor at most 1024 bytes |
| Offer read reply | 2 MiB Offer plus 64 KiB envelope |
| Claim request and reply | 64 KiB |
| Observe request / reply | 75776 bytes (snapshot 73728 + 2048) / 1 MiB |
| Active execution charges | 64 |
| Pending rows read per claim | 4096 |

### Capacity and isolation at claim

- Ceilings are `min(installation policy, runtime observation)`; the registry
  binding must match the original exactly. Accepted defaults are not re-resolved.
- Logical CPU, memory, PID, output, staging cost and one concurrency unit are
  charged once at first claim. At most 64 active charges; inconsistent sums fail.
- Lowered limits drain existing work; they never kill it. Unknown capacity blocks
  new claims, never observation or replay.
- Isolation is installation-wide across organisations and export jobs. An active
  isolated charge blocks every other claim; an isolated claim needs zero active
  charges. The oldest individually feasible queued isolated intent blocks younger
  parallel claims (`isolated_predecessor`); infeasible intents set no barrier. An
  intent is individually feasible when its profile is available and it fits the
  per-run ceilings, the total pool, the staging limits and current shared storage;
  active charges, concurrency and isolation locks are ignored for this test. Runtime
  ceilings are totals before reservations, so the claim subtracts active charges
  from them exactly once.
- The claim reads at most 4096 pending rows; overflow fails rather than truncates.
- A queued claim requires `cancellationRequested=false`; claim and cancellation
  serialise through the same SQLite worker.

## Delivery runtime

`startDeliveryRuntime` (`ports/delivery.ts`): one non-overlapping timer, default
250 ms (25 to 60000 ms). Each turn rotates queued, reconcile, events; scans at most
32 items, selects the first ready one and holds at most one original Offer or event
batch. No per-run timer, Offer backlog or automatic second attempt.

For a selected key: read Offer, claim, build the client from the stored journal
authority, then:

| Claim | Action |
| --- | --- |
| `claimed`, no cancel | PUT the original Offer |
| `replay` | GET snapshot first; only a validated scoped `attempt_not_found` 404 permits re-PUT |
| `acknowledged` | GET snapshot only; a missing receipt never re-PUTs |
| Any, cancel intent | Never PUT; on scoped absence of an unacknowledged original, send `cancelOriginal` |

The current scoped Run is read before PUT; `finished`, `errored` or an
active-attempt mismatch stops the action, while `cancelled` or cancel intent selects
`cancelOriginal`. That read does not serialise a later cancellation commit. After a
positive snapshot of a run with cancel intent, the runtime sends the ordinary
generation-1 cancel and observes its reply.
Every positive snapshot goes to `observe`. Remote failures retain charge and advance
fairness; local validation or storage failures stop scheduling and call `onFailure`
once (`app/test/delivery/failures.test.ts`, `fairness.test.ts`).

## Event custody

`EventCustodyStore` (`app/src/ports/events.ts`): `scan`, `load`, `ingest`,
`confirmAck`, `recordProblem`. The binding is the exact `DispatchKey` plus stored
journal authority; acknowledged generation 1 and an output allocation are required.

- Discovery keeps acknowledged originals after charge release, terminal Run or
  outbox removal until output finalization clears the obligation
  (`event_pending`). Unbound legacy records appear as `unbound`, never with
  invented bindings. Paging is keyset with a captured upper position.
- One event turn selects one attempt: load state, confirm any outstanding ACK,
  GET from `durableThrough`, validate, ingest, then ACK only the committed prefix.
- Batches hold at most 100 events and 262144 bytes, each event at most 66048
  bytes; state replies at most 4096 bytes; scan pages as for dispatch. Event
  batches share the worker's two large-original slots.
- `prepareEventBatch` (`app/src/domain/events/`) requires strictly consecutive
  sequences from `after + 1`, matching nested identities and
  `retainedStartSeq ≤ after + 1`.
- One immediate transaction rejects `after > durableThrough`, accepts equal
  duplicates at no charge, rejects conflicting duplicates with no change, appends
  the contiguous suffix and advances `durableThrough`. Only a committed result
  authorises a remote ACK up to `ackThrough`.
- `requestedThrough ≤ acknowledgedSeq ≤ durableThrough`;
  `0 ≤ ackConfirmedThrough ≤ durableThrough`, monotonic and idempotent. A lost
  ACK reply retries the stored prefix under the same authority. After a lost ingest
  reply the runtime reloads durable state before any ACK. An ACK never refunds event
  bytes.
- Each unique row charges UTF-8 bytes + 128 against the run's output payload
  allowance, capped at `min(maximum_payload_bytes, 64 MiB)` and 65536 rows.
- Problems: `cursor_expired`, `quota_exhausted`, `missing_receipt`,
  `replay_conflict`, each from a matched reply, never a generic 404. Expiry already
  covered by local `durableThrough` changes nothing; a real gap sets coverage
  `partial` permanently. Blocked attempts skip ingestion; no automatic deletion,
  retry, release or invented stop follows. The first recorded problem stands; later
  identical problems change no counter or evidence.
- Snapshot `lastSeq`, Offer ACK and terminal Run never imply event durability; events
  never change Run state, outcome or allocation.

## Agent scheduling and capacity polling

| Loop | Rules |
| --- | --- |
| Agent scheduler (`agent/src/scheduler/`) | One pass at a time, first lane rotating charged, delivery, queued. At most 64 outstanding `drive` calls, one per scoped generation; aborted calls keep their slot until settled. Charged page 100 rows, at most 64 identities; delivery and queued pages `min(32, free slots)` with independent cursors. Interval 250 ms (50 to 5000); operation budget 30 s (100 ms to 300 s). Grants no launch or release authority; close drains originals only. A charged page with a continuation, or any malformed page, fails that pass before later lanes and does not advance its cursor. Status is running or closed, the outstanding count and a last-error category (`scan`, `drive`, `clock`). |
| Capacity poller (`app/src/bootstrap/runtime-poller.ts`) | One iteration at a time, interval 250 ms (25 to 60000). Copies at most 64 KiB. After a null or refused observation, publishes null once if the last fact was accepted. Status is published, unknown, failed or closed; published is not permission to dispatch. Unexpected errors fence ticks. Only `invalid_input` or `invalid_value` on a non-null observation is a refusal; any other error, or a refused null, is a failure, and a failed revocation is never reported as revoked. A reply after close neither publishes nor schedules. Status holds no credential, path, exception text or measured value. |

## Shutdown and failure ordering

- Capacity poller and delivery runtime share one runner gateway (`agent-owners.ts`).
- A fatal capacity error stops delivery synchronously; a delivery failure fences
  positive publication, drains the poller, then publishes null once.
- `close` on either loop stops new network mutation, aborts as a hint and awaits
  every original call and received positive observation, ingest or ACK
  confirmation. No PUT, cancel or ACK is issued after close.
- Bootstrap drains both loops, then the gateway, then metadata. `onFailure` must
  never await the runtime's own close.

## Related

- [Run lifecycle](run-lifecycle.md)
- [Decision 018: Docker host trust boundary](../../decisions/018-docker-host-trust-boundary.md)
- [Change capacity guide](../../../site/src/content/docs/guides/change-capacity.md)
- [System overview](../overview.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/ports/dispatch.ts` | `2866b93e0774` |
| `app/src/ports/events.ts` | `6b1e3a6da027` |
| `app/src/adapters/outbound/sqlite/dispatch-claims.ts` | `a93c47920f54` |
| `app/src/adapters/outbound/runner/delivery/` | `d0bb503ece86` |
| `agent/src/scheduler/` | `09e94ef48418` |
| `app/src/bootstrap/runtime-poller.ts` | `d4493d903f21` |
