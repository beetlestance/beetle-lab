# Execution protocol

The backend (`app/`) offers attempts to the execution agent (`agent/`) over private authenticated HTTP.
The agent admits, stages, launches and supervises one disposable container per attempt,
returning journaled events and sealed outputs. Lifecycle wire shapes live in
`contracts/runner/v1/`; advisory live/history DTOs in `contracts/api/v2/`. Engine rules: [engines](engines.md).

## Authority

| Party | Owns | Never |
| --- | --- | --- |
| Backend runner gateway (`app/src/adapters/outbound/runner/`) | Offer/cancel/ACK issue, response identity checks, event ingest before ACK | Runtime control, Docker, resource limits |
| Backend delivery (`app/src/adapters/outbound/runner/delivery/`) | One timer, at most one original Offer or event batch in flight | Retrying test execution |
| Agent HTTP (`agent/src/transport/`) | Authentication, scope, bounded JSON, routing to installed services | Launch, profile, schema or Docker-flag endpoints |
| Agent journal (`agent/src/journal/`) | Sole durable authority for acceptance, reservations, events, cancel intent | Inferring native I/O from rows |
| Supervisor (`agent/src/supervisor/`) | Create/start claims, cancellation, timeout, exit evidence | Test outcome |
| Controller (`agent/src/controller/`) | Launch handoff, control intake, output verification, reservation release | Admission, staging, finalization, deletion |
| Engine wrapper | One engine invocation and its phase/result events | Container resource evidence, sibling attempts |

The browser and the engine never receive the agent credential. Job payloads never
carry a shell command, host path, mount option, environment map or Docker flag.

## Wire and versioning

- JSON Schema 2020-12 sources in `contracts/runner/v1/`; runtime AJV validation is
  authoritative over generated TypeScript. Routes: `http-operations.json`.
