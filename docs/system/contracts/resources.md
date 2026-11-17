# Resources

The agent owns host capacity: admission, reservations, resource observations,
guards and per-attempt telemetry. The backend consumes a published capacity
observation and mirrors it for dispatch; it never holds an independent copy of
host capacity. Offline capacity changes are owned by `tools/install/capacity/`.

## One capacity authority

| Rule | Enforced by |
| --- | --- |
| Admission is one Journal transaction across all organisations; no engine, export or build bypasses it | `agent/src/admission/`, `Journal.admission` |
| For each resource: sum(active reservations) + control reserve + headroom ≤ configured pool, bounded by runtime-reported capacity | `agent/src/admission/policy.ts` |
| A job whose minimum exceeds the whole pool is rejected, never left queued | `agent/src/admission/` |
| A temporarily blocked job defers with a typed reason and holds no execution slot | `agent/src/admission/`, `agent/src/installation/` |
| FIFO within a class; smaller jobs may bypass for 30 s, then the queue drains for the oldest feasible job | `agent/src/admission/` |
| Timeout never sums across attempts; lowering a pool preserves retained debt and drains | `agent/src/admission/` |
| Raising a default never raises an installation cap; each accepted run stores its effective budget | settings resolver, `agent/src/admission/` |

Run budget means per-attempt CPU, memory, PID, timeout and output maxima. Pool
budget means the installation-wide concurrent sum. CPU ceilings throttle, memory
ceilings may OOM-stop and deadlines stop. Admission rejection reasons are the
closed `admission.reason` enum in `contracts/src/generated/`.

## Observation provenance

| Resource | Source | Notes |
| --- | --- | --- |
| CPU, memory | Docker daemon/VM totals | Docker Desktop reports the VM, not the host |
| PIDs, output, staging | Configured aggregate policy | `physicalPidCapacity` is always null |
| Free staging disk | `statfs` of the verified agent staging root | Not backend metadata/input/output capacity |
| Idle, thermal | Optional sensors | Stale, future, missing or null never implies ready |

- Configured-only ceilings include reserve and headroom, so the effective pool
  subtracts them exactly once.
- Source labels describe provenance; they authenticate nothing.
- Docker supplies CPU, memory and PID controls only. Timeout and output readiness
  come from live guard owners (`agent/src/timeout/`, `agent/src/guard/`); a
  capacity producer never invents them. Output is a bounded-writer stop guard, not
  a filesystem quota; a required `hard-output-quota` is unsupported.
- One full observation composer supplies guards; omission revokes them.
- The observer (`agent/src/observation/`) owns one original sample, no queue,
  and reads the staging root with pinned identity before and after a bigint
  `statfs`, then read-only Docker version/info. Failure yields unknown. Close
  aborts and waits for the original sample; it never closes the shared transport.
- Journal reopen clears observations without changing queued or charged
  ownership. Process restart cannot inherit guard readiness.

## Capacity observation wire

`Capabilities.capacity` is the sole per-run budget and is required; the shape is
`CapacityObservation` in `contracts/src/generated/`. It is built only from
`ObservationPublisher.snapshot` in `agent/src/bootstrap/capacity-observation.ts`.

| Invariant | Value |
| --- | --- |
| Expiry | min(publisher expiry, sample start + `observationTtlMs`) |
| Ordering | sample start ≤ observed time ≤ expiry; guards are never future-dated |
| Refusal | absent, expired, malformed or exhausted facts return 503, never an empty catalogue |
| Renewal | GET and acknowledgement never renew a source; repeated reads preserve times and digest |
| Clock model | `local-shared-wall`: one host/VM wall clock is assumed, not proven |
| Pool | total allowed capacity before active reservations, including staging, minus reserve and headroom once |
| Per-run | clipped to the pool; staging allowance = min(pool staging, per-run staging) |
| Runtime controls | filtered to `cpu`, `memory`, `pids` |

`policyDigest` is lowercase SHA-256 of the UTF-8 prefix
`beetle-lab.capacity-policy.v1`, LF, then canonical JSON (≤ 128 KiB) of
`{configuration, installedIdentities}` in catalogue order. It exposes no paths
or credentials and authenticates nothing.

Backend receipt (`app/src/adapters/outbound/sqlite/`): the runtime observation
lease is half-open, `observedAtMs ≤ now < min(expiresAtMs, observedAtMs +
runtimeTtlMs)`, checked at caller ingress and worker dequeue. `runtimeTtlMs`
defaults to 5000 ms (bounds 1–60000 ms). Queueing never refreshes age. Clock
rollback revokes; a persistent source-time high-water fence requires a strictly
later observation to restore capacity. Malformed ingress never replaces a valid
observation. Receivers compare installation and installed engine identities and
retain original Offer pins; a later capability response never selects a newer
profile.

## Timeout watchdog

`agent/src/timeout/` requests typed `timeout` or `clock_integrity` stops. It
owns no lifecycle transition and certifies neither termination nor release.

