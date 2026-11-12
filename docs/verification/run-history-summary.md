# Verified history summaries

Status: locally verified, including native arm64 production/restart.
Basea7777f4; implementation21eb341, runtime-boundary correction20fd6cf; [owning contract](../design/lld/run-history-summary.md).
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

The frozen scoped lane passed500 tests across53 files:377 contract/worker tests
(27.54s),96 metric/producer tests (17.64s),27 DOM tests (14.43s). Lint, three type
projects, API/engine drift, architecture/docs and API/web/agent source builds passed;
that complete sequential lane took88.59s. Independent reviews ran no duplicate tests.

Native qualification exposed a real script-build regression: re-exporting the
backend projector through the flat k6 policy entry expanded its approved input
graph. The existing real-builder regression reproduced it. A separate k6-history
package entry restored the runtime policy byte-for-byte; provenance guards stayed
unchanged. The affected builder/budget/projection/composed24 tests passed in7.82s,
followed by appropriate entry/type/schema/architecture/build checks. Unaffected
contract/worker/DOM evidence was retained rather than rerunning all500 tests.

The corrected native run passed H2 publication, summary and restart checks but hit
a stale two-artifact verifier. Its exact inventory was updated to the current six
files; byte/hash/owner/seal/control/phase/credit checks stayed intact. Runtime image
inputs were unchanged, so this verifier correction reused the same images.

The final12.18s native arm64 run passed through actual agent/k6 containers, the
normal installed indexer, host backend, compiled worker and authenticated client.
It observed one readiness request, one execute request, no unexpected target calls
and one engine execution. Numeric4, native-summary timing and stored duration/RPS
agreed. p95/failure samples and published bytes were present; retained logical
charge104113 matched the independent event/manifest/artifact receipt arithmetic.
Restart preserved the summary; seal and reservation release passed; exact-label
container/network cleanup was verified. Task builders were removed. Engine log
capture remained unavailable under its configured driver and is retained as a
diagnostic failure, not log-inspection clearance.

Native runtime source was20fd6cf with a separately hashed verifier-only inventory
correction. Private evidence retains exact commits/dirty-input hashes, immutable
image/worker identities, commands/exits/timings, both failed probes and cleanup.
No user service was restarted and no repository/image was published.

## Remaining qualification

This is host-backend functional evidence; the one-request values are not a
performance benchmark. Native amd64, packaged backend/browser/Compose, soak/overhead,
release scans and supported rollback remain separate required release evidence.
H3 bounded indexed text/name search is not implemented by this slice.