- Only protocol `1.0` exists; an unsupported major version or unknown required
  capability fails before launch. Extensions are additive, such as optional
  `CapacityObservation.daemonCapacity` ([resources](resources.md#installation-status-read)).
- Every routed message except Capabilities carries organisation and workspace IDs.
  Capabilities is the installation-wide, unscoped exception.
- Offer is bounded at 2 MiB, its `config` independently at 1 MiB, both measured in
  UTF-8 JSON bytes (`contracts/src/limits.ts`). All other bodies stay at 1 MiB on
  the agent and 64 KiB from the backend.

## Routes

| Route | Behaviour |
| --- | --- |
| `GET /runner/v1/capabilities` | Policy ceilings clipped by the latest daemon observation and required `journalAuthority`; advisory, not a reservation; unavailable without fresh evidence |
| `PUT /attempts/{id}` | Idempotent Offer: 202 accepted, 409 `conflicting_digest`, 429 `budget_unavailable` deferral, 422 unsupported engine or refused budget |
| `PUT /attempts/{id}/export` | Same, for a standalone export assignment |
| `GET /attempts/{id}` | Journaled snapshot: state, generation, phase, exit evidence |
| `POST /attempts/{id}/cancel` | Persists cancel intent; idempotent; returns the terminal snapshot once closed |
| `POST /attempts/{id}/cancel-original`, `/export/cancel-original` | Cancels an original whose delivery is uncertain without enqueueing it |
| `GET /attempts/{id}/events?after=N` | Ordered batch of at most 100 events / 256 KiB |
| `POST /attempts/{id}/ack` | Confirms an application-durable cursor; never a test result |
| `GET /attempts/{id}/live-metrics`, `/live-history` | Advisory window (64 KiB, 5 s) or verified sampled prefix (2 MiB, 65536 nodes, 30 s); neither grants output custody |
| `source`, `source/chunk`, `source/absence`, `output-retirement`, `output-settlement` | Output custody routes; see [outputs collection](outputs-collection.md) and [retirement](retirement.md) |

Paths are under `/runner/v1`. The initial Offer always uses generation 1; later
ownership generations cannot be requested through an Offer.

## Authentication and scope

| Check | Rule | Failure |
| --- | --- | --- |
| Credential | Exactly one `Authorization: Bearer <token>`, 43–128 base64url characters, SHA-256 digest comparison | 401, empty body, before body parsing |
| Browser markers, raw headers | `Origin`, `Cookie` or site headers present; header count, size or non-ASCII over limit | 403 |
| Scope headers | `x-beetle-organization-id`, `x-beetle-workspace-id` (UUID), `x-beetle-generation` (canonical positive decimal) | 400 |
| Journal authority | `x-beetle-journal-authority` equals the agent's opened journal UUID, checked before receipt lookup or effects | 400 if malformed, 409 `authority_mismatch` |
| Identity | Path attempt ID, header scope and body DTO identities agree; replies match request scope | 409 or response failure |

Failures before scope is established return only a status: there is no namespace
for a ProtocolError. After that, errors are validated ProtocolErrors with fixed
reasons and no exception text, configuration or URL. Only a schema-valid scoped
`attempt_not_found` is a receipt-absence witness; a bare 404 is not.

## Transport limits

| Limit | Agent server | Backend client |
| --- | --- | --- |
| Original Offer / cancel-original calls | 2, before body parsing | 2 |
| Other original calls | 32 shared; source 2, live 2, history 1 | 8 shared; history subset 1 |
| Sockets / headers | 64 sockets; 16 KiB / 128 fields | 16 KiB / 32 fields |
| Deadline | 30 s request and connection | 5 s; history 30 s; credit held until native close |
| Responses | Encoded and validated; history ≤ 2 MiB / 65536 nodes | ≤ 1 MiB normally, history ≤ 2 MiB; ≤ 4096 fragments |

Saturation is a typed failure without a queue (429 on the agent). Neither side retries, follows
redirects, uses proxies, keep-alive or decompression. The client resolves DNS once (≤ 8
addresses), uses one, and never falls back to another address for a mutation. Aborting or a
deadline never releases credit before the original socket closes; a complete valid reply
received before abort stays a positive result after full validation. An Offer slot is taken
after authentication and scope checks, before the body is read, and kept until enqueue finishes
even if the socket aborts; a failure before enqueue releases it once. Raw and normalised JSON
sizes are checked separately; a pre-issue `queue_full` makes the Stager report busy before any
file or provider work.

## Backend connection

`BEETLE_AGENT_CONFIG_FILE` is a closed private JSON object (≤ 64 KiB): origin (an explicit HTTP
origin ≤ 2048 characters, no credentials, path, query or fragment), token file (≤ 129 bytes),
expected installation ID, 1–32 profile pins and backend storage allocation and reserve. Both
files must be canonical, UID-owned, single-link regular files without group or world access. The
expected installation must equal the installation record; profile aliases never substitute for
installed engine, image and config-version identity. Changed files take effect only on restart.
Capabilities must match the expected installation and exact configured pins before capacity is
used. The backend capacity source combines agent ceilings with backend disk policy into one
lease expiring ≤ 1000 ms after its oldest source; replayed agent samples cannot renew it, and
agent staging space never counts as backend storage. Agent admission remains the final physical
authority.

## Attempt states

`AttemptSnapshot.state` is a pure projection of accepted events
(`agent/src/journal/projection.ts`):

| Event | State |
| --- | --- |
| Offer accepted | `offered` |
| `admitted` | `admitted` |
| `runtime.started` with no phase yet | `running` |
| Wrapper phase `validate`/`prepare` | `preparing` |
| Wrapper phase `execute` | `running` |
| Wrapper phase `collect`/`seal` | `collecting` |
| `cancellation.requested` | `stopping` |
| `runtime.exited` | `exited` (terminal) |
| `execution.lost` | `lost`, or `exited` if exit evidence exists (terminal) |

Phases only advance; terminal and `stopping` states keep their state, but a later
wrapper phase and engine or export result are still recorded. The first exit witness is immutable and confirmed exit facts survive later
unknowns. A second, different engine result for one attempt rejects as a conflict.
A wrapper seal never proves that the container exited.

## Journal, idempotency and fencing

- Attempt ID plus intent digest is the idempotency boundary: the same pair replays,
  a changed digest is 409. Reordered keys still bind complete intent and secret references.
- Acceptance and reservation are journaled before any runtime work. Runtime names
  and labels derive from installation, attempt and generation; uncertain creation
  is resolved by inspecting them, never by creating again.
- One process owns the journal: SQLite `locking_mode=EXCLUSIVE`
  (`agent/src/journal/schema.ts`). The backend checks the journal authority UUID
  on every attempt route, so a restored or foreign journal cannot answer.
- The generation fences ownership: stale generations are refused on reads and
  writes, and an old generation cannot complete a newer execution.
- Restart reattaches to the existing generation and sequence and reconstructs
  reservations before serving new offers. Side-effecting tests are never replayed.

## Launch and control intake

- The controller (`agent/src/controller/attempt.ts`) owns one journal and generation; at most 64
  owners per journal; `launch` and `tick` share one lane and concurrent calls reject busy. Each
  call budget is ≤ 300 s.
- Supervisor: create claim precedes create; durable clock and cancel reread precede the single
  start claim; replay inspects, never restarts. Backend calls cap at 30 s.
- A known journal `queue_full` refusal on the first Offer read is a `journal_busy` deferral
  (`agent/src/controller/launch-contention.ts`): the pending explicit launch is retained for a
  later tick with no extension of the admitted timeout. Unknown commits, binding failures and
  ambiguous create/start retire the launch permanently.
- After the first full Offer read, owners cache only scope, intent digest, engine identity and
  the five budget fields; fresh reservations are still checked every step.
- The wrapper appends control events to `control.ndjson` in the attempt output (≤ 64 MiB, ≤ 65
  536 records, ≤ 64 KiB per line including LF) and fsyncs before any stdout notification. The
  agent reads that file, not stdout. Malformed or oversized data stops the attempt with a typed
  error.
- Each wrapper batch commits to the journal before the reader acknowledges it. Stopped control
  intake requires a definitive launch settlement; the full committed prefix is rehashed before
  collection.
- Release needs a later supervisor observation plus a settled collection result. It records
  collection finished or failed; it is not a pass, finalization ACK or deletion permission. A
  failed original close blocks release permanently.
- An empty stopped control stream fails collection and creates no cursor. Output verification
  uses the admitted deadline, never extended; collector saturation waits within it and is not a
  failure. A never-claimed cancelled launch is aborted as unstarted only after preparation has
  quiesced.

## Events

The agent assigns one authoritative `seq` after merging wrapper and supervisor
events; `wrapperSeq` is kept for deduplication. Wrapper kinds: `phase.started`,
`progress`, `case.result`, `artifact.sealed`, `engine.result`, `export.result`,
`phase.finished`. Agent kinds: `admitted`, `runtime.started`, `resource.summary`,
`cancellation.requested`, `runtime.exited`, `execution.lost`. The wrapper cannot
emit agent kinds. The backend stores a batch and its cursor atomically before ACK.
An expired cursor returns 409 `cursor_expired`; completeness then stays partial.
Native threshold readings are [optional display evidence](threshold-readings.md).

## Cancellation and deadlines

Cancellation is durable before any signal. The engine gets 5 s of grace from the
first durable cancel, then the container is killed and its exit verified; repeated
cancels and recovery never reset grace (`agent/src/supervisor/time.ts`). Timeout is
admission time plus budget. The wrapper holds its own wall deadline, so a lost
agent cannot leave an unbounded engine running. Clock-integrity faults fence dispatch.

## Failure and recovery

| Failure | Behaviour |
| --- | --- |
| Offer reply lost | Delivery GETs first; only a scoped `attempt_not_found` permits re-offer |
| Agent restart, container exists | Reattach; recheck deadline and cancel intent |
| Agent restart, runtime absent | Record lost; outcome inconclusive without a complete seal |
| Docker unreachable | Unknown executions stay charged; no new admission |
| Exit 137 | Not proof of OOM without Docker or kernel evidence |
| Wrapper crash or invalid result | Engine error; exit 0 alone never passes |
| Artifact transfer fails | Retry transfer from the sealed spool, never the test |
| Startup or shutdown cleanup unknown | Journal and process owner retained; no clean-shutdown claim |

Typed reasons and retry classes are in `common.schema.json` and `error.schema.json`;
retry applies only to transport or setup, and a new execution needs explicit intent.
Container removal requires a stopped, sealed and application-acknowledged attempt.

## Related

- Contracts: [engines](engines.md), [run delivery](run-delivery.md),
  [resources](resources.md), [retirement](retirement.md), [recovery](recovery.md).
- Decisions: [006](../../decisions/006-agent-staging.md), [007](../../decisions/007-admitted-validation.md), [008](../../decisions/008-measurement-boundary.md), [009](../../decisions/009-result-seal.md), [018](../../decisions/018-docker-host-trust-boundary.md), [024](../../decisions/024-journal-busy-deferral.md).

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/runner/v1/` | `d09449b25108` |
| `agent/src/transport/` | `ef7b3981fc9b` |
| `agent/src/journal/projection.ts` | `7c77ac77f06a` |
| `agent/src/controller/` | `230594aa2b66` |
| `agent/src/supervisor/time.ts` | `9594485cfc76` |
| `app/src/adapters/outbound/runner/` | `5ab2b31155a9` |
