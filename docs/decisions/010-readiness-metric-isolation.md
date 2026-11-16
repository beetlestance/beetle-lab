# Readiness and measurement metric scope

Status: implemented private correction; native/Linux qualification pending. The
shared evidence layout isolates preparation from measured summaries/accumulators.
ADR008's marker alone cannot filter preparation metrics.

## Native scope

Use pinned k6 v2.2.0 custom VU tag `phase=prepare` during setup and `phase=execute`
during default iterations. These tags apply even with system tags disabled.
Temporarily remove phase only while emitting the untagged measurement marker;
restore prepare in finally before setup returns. k6 emits setup I/O at function
return, so leaving the tag cleared would misclassify those bytes.

HTTP/custom request/assertion/transport metrics must distinguish these phases.
Measured live/final totals exclude preparation. Preserve diagnostic preparation
separately when retained; never merge it into measured totals silently. Existing
iteration metrics are emitted only for full default iterations in this version.
`dropped_iterations` is executor-scoped after setup and remains unfiltered.
Scheduler `vus`/`vus_max` start before setup and are engine-scoped; VU tags cannot
turn their native thresholds into measured-window thresholds.

Generate one consistent native submetric criterion order everywhere, including
phase and request/assertion filters. k6 preserves the first-created spelling of
equivalent tagsets. Summary projection and collection must share that mapping;
public metric keys alone cannot stand in for native-key provenance.

## Preserve rate and discovery semantics

Keep native k6 counter-rate evaluation and discovery early abort. Filtered counters
still divide by the whole native engine duration, which includes setup. Label
that denominator explicitly; do not call it measured-interval requests/second.
`http_req_failed` is a sample ratio, with a different denominator.
Capture native `data.state.testRunDurationMs` from the default legacy summary shape;
missing timing remains unknown. Do not enable NewMachineReadableSummary without a
separate producer/reader compatibility change.

Final-only wrapper reevaluation would remove discovery's abortOnFail behavior and
is not an acceptable substitute. Measured-window rate charts may use their explicit
window duration; they must not be confused with native counter-rate SLOs. Preserve
engine-scoped gauge thresholds and identify their scope in results/reports.

## Bounds and qualification

Keep the existing 200 request/assertion-plus-aggregate label-set limit. Phase tags
do not multiply each request/assertion's assigned map, but add two aggregate maps
beside the untagged control map. A blind Cartesian expansion would exceed the
current 4600-series claim. Use an exact per-metric allowed-series catalogue within
that ceiling; reject impossible combinations. Do not silently widen the limit.
Update decoder, accumulator, runtime, threshold/projection mapping and summary
reader together, including source times, native key and denominator provenance.

Private summary v2 closes timing to `{testRunDurationMs:number|null}` and every
metric to nativeKey/scope/provenance/values/thresholds; v1 has no fallback. Public
wire schemas are unchanged. Counter provenance says engine-duration; native Rate
provenance says samples. Preparation diagnostics are validated then discarded.
Delayed marker delivery retains exact execute totals and at most three pending
source-second buckets without publication. Aged-out buckets explicitly increment
markerDelayDroppedBuckets, separate from source lateness. Source execute samples
preceding the marker fail measurement; source time is still correlation only.
Pre-marker gauges retain engine totals; only actual post-marker samples enter
windows. No carry-forward or synthetic zero is produced.

Require fixture coverage with slow/failing/retried readiness and native phase-tag
checks, plus existing discovery/rate/gauge regressions. Source research does not
establish an executed native or Linux/container qualification.

Sources: pinned [execution tags](https://raw.githubusercontent.com/grafana/k6/v2.2.0/internal/js/modules/k6/execution/execution.go),
[runner lifecycle](https://raw.githubusercontent.com/grafana/k6/v2.2.0/internal/js/runner.go),
[counter-rate thresholds](https://raw.githubusercontent.com/grafana/k6/v2.2.0/metrics/thresholds.go),
[summary timing](https://raw.githubusercontent.com/grafana/k6/v2.2.0/internal/js/summary.go),
[submetric names](https://raw.githubusercontent.com/grafana/k6/v2.2.0/metrics/metric.go).
