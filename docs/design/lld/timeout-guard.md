# Attempt timeout watchdog

Status: implemented and independently reviewed component;
[local evidence](../../verification/timeout-guard.md). No native stop-latency qualification claimed.
The public contract lives in `agent/src/timeout/index.ts`.

The watchdog requests typed timeout or clock_integrity stops independently of
staging, filesystem scans, scheduling and original Docker operations. It neither
owns lifecycle transitions nor certifies termination, release or result validity.
The supervisor's existing dispatch-time checks remain authoritative launch fences.

One service owns at most64 scoped generation watches and one interval (default
100ms, configured integer 10..1000ms). No pending queue or per-poll journal writes.
Start is explicit. Readiness requires a running service, valid clocks and an
unexpired watch. Each watch retains its original stop callback until settlement.
Clock failure may issue one bounded emergency escalation after timeout, without
waiting for or abandoning the original; the first durable attribution stays intact.
Stop rejection is sticky, retains its registration and rejects draining close.
Closing fences callbacks, independently drains every original and never retries
an unknown stop mutation. Duplicate immutable registration returns the same watch;
conflicting admission/budget identity rejects without extending the deadline.

Installation registers immediately after admission/recovery, before staging. It
captures local monotonic time before reading durable supervision state. Inputs are
the scoped reservation's admittedAt/timeoutMs, durable clockHighWater/clockFenced
and that local sample time. The absolute wall deadline is admittedAt+timeoutMs;
the monotonic deadline is sampledAt+max(0, absolute-clockHighWater). Waiting for
the original supervision read consumes budget. Watch registration never restarts
the execution budget. An expired/fenced registration requests stop before launch.

Each poll checks both wall and monotonic time. Wall rollback, monotonic rollback,
invalid/throwing clocks, future sample time, durable fencing or unsafe arithmetic
fence readiness and request clock_integrity. Forward wall jumps can shorten time;
later observations cannot extend either deadline. Clock failure affects all watches.
Boundary inputs are bounded snapshots of fixed own data properties; accessors are
rejected and unrelated caller properties are not enumerated. Ownership is reserved
before invoking clocks or stop callbacks, including reentrant shutdown.

Installation persists the stop reason before signalling the owned controller and
aborts preparation synchronously. Clock-integrity intent can use a zero wall sample
when the local wall clock fails: the journal preserves its durable high-water and
fences the clock, without inventing a current timestamp. Timeout retains the
supervisor's five-second grace policy; clock integrity requests emergency kill.
Close drains watches with controller/preparation originals. No watch authorizes
artifact deletion or capacity release.

Polling requests intent while unrelated originals are held. Event-loop starvation,
bounded journal intake, held create/start/stop originals and supervisor serial
ownership can delay actual signalling. Full-pool stop latency, overshoot and native
container behavior need separate measurements before claiming enforcement bounds.
Fresh guard publication must combine actual output AND timeout readiness; neither
constructor presence nor one component's status certifies both controls.

Acceptance covers elapsed durable budget, delayed registration, wall jumps and
rollback, held/rejected stops,64-watch bounds, conflicting replay, reentrant clock
and stop callbacks, cached close, late completion fencing and installation staging
cancellation. Controlled-clock tests do not qualify Docker behavior.
