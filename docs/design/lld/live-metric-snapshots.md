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

The [custody decision](../../decisions/013-live-metric-mailbox-custody.md) replaces
the shared-root rename/unlink adapter. Use a dedicated initially empty `/beetle/live`
local-driver tmpfs volume capped at128KiB/four inodes, carved from the existing temporary allocation and
memory budget. No Offer or phase ceiling increase. Mount with NoCopy=true and an exact per-plan
name. Verify local driver, tmpfs options and installation/attempt/generation/spec
labels before adoption, start or deletion. Never attach a pre-existing orphan as
fresh execution. Uncertain dispatched creation stays charged; missing-container
cleanup requires retained definite creation settlement or a prior removal claim. The one fixed mailbox is private
to this container, separate from inputs/secrets/retained outputs. Do not rename or
unlink its children; guarded volume teardown after physical stop owns mount cleanup.
No per-window fsync, append log, new process or lifecycle journal event.

The shared `@beetle/contracts/live-mailbox` format has128-byte envelopes at offsets
0 and65664 with a65,536-byte payload area between them; total65792 bytes. Envelopes
contain ASCII BLIVE001 at0, committed flag0/1 at8, big-endian revision at16, length
at20, SHA256 bytes24..55 and zeroes elsewhere. Revision1..65536 never wraps; body
length1..65536. Write busy head/footer, body, then committed footer/head, awaiting
each actual original and bounding partial writes. Charge body+512 envelope bytes
before IO against finite admitted lifetime output; never retry uncertain effects.
Readers require exact extent, equal canonical committed envelopes and body hash,
then existing frame capture and revision==publishedSequence. Truncation, growth,
mixed bytes or invalid digest means unavailable without retry or age refresh.

The producer sink owns one original and one bounded body copy; close fences and
drains actual write/close originals. Failed cleanup retains explicit failed
quiescence. Native creation, admitted tmpfs wiring and physical stop/read drainage
are mandatory before enabling the producer in images.

The [approval constraint](../../decisions/014-live-metric-approval-authority.md)
requires trusted compile-owned scope/epoch/subset before consumption; never infer
approval from a frame. Shared k6 policy and existing staged launch fields now supply
assignment; generic actor/transport wiring remains pending.
Reader age bounds capture, source-window end and publication to6s with no future
timestamps. Unchanged revisions retain a monotonic expiry even if wall time freezes.
New revisions cannot overlap/regress source windows or captured/publication times.

Agent exposes finite authenticated scope/journal-authority-bound reads from the
fixed mailbox of its matched active container only, never caller paths. Docker
archive transport must cap actual stream bytes independently of advertised length,
parse one expected regular entry without extraction/links, and drain originals.
Reuse existing ordinary transport credits: globally<=2 telemetry originals, no queue,
control/cancel priority preserved. Volume verification cannot block stop/kill of an independently matched container.
Root/name replacement or scope/epoch mismatch fails closed; normal atomic replacement races return explicit unavailable. Reads,
decode, encode and response share a fixed<=5s deadline and original lifetime.
Backend resolves scoped run/attempt first, retains no corpus/subscriber registry,
and returns<=64KiB. Browser polls visible selected active attempt every2s only after
prior original settles; stops/retires ownership on scope/session/attempt change.
Errors/staleness are explicit; terminal state switches to published sealed history.
SSE, arbitrary live series selection and replay are not implied by this component.

## Attempt publisher composition

Only trusted packaging may set liveMetricMailbox; staged configuration cannot.
The shared policy selects<=20 eligible execute/engine descriptors, preferring
latency/errors/throughput/load; prepare/control and other omissions stay explicit.
Validated raw config and compiled input use the same catalogue rules. Capture/freeze
before effects. Assign UUID from canonical scope/generation, intent and runtime spec
digests. One logical producer per launch; replacements need a new launch identity.

Carve at most8MiB and one eighth of total output, further capped at one eighth of
execute output. Reduce history allocation; never extend admission. Charge the
initial65792-byte extent plus sink body/envelope writes conservatively. Publication
starts after measured-phase transition and drains before collect starts; report
these bytes in execute completion. A safe advisory failure leaves the test outcome
alone. Failed native/publisher cleanup prevents sealing. Receipt.liveMetrics reports
status/reason/produced bytes/quiescence separately from the authoritative verdict.
Original phase/global remaining time bounds publication, without the per-IO60s cap.

## Focused acceptance

Core checks: existing projection parity for every kind, percentile bounds/zero ratios,
frozen subset/source mutation, gaps/missing series, high cardinality, latest-slot
replacement, one original, exact coalescing, cadence/clock rollback, byte/lifetime
caps, failure fencing, cancellation/late settlement, no final flush, close failure.
Use synthetic clocks and controlled sink; no Docker/native build/full-suite repeat.
First core packet must not claim filesystem safety, runtime integration or live UI.
Physical producer/agent tests and runner/public/browser connection follow before
A03/V08/V09 feature acceptance; measured overhead remains separate qualification.
