# Execution and plugin protocol

Status: proposed protocol v1 for the rewritten product v2. Agent is privileged;
its API is private and authenticated. Engines have no Docker or metadata access.
V2 requires Docker; process mode remains deferred. Scope job identity with the
resolved organizationId/workspaceId and persist it in events, journal and outputs.

## Wire contract

JSON Schema 2020-12 files under `contracts/runner/v1/` own request/response formats.
Generate TypeScript types, validators and API reference; engine languages consume
the same JSON conformance fixtures. Unsupported major versions fail before launch.
Minor extensions are additive only; unknown required capabilities fail validation.

```json
{
  "protocolVersion": "1.0",
  "attemptId": "opaque-uuid",
  "organizationId": "organization-uuid",
  "workspaceId": "workspace-uuid",
  "intentDigest": "sha256-of-non-secret-intent",
  "engine": {"id": "k6", "imageDigest": "sha256:...", "configVersion": 1},
  "inputs": [{"id": "input-uuid", "sha256": "...", "bytes": 1024}],
  "budget": {"cpuMillis": 1000, "memoryBytes": 536870912,
    "pids": 128, "timeoutMs": 600000, "outputBytes": 1073741824},
  "executionPolicy": {"mode": "parallel", "preferIdle": true},
  "config": {"engineSpecific": "validated payload"}
}
```

No shell command, host path, mount option, arbitrary environment map or Docker
flag comes from the browser/job payload. The installed engine manifest owns the
entrypoint, allowed configuration and approved runtime profile.

## Agent endpoints

| Method and route | Behavior |
| --- | --- |
| GET /runner/v1/capabilities | Runtime capacity, supported controls, plugins and protocol versions |
| PUT /runner/v1/attempts/:id | Idempotent offer; 202 accepted, 409 conflicting digest, 429 deferred, 422 unsupported |
| GET /runner/v1/attempts/:id | Journaled state, generation, current phase, exit evidence and cursor |
| POST /runner/v1/attempts/:id/cancel | Persist cancel intent; idempotent; return existing terminal state if closed |
| GET /runner/v1/attempts/:id/events?after=N | Ordered bounded batches, next cursor, retained-start cursor |
| POST /runner/v1/attempts/:id/ack | Acknowledge application-durable event cursor; does not mark tests complete |
| GET /runner/v1/attempts/:id/outputs/:artifact | Stream a sealed output/range under run-scoped authorization |

Agent credentials are installation-scoped and never exposed to the browser or
engine. Compose uses an unexposed private network and pairing secret. No native
installation or Unix-socket client is required for the first release. Remote TLS/identity is deferred to shared
mode. Only the configured application may offer jobs.

## Idempotency and journal

Agent journal tables: accepted_attempts (intent digest, generation, state,
reservation, deadline, runtime ID, cancel intent, terminal evidence), event_spool
(attempt/generation/seq, payload reference, ack), and installed_engines (manifest
identity/digest, approved capabilities). One journal owner serializes mutations.

The immutable attempt ID plus intent digest is the idempotency boundary. Persist
acceptance/reservation before starting the runtime. A deterministic runtime name
and labels include installation/attempt/generation. On uncertain Docker creation,
inspect those labels before creating anything else. Multiple matches are an
operator-visible error and remain charged until resolved.

A generation fences ownership changes after reconciliation. The application only
accepts events/results for the acknowledged generation; an old generation cannot
complete a newer execution. Restart normally reattaches to the existing generation
and sequence. Never replay side-effecting tests to recreate a missing process.
Reconstruct reservations before serving new offers. If multiple agent instances
point at the same installation, refuse startup under an exclusive local lock;
shared/multi-agent ownership is outside the single-agent profile.

## Engine manifest and wrapper

Private staged input uses the shipped `StagedAttempt` schema in `staging.json`.
The input root contains `offer.json`, `manifest.json`, `staging.json` and numbered
`input-NNN.bin` files; secrets are separate files under the secret mount. Metadata
pins scoped generation, intent/spec identities, exact offer/manifest hashes,
admission-derived absolute wall deadline and staging-policy version. Input mappings
must be a bijection with Offer inputs, in Offer order using zero-padded indices;
secret names must match declared references. Readers verify hashes/byte lengths,
ownership and cross-file identities before executing. Schema validity alone does
not establish these semantic bindings, an authenticated producer or resource controls.
No resolved secret value or digest appears in the staging metadata. The stager
requires the matching charged reservation before writing and enforces the
[versioned staging allowances](../../decisions/006-agent-staging.md).
Secret aliases have their own grammar, including leading underscores. The k6
bridge maps locator to an opaque env/mounted reference; raw paths/other providers
are unsupported. Optional declared versions (up to 256 characters) are compared,
never invented or derived from resolved secret values.

A manifest owns ID/version, protocol range, image digest, config/result schemas,
capabilities, default/minimum budget, supported backends and execution network
requirements. Installing/updating a manifest is an explicit trusted local action.
Image acquisition/verification occurs before timed execution and within a bounded
setup budget; no background image pull during performance measurements.

The wrapper implements validate -> prepare -> execute -> collect -> seal.
Control-plane preflight covers installed schema/identities/capabilities and scoped
input metadata. Full staged-input semantic compilation is admitted validate work,
completed before readiness or target load; validation OOM/timeout is an execution
failure. See [the validation boundary](../../decisions/007-admitted-validation.md).
Each phase has one owner and deadline. k6 config compilation, metric aggregation,
report rendering and script export are separate modules sharing one pure compiler.
An engine can use JS, Rust, Python or another language; the wrapper may launch its
native executable rather than embedding it in the agent.

