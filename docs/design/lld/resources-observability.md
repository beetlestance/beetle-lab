# Resources, progress and observability

Status: proposed limits and qualification targets, not measured guarantees.
This document owns resource/telemetry policy. V2 ships the Docker backend only;
process-backend notes are future requirements, not an additional release target.

## One capacity authority

The agent owns admission and reservations across all organisations. Organisation
views never get independent copies of the host capacity. Application queues user intent and
shows the reason an offer waits. Admission is a single journal transaction; an
engine may never bypass it. Heavy report/export/generation/build work is also an
admitted task, not an unaccounted background function inside the control service.

For each resource: sum(active reservations) + control allowance + operator headroom
must not exceed configured capacity bounded by runtime-reported capacity. Include
staging/output disk. Use Docker VM capacity on Desktop; separately warn that other
host work/targets can still contend. Declared headroom is policy, not OS isolation.

Admission observations carry explicit per-resource provenance: Docker daemon/VM
CPU and RAM totals, configured aggregate PID/output/staging ceilings, and statfs
available bytes. Physical aggregate PID capacity stays unknown. Configured-only
ceilings include reserve/headroom so effectivePool subtracts them exactly once.
Source labels describe evidence provenance, not authentication or proof by themselves.
Missing/invalid stored provenance yields unknown capacity until refreshed. Journal
reopen clears observations without changing queued or charged ownership; process
restart cannot inherit guard readiness. One full observation composer supplies
guards: omission revokes them rather than carrying previous controls forward.
Identical equal-millisecond replay is ignored. Conflicting equal-time samples
invalidate readiness conservatively; only a strictly newer sample may restore it.
Actual Docker support covers CPU/memory/PID controls only. Timeout/output readiness
must come from a live guard owner; a capacity producer never invents those flags.
The resource observer reads a verified staging root through readRootSpace (pinned
identity before/after bigint statfs), then read-only Docker version/info. It owns
one original sample, has no waiting queue, and checks monotonic cancellation/deadline
before/after issued calls. Failure produces unknown; close aborts and waits for the
original sample, including late filesystem/transport promises. It neither closes
the shared transport nor owns its underlying socket cleanup. Sample timestamps are
captured before reads; invalid/rollback wall time cannot create fresh known facts.

Reject jobs whose minimum exceeds the entire pool instead of leaving them queued
forever. Defer temporarily blocked jobs with a typed reason and retry time without
holding an execution slot. FIFO within a class; bounded scanning may admit smaller
jobs, but age promotion prevents indefinite starvation. Requested isolated-mode
locks are respected; ordinary performance jobs may run concurrently when allowed.
No cron scheduling in the first release.

## Proposed profiles

Values are starting fixtures to measure and tune before release, not inferred
requirements of every real test. Resource requests may be overridden through UI settings within installation caps.
[Settings precedence](organization-settings.md) has one resolver; each accepted run
stores its effective values. Raising a default never raises a hard installation cap.

| Role/profile | CPU ceiling | Memory ceiling | PIDs | Other limits |
| --- | --- | --- | --- | --- |
| Frontend | 0.1 CPU | 64 MiB | 64 | Static files, bounded proxy buffers |
| Backend | 0.5 CPU | 512 MiB | 128 | Bounded DB/HTTP/event queues |
| Agent | 0.25 CPU | 256 MiB | 128 | Bounded supervisor and samples |
| k6 default attempt | 1 CPU | 512 MiB | 128 | 10-minute wall, 1-GiB outputs |
| Browser default attempt (later) | 1 CPU | 1.5 GiB | 512 | Explicit shared-memory profile |
| Mutation default attempt (later) | 2 CPUs | 2 GiB | 512 | Per-project build/output budget |

Run budget means per-attempt CPU/memory/PID/time/output maxima. Pool budget means
the installation-wide sum allowed concurrently; they are different settings. CPU
ceilings throttle work, memory ceilings may OOM-stop it, and deadlines stop it.
For an 8-CPU/16-GiB runtime, an example pool is 4 CPUs/8 GiB: two attempts requesting
1 CPU/1 GiB and 2 CPUs/2 GiB fit; another requesting 2 CPUs/6 GiB waits.

Measure idle and loaded frontend/backend/agent overhead, then show the user an
execution-pool recommendation based on effective runtime capacity minus configured
control reserve and headroom. No mandatory 50% allocation or fixed minimum machine.
User settings select CPU/RAM/disk budgets; validate their sum against runtime limits.
Measured idle usage alone is not a safe control reserve: include qualified loaded
peaks/margin. Never silently raise caps or enable swap to pass acceptance.

Apply Docker CPU quota, hard memory limit, memory+swap policy, PID cap, read-only
root filesystem, unprivileged UID, dropped capabilities, no-new-privileges and
bounded tmpfs where supported. Browser exceptions are named in its engine profile;
no privileged mode or Docker socket in engine containers. Check runtime support
before acceptance, particularly rootless/cgroup configurations.

Docker volume mounts do not provide a portable hard disk quota. Track output
bytes and free-space thresholds; stop before the soft threshold plus maximum
in-flight buffers can exhaust reserved storage. If a backend cannot enforce a
requested hard quota, report unsupported rather than claim a guarantee.

## Bounded pipeline

| Boundary | Initial limit | Overflow behavior |
| --- | --- | --- |
| JSON control request | 1 MiB | 413 before buffering full body |
| Wrapper envelope | 64 KiB | Typed protocol error; stop attempt |
| Artifact transfer buffer | 8 MiB/active transfer; 2 transfers/agent | Backpressure |
| Raw metric parser window | 1 second; 8 MiB transient buffer | Bounded histograms; never retain all durations |
| Metric label sets | 200/run, bounded label lengths | Other bucket + explicit truncation/inconclusive policy |
| Agent event batch | 100 records or 256 KiB | Flush/retry; bounded journal spool |
| In-memory live log | 200 redacted lines, 64 KiB total | Evict oldest; full bounded log in artifact |
| Browser chart | 1,000 points/series, 20 series/view | Request downsampled range |
| List API | 100 rows/page | Cursor pagination |
| Agent disk spool | 64 MiB control + reserved output/attempt | Stop before evidence/output loss |
| Maintenance pass | 100 records or 1 second | Persist cursor and yield |

