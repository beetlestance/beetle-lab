# Bounded advisory live metric snapshots

Status: shared frame and publisher core locally verified. This is distinct from
final sealed metric history and durable lifecycle events; no user-visible live feed
is implemented yet.
The pipeline will be engine producer -> private agent read -> scoped backend read ->
visible browser polling. No second parser/compiler or backend percentile aggregation.

## Shared frame and projection

Root owns schema/generated contracts and shared numeric projections. LiveMetricSubset
contains selected1..20 stable descriptors (ordinal0..19, metric/kind/scope/tags) and
excludedSeries0..4600. Caller freezes this subset from the existing approved profile
before execution; no first-arrival selection or new labels. Duplicate identities,
prepare/control scope, unsupported labels and nonconsecutive ordinals are rejected.
Subset identity is SHA256 of the shared canonical subset text; hash implementation
is supplied by trusted native callers, never an invented digest or browser path.

LiveMetricSnapshot version1 binds organisation/workspace/attempt/generation,
producerEpoch UUID, subsetDigest, subset, sourceSequence1..65536,
publishedSequence1..65536, coalescedWindows, capturedAtMs/publishedAtMs,
startTimeMs/endTimeMs and series<=20 existing RunMetricSeries values. Source windows
are one second; unoccupied intervals are not synthesized. Series totals describe
only that source window, never final run totals. Only selected present series appear;
absence is not zero. Preserve exact original scope/tags/kind and stable ordinal.
Use existing projectMetricValue/series projection and histogram percentile bounds.
Never average estimates, reaggregate other requests or retain full histogram arrays.

coalescedWindows == sourceSequence - publishedSequence for each published frame:
these are producer-observed replaced windows only, not upstream/parser/transport loss.
upstreamCoverage is explicitly unknown until final sealed history. Future consumers
show skipped source intervals, source age and receipt freshness separately.
Complete UTF8 JSON frame<=65536 bytes. JSON Schema owns shapes/generated types;
shared semantic capture verifies subset/row identity, ordinals, ratio/percentile
invariants, window length, source/publication ordering, scope and canonical bounds.
Root supplies public helpers; no deep API-client or engine-private imports.

## Engine handoff and publisher core

First worker owns engines/k6/wrapper/live and focused engine tests only. It implements
projection and a publisher over an injected bounded sink, not filesystem/attempt
wiring. The caller supplies validated immutable MetricWindow, frozen approved subset,
fixed scope/epoch/digest, monotonic/wall clocks and sink.write(frame,signal), sink.close().
Private source windows come from the existing accumulator; arbitrary JS is not a
trusted window. Public frame decode remains the hostile-data boundary.

accept(window) synchronously projects at most20 selected values while traversing at
most4096 approved rows, replaces one pending slot and returns without awaiting sink
IO. No native metric parsing, archive mutation, file/network call or subscriber work
occurs inside the callback. Hold only one current original plus one latest pending
projection; replacement increments exact coalesced count. Duplicate/out-of-order or
overlapping source windows and counter/clock overflow disable this advisory producer
with fixed status; do not throw into the authoritative metric callback.

Publish at most once per2000ms monotonic interval, beginning with the first admitted
window. One original write only; no wait queue/retry/restart. A timer wake cannot
publish before the previous original settles or after stop. The pending projection
carries its own sequence/coalescing counters; later replacements cannot mutate the
in-flight frame. Capture wall times without allowing rollback to refresh data.
Maximum writes <=1+floor(timeoutMs/2000), capped65536; timeout comes from captured
admitted budget. Frame/byte/lifetime cap exhaustion or sink failure permanently
disables this producer and exposes fixed failed status. No fake successful publish.
No changes to test verdicts or archive/lifecycle behavior in this component.

stop fences admission/timers synchronously, discards pending data (no final flush),
aborts hints and waits for actual write/close originals. At most one final active
original is drained, independent of run length. Cleanup failure remains failed and
retained; a timeout/abort signal is not physical quiescence. close returns the same
owned promise. Status exposes accepted/source/published/coalesced counts, active/
pending/closed/failed state and fixed failure reason; no raw data/errors/paths.
Projected current+pending state<=128KiB; serializer/output temporary<=64KiB, plus
bounded shared validation scratch. No retained source-window or point corpus.