Wrapper/agent transport: one line-delimited JSON envelope on stdout for control,
with stderr for redacted diagnostics; high-volume metrics/logs go to chunk files.
The wrapper durably appends control events to a bounded per-attempt journal before
notifying stdout. On agent restart, replay that journal from the persisted wrapper
cursor; stdout is a notification path, not the only surviving event copy. The
wrapper preserves its terminal seal on disk even when the agent disconnects.
Envelope fields: version, attemptId, generation, seq, kind, phase, observedAt and
validated payload. Max line is 64 KiB. Malformed/oversized protocol data stops the
attempt with a typed error; a noisy engine cannot fill agent memory.

Wrapper events: phase.started, progress, case.result, artifact.sealed,
engine.result, phase.finished. Agent events: admitted, runtime.started,
resource.summary, cancellation.requested, runtime.exited and execution.lost.
Sources remain distinct; the wrapper cannot self-certify container resource limits.
Required phases declare their time/work/output budgets in the engine manifest.
Prepare, execute and collect cannot contain an unbounded second scheduler; any
independent heavy operation becomes another admitted task with a parent run ID.

## Collection boundary

[Agent collection](agent-collection.md) owns bounded control intake, durable
checkpoints, stopped-prefix verification and sealed output custody. Collection
does not authorize application finalization or capacity release by itself.

## Lifecycle and cancellation

| Step | Invariant |
| --- | --- |
| Offer | Installed schema/identities, scoped reference metadata and capabilities preflighted |
| Admit | CPU/RAM/PID/output reservations checked and journaled atomically |
| Prepare | Inputs staged and hash-verified; credentials resolved transiently; setup bounded |
| Start | Resource controls applied; runtime ID persisted; measure-start emitted only after readiness |
| Execute | One engine invocation; independent heartbeat and useful-progress timestamps |
| Collect | Engine stopped; final samples/artifacts/result sealed under the same budget |
| Exit | Supervisor records exit, OOM/timeout/cancel cause before runtime removal |
| Finalize | Application validates complete evidence, commits outcome and acknowledges seal |
| Release | Agent reservation released only after execution is confirmed stopped |

The [measurement boundary decision](../../decisions/008-measurement-boundary.md)
defines the native marker and retrospective wrapper observation; buffered receipt
does not establish a durable pre-load handshake.
Result content hashing follows the [seal decision](../../decisions/009-result-seal.md).
The [k6 outcome decision](../../decisions/011-k6-outcome-evidence.md) defines assertion
counting, native exit identity, discovery witnesses and decision completeness.
Readiness sample isolation follows the [scope correction](../../decisions/010-readiness-metric-isolation.md).
Native compatibility evidence does not qualify container execution or complete runs.

Cancellation is durable before signal delivery. Wrapper gets a 5-second graceful
stop window; then agent kills the container and verifies exit. Configurable engine
profiles may extend grace, but repeated cancels do not reset it. Parent shutdown
uses the same path. An agent lost beyond its recorded supervisor deadline cannot
leave an unbounded process intentionally running: wrapper has its own wall deadline.

## Failure and restart matrix

| Failure | Required action |
| --- | --- |
| Offer response lost | Query/retry same ID and digest; no second execution |
| App restarts | Reconcile outbox and agent journal before dispatching anew |
| Agent restarts, container exists | Reattach, inspect deadline/cancel intent, reconstruct reservations |
| Agent restarts, runtime absent | Persist lost/exit evidence; outcome inconclusive unless complete terminal seal exists |
| Docker is unreachable | Keep unknown executions charged; stop new admission until reconciled |
| Memory OOM | Record Docker/kernel evidence when available; 137 alone is not proof of OOM |
| Wrapper crashes or emits invalid result | Engine error, preserve bounded diagnostics; never pass from exit 0 alone |
| App disconnected, spool nearing quota | Backpressure bounded writes; stop attempt before control/event evidence is lost |
| Artifact transfer fails after tests | Retain sealed spool and retry transfer, not test execution |
| Host reboot | Reconcile names/journal; lost execution is not silently retried |

Only finalization/transfer is resumable in the initial release. Engines may later
advertise checkpointed work units with explicit safety semantics; counters are not
permission to replay HTTP requests, browser actions or mutation steps.

## Transport recovery and errors

Agent assigns one authoritative event sequence after merging wrapper and supervisor
events; wrapper sequence is retained for deduplication. Application stores event
batch and cursor atomically before ACK. Retry batches are harmless. A gap older
than retained spool returns `cursor_expired` plus snapshot/seal location; completeness
must remain partial when the missing interval cannot be reconstructed.

Typed reasons include invalid_config, unsupported_capability, budget_unavailable,
setup_failed, engine_crash, memory_limit, timeout, output_limit, cancelled,
execution_lost and artifact_incomplete. Errors identify retryability for transport
or setup only; execution retries always require explicit user intent.

Agent janitor removes only stopped, sealed, application-acknowledged attempt
containers/spools after retention. It never deletes unknown or active runtimes to
satisfy a disk target. A future process backend must implement this protocol and publish its weaker
capability/measurement matrix; no silent process fallback ships in v2.
