# Verified history summary projection

Status: reviewed H2 implementation; [evidence](../../verification/run-history-summary.md).
Metadata migration018 and native arm64 production/restart are locally verified;
release/platform/browser qualification remains separate.
Parent: [history queries](run-history-query.md). H3 text search remains separate.

## Public values

Keep the existing authenticated listRuns route/query/cursor. RunPage adds required
summaries, an array <=100 in exactly the same order/length as items. Each summary
binds canonical runId and active attemptId. Shared client/application page matching
rejects missing, duplicate, foreign, mismatched and over-budget summaries. Run detail,
enqueue and comparison Run DTOs remain unchanged.

RunHistorySummary has closed fields: runId, attemptId, availability, source,
testDurationMs, requestCount, requestsPerSecond, httpFailures, httpSamples,
httpFailureRatio, httpP95, publishedArtifactBytes, retainedLogicalBytes and
metadataAllowanceBytes. Every field is required; unavailable scalar facts are null.
Availability is pending|ready|not_recorded|unsupported_format|unavailable.
A summary encodes within2048 bytes; the complete existing RunPage stays <=1MiB.

Source is null unless metrics were verified. Otherwise it binds generation1,
manifestDigest, numericArtifactId, numericSha256, numericVersion3|4,
measurementSourceTimeMs and existing RunMetricCoverage. httpP95 reuses
RunMetricPercentile, retaining histogram estimate/interval/scale, never an exact
percentile claim. Ready can contain null fields when an individual metric is absent.
Non-ready summaries have null metric/source fields. Logical storage facts remain
independently observable. Retained logical bytes include the separately charged
backend cleanup reserve; metadataAllowanceBytes sums output metadata and any charged
cleanup control allowance. An unreserved legacy original has no charged cleanup
allowance; this does not establish zero cleanup debt or cleanup permission.
Published bytes require a verified published catalogue.

testDurationMs is k6's measured state.testRunDurationMs ([native summary](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/)), collected by the existing
sole summary collector. Label it k6 test duration, not requested-to-stop, configured
duration, queue time or an execute-phase-only timer. Version4 numeric-final adds
timing:{testRunDurationMs:number|null}, emitted only from complete native collection.
Existing v3 remains readable with unknown duration and rate. No migration invents
duration for prior evidence. Native duration0 has unknown RPS, not infinity.

RPS is the observed execute HTTP request count divided by k6-reported test seconds.
Expose that denominator in the UI. It is not configured arrival rate or peak RPS.
Missing duration/count yields null. HTTP failures are http_req_failed samples,
separate from assertion failures or overall test outcome.

## Aggregate owner and verification

Reuse the existing numeric parser, native custody and digest verification in
application/run-metrics. Extend its public internal service with one actual-original
history summary projection; catalogue/sample/lookup behavior stays owned there.
No new numeric/JSON archive parser and no percentile average. Backend projection
uses the separate @beetle/contracts/k6-history entry. The flat Node-free runtime
policy entry remains unchanged for the script builder's approved input graph.

Current producer stores HTTP totals per request, not a global HTTP series. A shared
pure k6 summary projector aggregates only known http_reqs/counter,
http_req_failed/rate and http_req_duration/trend identities in execute scope, with
phase=execute, one request label and no assertion tag. Sum each unique observed
request counter/rate once with safe arithmetic; merge trend distributions through
the existing mergeDistributions owner before projecting p95. Missing all samples
stays unknown. Never include readiness/prepare, engine, assertion or duplicate
series, or infer unobserved metrics as zero. Full numeric capture still verifies
the complete unique series set and source coverage before projection.

One indexing read can verify the <=1MiB numeric artifact and fixed archive edges
using the existing retained native owner. It does not reread the whole metric
window archive or fetch configuration per history row. Capture source identity
before awaits; wrong digest/scope/attempt/manifest fails without a usable summary.
Preserve partial window coverage honestly even when numeric cumulative totals
are complete. Unsupported formats are explicit, not coerced into the current one.

## Durable metadata and accounting

Migration018 adds bounded derivative columns to runs: history_summary_json<=2048,
history_summary_due_ms (safe epoch integer, default0). A partial due index selects
terminal runs lacking a stored summary in due-time/UUID order. Scan <=16 keys,
default one; no all-runs discovery or unbounded queue/backfill on startup.
Adding defaults/indexes preserves original rows, identities, receipts and charges.

