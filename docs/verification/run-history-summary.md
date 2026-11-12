# Verified history summaries

Status: reviewed implementation; frozen gates and native producer qualification
are pending. Basea7777f4; [owning contract](../design/lld/run-history-summary.md).
This record does not close H3 search, browser or release qualification.

## Behavior

History pages carry ordered compact summaries bound to each run/active attempt.
The table shows measured k6 test duration, observed execute HTTP count/RPS, an
approximate HTTP p95, HTTP failure samples, original published artifact bytes and
current retained logical allowance. Missing measurements stay unknown. The rate
uses the measured k6 test duration; it is not configured arrival rate or a peak.
HTTP failures remain separate from assertions and overall outcome.

Native numeric format4 retains the sole collector's measured test duration. Existing
format3 still projects known metrics with unknown duration/RPS. The shared HTTP
projector sums distinct request counters/rates and merges their latency histograms
before p95. It excludes prepare/readiness, engine and assertion identities and
preserves window coverage; it never averages percentile values.

One background original verifies the published numeric digest and existing archive
edges, then stores a source-bound <=2048-byte projection. History reads join only
compact metadata under the existing read transaction; they perform no per-row
native/config/archive request. Metadata018 preserves existing rows and charges,
adds a bounded due index and guards immutable source/attempt/CAS bindings.

Published bytes describe the original verified catalogue. Logical allowance uses
current allocation and the existing source/absence refunds, including metadata.
Neither is measured filesystem allocation. This slice grants no deletion, producer
retirement, file absence, accounting refund or engine retry permission.

## Lifetime and evidence scope

Each indexing turn has one45s budget including discovery, metadata and native work.
Independent expiry records sticky failure and aborts/fences new phases; held scan,
commit and native originals remain admitted through actual settlement. Failed
metadata carriers await worker termination. Shutdown drains readers before shared
namespace/storage owners; read-only Application state exposes indexer failure.

Focused evidence includes aggregate identity/overflow/quantile cases, v3/v4 source
projection, actual compiled-worker CAS/replay/reopen and migration, unchanged charges,
held-original/late-success/expiry controls, and failed-worker termination ownership.
A composed fixture publishes real native files, verifies their digest, indexes
through the compiled worker and reads authenticated public history across restart
without extra native reads. DOM fixtures cover units, missing/zero data, provenance,
wrong-attempt rejection, filters and the existing comparison cap.

Independent source review found no blocking implementation defects; reviewers did
not repeat the passing check lane. Final gate commands/timings and native producer
results will be recorded after that single frozen lane completes. No user service
was restarted or repository/image published during these focused checks.

## Remaining qualification

Native arm64 producer and normal installation indexing are pending this task's
single synthetic k6 run. Native amd64, packaged browser/Compose, soak/overhead,
release scans and supported rollback remain separate required release evidence.
H3 bounded indexed text/name search is not implemented by this slice.