Control/lifecycle/result events cannot be silently dropped. Resource samples may
be coalesced with a dropped-sample counter and interval coverage. A full queue must
not be followed by an unbounded serializer, final drain or export accumulator.
Streaming is an end-to-end invariant: read -> parse -> aggregate -> write -> serve.
Use mergeable histogram/sketch distributions; never average p95s into a new p95.
The histogram precision/range and overflow behavior are part of the result schema.
Native k6 body assertions have a [specific buffering limitation](../../decisions/005-native-k6-response-memory.md):
processing caps begin after native buffering; supported execution requires engine
RAM containment and OOM qualification. Do not label that a per-response download cap.

## Observation scopes

| Scope | Measurements | Truth boundary |
| --- | --- | --- |
| Target service | HTTP latency/errors and opt-in target runtime sampler | Target-emitted values; not engine resource use |
| Engine attempt | CPU time/rate, cgroup memory/current peak, PIDs, I/O, throttling, limit and exit cause | Supervisor/runtime samples |
| Process backend | Observed process-tree RSS/CPU, descendants, enforcement support | Sampled and OS-dependent; shared pages may double count |
| Application/agent | RSS/heap, CPU, event-loop delay, queue sizes, DB/HTTP time | Whole service, never relabeled per job |
| Phase/function | Wall duration, named operation, units/bytes, errors, optional profile link | Correlation span; concurrent process deltas are not attribution |

Execution policy has mode `parallel` or `isolated`, concurrency/resource limits
and optional prefer-idle/thermal conditions. Parallel is permitted by default when
requested; do not serialize all performance work. Isolated mode locks the whole
agent pool across organisations until collection completes. Record competing runs
and actual limits in either mode. An idle preference may defer new starts but
never changes an active run secretly. Thermal sensors are optional capabilities: a
Docker VM CPU count/utilization does not establish physical temperature/throttling.
Show source/freshness or unknown. A required unavailable sensor blocks that policy;
an advisory unknown signal must not be displayed as cool/idle.

Sample active attempts at 1 second; batch/coalesce persistence every 5 seconds and
on terminal closure. Record monotonic duration and UTC correlation time. Preserve
measurement source, scope, interval, counter resets and completeness. CPU percent
uses a declared denominator (one core = 100%); CPU quota is shown separately.
Memory values name cgroup usage versus working set; do not mix Docker CLI
cache-adjusted values with raw API usage. Label sampled peak versus kernel peak;
unsupported/missed observations are null with reason, never zero.

On each phase transition record phase identity, attempt/generation, start/end,
work counters, outcome and last-useful-progress timestamp. Correlate Node async
operations with explicit context propagation; that does not make heap/RSS or
process CPU deltas attributable to an async function. Exact attribution requires
an isolated execution or supported profiler, with overhead disclosed.

## Liveness versus progress

Agent heartbeat: last contact with supervisor. Wrapper heartbeat: observed child
liveness. Progress: monotonically committed units for the current named phase.
Do not change the progress timestamp when only a heartbeat or repeated count
arrives. Unknown totals display completed units and elapsed time, not fabricated
percentages. Phases with meaningful checkpoints acknowledge only durable work.

Show phase age and time since useful progress; stalled is a diagnostic condition,
not automatic test failure. Workload-specific deadlines/cancel policy determine
termination. The result/seal commits final progress; 100% means all required
phases and artifacts are durable, not merely that the test loop returned.

## Telemetry is bounded work

Each telemetry record has run/attempt/generation/phase and a fixed operation name.
Detailed identifiers live in per-run records/traces, not unbounded metric labels.
Logs are structured, redacted and rate limited. No full configs, credentials,
request bodies or environment captures by default. Profiling is explicit and
resource-budgeted; never attach a profiler automatically to every function.

Local operation requires no Prometheus/collector stack. Keep per-run samples as
chunk artifacts and bounded summaries; optional OpenTelemetry export is an adapter.
Telemetry failure marks measurement completeness and emits one bounded diagnostic;
it cannot invent success or block cancellation. Loss of required result/control
evidence remains an execution failure.

## Release targets and qualification

Measure idle/loaded CPU, memory, image size and disk growth for the frontend,
backend and agent separately; publish the observed runtime and limits, not a
minimum-machine marketing tier. Qualification fixture: declared available budget,
one bounded synthetic k6 attempt, three subscribers and a 30-minute stream, then
parallel runs within a user-selected pool. Target control API p95 <= 250 ms, bounded
service RSS under declared ceilings and no retained growth after repeated runs.
Values are gates to measure, not assertions about what every host can run.

Compare telemetry enabled/disabled on identical fixtures; target <= 5% additional
wall time and report agent CPU/RSS overhead separately. A miss requires analysis,
not a silent target increase. Stress zero-room admission, host pressure, noisy
logs, high cardinality, slow readers, stalled artifacts, disk exhaustion, OOM,
restart and leaked child cleanup. See [verification](../../verification.md).

Sources: [Docker limits](https://docs.docker.com/engine/containers/resource_constraints/),
[Docker stats](https://docs.docker.com/reference/cli/docker/container/stats/),
[Node async context](https://nodejs.org/api/async_context.html),
[Node performance APIs](https://nodejs.org/api/perf_hooks.html).