The private summary port owns scan, defer and commit. Commit binds run/attempt,
generation, manifest and numeric artifact identity against the existing sole
published source/slot/finalization facts in one transaction. It never creates
source/publication/terminal/cleanup facts. Equal replay is idempotent, conflicting
or stale binding rejects. A lost successful commit reply cannot cause another
engine execution. Missing/corrupt data cannot become a ready summary.

Summaries are bounded control metadata within the existing retained64KiB logical
output-metadata policy. They are not event/artifact payload, an extra installation
charge or a claim about actual SQLite/WAL/filesystem allocation. At most one
<=2048-byte projection exists per retained Run; unclaimed runs keep pending values.
No output reservation/refund or terminal transition is contingent on indexing.
Metadata tombstones/cleanup retain their current protections. Projection JSON is
part of metadata18; a later reinterpretation requires an explicit migration rather
than silently relabelling retained values. SQL binds/coheres the projection witness;
the trusted metric owner verifies and derives the numeric content from actual bytes.

History SQL joins compact summary/allocation facts under its existing read
transaction. PublishedArtifactBytes is the verified original catalogue sum, not
current physical disk use. RetainedLogicalBytes and MetadataAllowanceBytes come
from the current exact attempt allocation in that same snapshot, not cached
estimates or published payload length. Missing allocation is an observed zero
logical charge; it says nothing about filesystem absence. Deletion cannot create
a false freed-byte claim; this slice grants no new cleanup/refund authority.

## Indexing lifetime and installation

One background original, no detached tasks or waiting queue. Each indexing turn
has one fixed45s monotonic deadline covering discovery, metadata/source capture,
native read, projection and commit/defer. An independent timer immediately fences
new phases, aborts native work and records a sticky deadline failure even when an
external metadata promise remains held. Check that same owner after every await
and before any new commit; late success cannot resume a retired turn. A commit
already admitted may have an unknown outcome and must replay identically later.
Do not reset the budget per artifact/callback or turn expiry into quiescence.

Private metadata adapter methods return actual settled originals. On a failed
worker carrier they await the existing worker termination before rejection; they
do not close a healthy shared store. Native reads retain result AND settlement.
Expiry/close notification never releases the one active slot or namespace until
those originals retire. Expose read-only indexer state through Application; no
log-only or swallowed fatal status. Bootstrap fences/drains the indexer before
closing shared byte/metadata owners. Held-scan, held-commit and late-success tests
must prove independent expiry plus retained custody, not only a metric timeout.

Default interval1s;
skip overlap. Start only with installed published byte custody. Use its own metric
read service with one admitted native original, separate from foreground history
chart admission. Aggregate new physical concurrency is explicitly one extra
bounded read; no per-row concurrency. Retain the original through metadata/native
result AND settlement, including abort/deadline/close failure.

A pending unpublished source defers the same key30s, preserving fairness and
unknown data without claiming absence. Busy defers briefly; format/absence become
explicit terminal projection states; failed integrity/native reads become unavailable.
Scheduling/storage failures remain surfaced through the existing bootstrap failure
boundary, not swallowed as empty success. Shutdown fences immediately, aborts and
awaits actual originals before shared published-byte namespace/metadata closure.
Restart scans the same indexed unfinished rows; successful derivatives survive it.

UI reads only RunPage projections. Show units, approximate p95 and coverage, k6
duration/rate basis, unknown values and logical-versus-published byte labels.
Apply/reset/refresh, late-reply fences and comparison cap remain unchanged.
No independent GET per row, summary polling loop or automatic execution retry.

## Acceptance

- Shared aggregate identities, safe overflow, merged histogram p95, missing/zero/
  partial coverage and no prepare/assertion leakage.
- Sole producer v4 measured timing propagation; v3 duration/rate unknown.
- Existing metric catalogue/sample behavior remains valid for both versions.
- Actual compiled worker migration from17, bounded due query plan, compact list
  join, CAS/replay/lost-reply/reopen and wrong source/attempt/generation rejection.
- Held scan/commit/read, independent whole-turn expiry, late success and close\n  retain actual originals/worker termination and shared file custody.
- Actual published native file digest -> projection -> worker -> authenticated
  generated client/UI; list pagination issues zero native/metric/config fanout.
- One relevant native engine qualification for changed artifact production; keep
  platform/browser/whole-release claims separate from composed fixtures.
