# Live output and free-space guard

Status: implemented and independently reviewed component;
[local evidence](../../verification/output-guard.md). Native enforcement is unqualified.

## Filesystem sample

scanOutput takes an opaque VerifiedRoot, scoped RuntimePlan, admitted outputBytes,
configured minimumFreeBytes and monotonic Operation. It derives the output path
from verified installation identity/runtimeName; exact user, scope labels and mount
must match. Arbitrary caller directory strings never provide filesystem authority.
Capture inputs before reading getters; forged handles/plans must fail safely.

One scan owns at most256 entries,8 directory levels,2048 filesystem calls and512
relative-path bytes. opendir uses bufferSize1, never unbounded readdir. Pinned root,
canonical names, directory/file ownership/modes and identities are checked. Reject
symlink/special files, multiply linked regular files and duplicate identities.
Growing/truncated live files are allowed; this is not stopped-content verification.
Temporary dotfiles count too. Directories0700 and files0600 match the engine profile.

Bigint arithmetic retains logical and allocated totals separately, and charges each
entry's max(size,blocks*512), including directories. Exceeding the output budget is a
limit result; free space at/below the configured reserve is a disk limit. Otherwise
only a complete scan may return known with its beginning monotonic timestamp.
The root statfs read uses available nonroot bytes. Invalid/unsafe/overflow/incomplete
inspection returns unknown, not a partial known aggregate.

Two original scans are allowed process-wide. Busy does not create a waiting queue.
Every issued open/read/stat/close is retained through abort/deadline. Late directory
opens are adopted before draining; each close is attempted once. Failed descriptor
cleanup retains its slot and owning handles in a bounded process quarantine and
yields unknown/cleanup. Caller must
retain that failed ownership and refuse clean shutdown, never free it for reuse.
Live enumeration is not linearizable and cannot contain a malicious concurrent
same-UID writer. This is a soft stop guard, not a portable hard disk quota.

## Watch service

One installation guard has explicit start/close, at most64 watches, one original
scan/watch and no shadow job queue. Public factory binds the real scanner; a private
constructor seam may supply a scanner for controlled tests. Options contain the
verified root, disk reserve, timing, trusted clock and typed installation stop port.
Default interval250ms, TTL2000ms, sample timeout1000ms; interval50..5000,
TTL100..300000 and sample timeout100..30000 are validated, with TTL>interval.

watch returns initial ready/failed, current status and cached close. Reserve ownership
before callbacks. Scope/plan/output budget are immutable copies; conflicting duplicate
scope rejects, identical duplicate may return its existing handle. No watch starts
after service close. Initial successful complete inspection gates a fresh launch.
Until the first success, freshness starts at watch registration. Watchdog expiry,
stop or close resolves initial ready:false even if an original scan remains held;
that original still prevents clean watch close until it settles.

A completion-driven round-robin pump fills at most two local scan slots over the
existing watch registry, without another pending-job queue. Freed slots consider
the next eligible watch immediately; successful watches become due after intervalMs.
Busy retries wait at least intervalMs to avoid a synchronous retry spin while other
process-wide owners occupy both scanner slots. Registry sweeps remain bounded64.
One scan timer and an independent freshness watchdog own active work. lastKnownAt
uses successful scan START time in the common monotonic domain; busy cannot renew
it. Unsafe/limit results request a stop immediately; busy retries while fresh, then
expiry requests artifact_incomplete. A held scan cannot block stale detection.
Disk breach requests output_limit for all active watches; per-attempt excess affects
that watch. At most one original stop request/watch is issued and retained. A rejected
stop request stays failed/visible; no automatic second mutation is scheduled.

Never invoke stop from an already closed watch or let a late scan restore readiness.
Close fences callbacks, aborts scan signals and drains scan/stop originals. Scan
cleanup failure or stop rejection refuses clean close and retains the registration.
Successful close retires it, allowing more than64 sequential completed watches.
Service close drains every watch independently, including failures; no early-reject
path may abandon another original. Clock failure/rollback revokes readiness and
requests artifact_incomplete without inventing another time source.

Guard status ready requires a running/fresh watchdog, all watches initially ready
and fresh, and no stop/failure. Empty-watch readiness means the output service is
live, not that timeout enforcement exists. Bootstrap must separately qualify timeout
control and compose actual fresh guard evidence; construction/scanner availability
alone must never manufacture ResourceObservation.guards.

## Installation attachment and qualification

Attach the watch to the existing Installation Entry after prep/recovery, before
first launch. Await initial ready for fresh work; stop/fail without launching if it
cannot inspect. Recovered claimed work attaches before reconciliation and never
restages. Retirement/shutdown fence and drain the watch; existing controller/journal
facts remain the sole release authority. A watch close is not proof a test stopped.

Measure full-pool scan age, stale-to-stop dispatch, kill latency and output/disk
overshoot, including64 watches and held I/O. Serial actor/journal originals can delay
urgent signalling. No no-exhaustion guarantee is claimed without that evidence.
