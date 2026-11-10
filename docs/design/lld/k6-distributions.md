# Bounded k6 duration distributions

Status: accepted implementation contract; product transport and UI remain separate
batches. Resource policy: [resources](resources-observability.md). The existing
native final-summary mapper remains the authority for threshold verdicts.

## Ownership and representation

The engine aggregation owner maintains mergeable positive-duration histograms for
trend series. It never retains a duration corpus or averages percentile values.
Use the base-2 exponential bucket model described by
[OpenTelemetry](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#exponentialhistogram).
This is an engine numeric representation, not a new telemetry service dependency.

Each distribution is versioned `exponential-v1`, with integer scale, positive
bucket offset/counts, exact zero count, total count, and observed minimum/maximum.
Empty distributions have count zero, null extrema and no positive buckets.
Counts are nonnegative safe integers; every increment, merge and count sum checks
overflow. Values must be finite and nonnegative. Negative, NaN and infinite values
fail measurement; a missing sample never becomes a measured zero.

Start at scale 4 and retain at most 64 contiguous positive buckets. The base is
`2 ** (2 ** -scale)`; bucket i has theoretical bounds `(base**i, base**(i+1)]`.
Downscale when the observed span cannot fit, merging adjacent bucket counts exactly
and disclosing the resulting scale. Never discard an extreme sample, clamp it
into a narrower distribution or increase the cap. Scale may decrease to -10,
which covers the finite positive IEEE-754 range within this bucket allowance.
Zero is tracked separately and never forces downscaling.

Mapping must handle exact powers of two, neighbouring representable values,
subnormals and Number.MAX_VALUE. Do not trust an uncorrected rounded logarithm at
bucket edges. Any necessary representational tolerance must be explicit in returned
quantile bounds; never claim an interval narrower than floating-point mapping can
support. All emitted JSON numbers are finite.

## Operations and quantiles

The aggregation public entrypoint exports the distribution type and bounded
record/snapshot, merge and percentile operations. Internal mutable storage remains
private. Snapshot arrays/objects are detached and deeply immutable. Bound checks
precede iteration or allocation on externally supplied distributions; reject extra
fields, inconsistent counts/extrema, invalid scales/offsets and oversized arrays.
A rejected record/merge must not partially mutate the previous distribution.

Merge at a common scale no finer than either input. Downscale further if necessary
to fit the cap. Preserve total/zero counts and extrema exactly. Merge compatibility
includes format and duration units; callers separately bind metric, labels,
execution phase and attempt identity. Never mix overlapping time ranges silently.

Percentiles support p50, p90, p95 and p99 using nearest-rank selection. Return null
for an empty population; otherwise return a finite estimate and conservative finite
lower/upper bounds clipped to actual observed extrema. Include source
`histogram-estimate` and the actual scale. Preserve exact zero and single-value
results. Consumers show the bounds/precision; these are not native-final quantiles.
Rank arithmetic must remain correct at safe-integer count boundaries.

## Accumulator and artifact integration

Keep the existing approved series catalogue, preparation exclusion, measurement
marker, late-point policy and at most three occupied source-second windows. Add a
distribution to each trend's published numeric total. Update mutable histogram
state in place; do not clone/serialize 64 counters per incoming point. Snapshot
only when a window is handed off or totals are finalized. Late points update final
totals but not already-closed windows; coverage remains explicit.

The final snapshot identifies quantiles as histogram estimates. The numeric-final
artifact advances its private format version and carries the same distributions
and provenance. Remove stale unconditional `quantiles: unknown` metadata; do not
change native-summary interpretation, EngineResult outcomes, source seals or credit.
The artifact retains its existing actual output allowance and 1 MiB cap. An
insufficient allowance is explicit output_limit, never silent distribution loss.

Current suite limits allow 64 requests, seven HTTP trends each and one iteration
trend: at most 449 retained execute trends. Preparation trends are discarded before
allocation. At 64 Float64 counters per trend, total plus three windows plus one
detached snapshot uses at most 1,149,440 counter bytes. This is not a whole-heap
claim: include series/maps, parser buffers, snapshot and serialization overlap in
bounded stress checks against the existing 8 MiB transient metric budget. Do not
raise budgets to make a test pass. Do not retain successive windows in the engine.

## Acceptance and limits

Test zero/missing, exact edges, adjacent floats, finite extremes, downscale, skewed
and repeated values, malformed snapshots, overflow, immutable snapshots, count
conservation and merging populations whose combined p95 differs from averaged p95s.
Test percentile intervals against independently sorted synthetic samples. Preserve
marker, preparation, lateness, cancellation, held sink and original-close controls.
Exercise the actual compiler maximum request count and bounded serialized output.

Scoped aggregation and affected wrapper/result tests, changed lint and affected
TypeScript are sufficient for this batch. The coordinator checks composition once.
Native image qualification follows executable window transport, not this private
numeric change alone. No live API/UI, historical window store, target sampler or
release qualification is claimed by implementing this contract.