| Limit | Value |
| --- | --- |
| Watches per service | 64; no pending queue |
| Poll interval | default 100 ms, integer 10–1000 ms |
| Timeout grace | supervisor's 5 s policy; `clock_integrity` requests emergency kill |

- Registration happens immediately after admission or recovery, before staging.
  A monotonic sample is captured before the durable supervision read; waiting
  for that read consumes budget. Wall deadline = `admittedAt + timeoutMs`;
  monotonic deadline = sample + max(0, wall deadline − `clockHighWater`).
- Registration never restarts the budget. An expired or fenced registration
  stops before launch. Duplicate identical registration returns the same watch;
  conflicting identity rejects without extending the deadline.
- Wall or monotonic rollback, invalid clocks, durable fencing or unsafe
  arithmetic fence all watches and request `clock_integrity`. Forward wall jumps
  can only shorten time.
- Stop intent is persisted before signalling. Stop rejection is sticky and
  rejects close. Close fences callbacks and drains every original; unknown stop
  mutations are never retried. No watch authorizes deletion or capacity release.
- Fresh guard publication requires output AND timeout readiness together.

## Per-attempt telemetry

`agent/src/telemetry/` produces `resource.summary` events from the Docker
one-shot stats endpoint for an already-owned, inspected, running container.

| Limit | Value |
| --- | --- |
| Monitored actors | 64 per supervisor |
| Concurrent stats reads | 2 shared originals, refused without a queue (counted as missed) |
| Sample interval / deadline | 1 s / ≤ 1 s |
| Journal publication | every 5 s plus one final summary on runtime exit |

- Readings: CPU is the last cumulative counter in whole milliseconds; a decrease
  marks `counter_reset`. Memory is raw `memory_stats.usage` (not cache-adjusted)
  and PIDs is `pids_stats.current`; both are sampled maxima, not kernel peaks.
- Missing values are null with a reason, never zero. Output bytes stay null.
  Agent restart starts fresh maxima with a discontinuity marker.
- A stats reply with an omitted ID is accepted only when the request was bound to
  the exact 64-character container ID, method and path, and ownership was
  unchanged across the reply. A present wrong or shortened ID refuses.
- Stats IO is never on the create/start/kill/cancel path. Lifecycle and resource
  events share one serialized ordinal owner; at most one issued resource event and
  one newer coalesced observation are retained. No resource event is appended
  after the closed `finalAgentSeq`.
- `SupervisorOptions.requireResourceTelemetry` is true in installed bootstrap.
- Summaries are informational: they never change a Run or result verdict.

## Bounded duration distributions

`@beetle/contracts/metrics` owns the single `exponential-v1` histogram used by
engine, backend and browser; percentiles are never averaged across windows.

| Limit | Value |
| --- | --- |
| Positive buckets | 64 contiguous; start scale 4, downscale to −10 |
| Standalone distribution JSON | ≤ 2 KiB, checked before parsing |
| Percentiles | p50, p90, p95, p99 by nearest rank, with bounds clipped to observed extrema |
| Engine transient metric buffer | 8 MiB |

Zero is counted separately; an empty population returns null; a missing sample
never becomes a measured zero. Estimates carry source `histogram-estimate` and
are not native k6 final quantiles; native summary mapping keeps threshold
authority.

## Offline capacity change

`tools/install/capacity/` grows per-run memory or the aggregate output pool on a
stopped installation. Operator steps are in the guide.

- `config/installation.json` stays immutable provisioning evidence;
  `config/configuration-state.json` (≤ 128 KiB,
  `contracts/src/installation-generation/`) is the sole mutable selector.
- Both serving loaders require a `ready` selector, check unchanged baseline bytes
  and recheck the selector after taking their serving leases. Missing, malformed
  or `reconfiguring` selectors refuse serving.
- The change requires both startup leases and a cold source: no queued, charged
  or active work, unacknowledged delivery, unfinished mutation or live runtime.
- Order: publish a `reconfiguring` selector with operation UUID, expected
  settings, kind/amount and proposed generation; apply one settings CAS; close
  the metadata writer; publish `ready`. Generation digests bind kind and amount.
- Grow-only: a request above the installed pool is refused. Memory changes keep
  the pool; output changes grow only aggregate output within the existing storage
  allocation and reserve. Completed Offers and baseline files are never rewritten.
- Replay with the same UUID after completion is unchanged; an unfinished selector
  requires the same UUID, kind and amount and an identical derived generation.

## Related

- [Overview](../overview.md)
- [Change installed capacity](../../../site/src/content/docs/guides/change-capacity.md)
- [Agent staging](../../decisions/006-agent-staging.md)
- [Native k6 response memory](../../decisions/005-native-k6-response-memory.md)
- [Installation](installation.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `agent/src/admission/` | `d67267efb692` |
| `agent/src/observation/` | `fe42b397a5c9` |
| `agent/src/bootstrap/capacity-observation.ts` | `249bcb8b37e8` |
| `agent/src/timeout/` | `5e6078bb574f` |
| `agent/src/telemetry/` | `66792f7b57f4` |
| `tools/install/capacity/` | `b2a54f1df15e` |