## Core public interface and admission

Root-reserved engines/k6/wrapper/live/types.ts fixes the interface; index.ts exports
createLiveMetricPublisher(options), types and fixed error. Factory captures options
and trusted capability methods before async work; invalid options throw fixed
invalid_options before sink effects. Scope/subset are detached using existing
schema/semantic owners. Timeout uses existing validateAttempt limits (<=172800000ms).
maximumProducedBytes is a required integer1..4294967296 caller-owned lifetime charge;
max writes is min(65536,1+floor(timeoutMs/2000)). Neither grants new output authority.
Use existing shared descriptor/value math and frame codec; no duplicate unit rules.

Clock defaults Date.now/performance.now; trusted supplied clocks are captured once.
First acceptance establishes source order and cadence without awaiting the sink.
Optional signal fences on abort; already-aborted input starts no write. Sink receives
canonical encoded bytes<=64KiB and captured abort signal; chargedBytes conservatively
reserves the whole buffer before issuing IO, including failed/partial uncertainty.
It is not reported as actual bytes written. Stop discards at most one pending window
and exposes discardedOnStop separately from coalesced replacement counts.

stop/close synchronously fence and return the same Promise<LiveMetricCloseResult>.
It resolves only after actual original write and sink.close settle. Confirmed close
may retain a prior advisory failure reason; failed cleanup returns quiescence failed
and retains/fences its owner. No thrown failure escapes accept or a timer callback.
State snapshots are detached/frozen scalar facts; preserve the first failure reason
and expose cleanup failure via quiescence. No automatic producer restart or final
flush. Per-instance bounds are established here; actual integration creates exactly
one publisher per engine attempt within existing agent admission, not arbitrary
unbounded publishers. No process-global job scheduler belongs in this component.

## Subsequent physical and consumer packets

A later fixed-file adapter writes live-metrics.json/live-metrics.tmp under the exact
trusted output root, mode0600/no-follow/single-link/root identity checks and atomic
replacement. No per-window fsync, append log or lifecycle journal event. Carve out
128KiB peak retained/temp allowance from existing output before load; never raise
an Offer or phase ceiling. Count actual replacement bytes against a finite phase/
lifetime produced-output allowance. Stop/drain/remove the two exact live files before
stopped artifact scanning/sealing; unknown cleanup remains fenced, never fake success.
This accounting/custody wiring is mandatory before enabling the producer in images.

Agent exposes finite authenticated scope/journal-authority-bound reads from trusted
active-attempt roots only, not the stopped artifact-range authority or caller paths.
Reuse existing ordinary transport credits: globally<=2 telemetry originals, no queue,
control/cancel priority preserved. Root/name replacement or scope/epoch mismatch
fails closed; normal atomic replacement races return explicit unavailable. Reads,
decode, encode and response share a fixed<=5s deadline and original lifetime.
Backend resolves scoped run/attempt first, retains no corpus/subscriber registry,
and returns<=64KiB. Browser polls visible selected active attempt every2s only after
prior original settles; stops/retires ownership on scope/session/attempt change.
Errors/staleness are explicit; terminal state switches to published sealed history.
SSE, arbitrary live series selection and replay are not implied by this component.

## Focused acceptance

Core checks: existing projection parity for every kind, percentile bounds/zero ratios,
frozen subset/source mutation, gaps/missing series, high cardinality, latest-slot
replacement, one original, exact coalescing, cadence/clock rollback, byte/lifetime
caps, failure fencing, cancellation/late settlement, no final flush, close failure.
Use synthetic clocks and controlled sink; no Docker/native build/full-suite repeat.
First core packet must not claim filesystem safety, runtime integration or live UI.
Physical producer/agent tests and runner/public/browser connection follow before
A03/V08/V09 feature acceptance; measured overhead remains separate qualification.
