# Results

The k6 wrapper (`engines/k6/wrapper`, `engines/k6/report`) writes sealed result
artefacts inside the admitted container; the agent carries them; the application
(`app/src/application/run-*`) verifies and serves scoped reads; the browser renders
them. Advisory live metrics take a separate, unsealed path. Numeric meaning lives
once in `contracts/src/metrics`; request and response shapes live in `contracts/api/v2`.

## Sealed artefact set

| Kind | File | Ceiling | Present when |
| --- | --- | --- | --- |
| summary | `beetle-evidence.json` | 1 MiB | native summary was produced |
| `numeric-final` | `numeric-final.json` | 1 MiB less warnings and diagnostics | always on a sealed performance result |
| `metric-windows` + `metric-index` | `metric-windows.ndjson`, `metric-index.ndjson` | combined ≤ min(256 MiB, quarter of the remaining output) | history retained |
| `k6-warnings` | `k6-warnings.json` | 4096 B | native stderr was observed |
| `k6-diagnostics` | `k6-diagnostics.json` | 32 KiB | native diagnostics were observed |
| `performance-report`, `metrics-csv` | `performance-report.txt`, `metrics.csv` | 256 KiB each, 512 KiB together | collect succeeded |
| `target-runtime` | `target-runtime.json` | 1 MiB, 256 samples | `targetSampling` is configured |

Every ceiling is carved from the accepted Offer output budget by
`engines/k6/wrapper/attempt/reservation.ts`; none raises a user budget or installed
ceiling. Order of carving: control clamp(total/32, 64 KiB, 64 MiB), numeric 1 MiB
(including 4096 B warnings and 32 KiB diagnostics), result 64 KiB, summary 1 MiB,
reports 512 KiB, target 1 MiB if enabled, live min(8 MiB, total/8) if enabled; of the
remainder, history takes ≤ min(256 MiB, quarter) and build ≤ 89 MiB. History is
further capped at the execute-phase allowance less the 1 MiB summary reserve and the
live allowance. History or build below 64 KiB, or a collect phase with less than
64 KiB drain room, fails `output_limit` before native load; history is never
silently disabled or thinned. Charged bytes count once, in the phase that wrote them.

All artefacts share one custody rule (`engines/k6/wrapper/artifact-custody`):
exclusive no-follow create, mode 0600, expected UID, one link, streaming SHA-256
through EOF in ≤ 64 KiB reads, fsync, original close, then a named identity recheck.
Partial or unverified files stay retained and charged; no sealed manifest names them
and no speculative unlink runs. Only the atomic published manifest authorises reads.

## Metric history archive

| Rule | Value |
| --- | --- |
| Header | version 1, binds organisation, workspace, attempt, generation and data artefact UUID |
| Window | exactly one source second (`end - start = 1000 ms`), strictly increasing, non-overlapping; gaps allowed and visible |
| Records | sequence 1..65536; data record ≤ 1 MiB including newline; index record ≤ 256 B |
| Index row | sequence, start, end, byte offset (header included), record length |
| Data footer | window count |
| Index footer | count, complete data bytes and data SHA-256 |
| Writes | serial, ≤ 64 KiB each; concurrent append or seal refuses as busy |

Unoccupied intervals are never written as zero observations. Readiness-scoped values
never enter history. Every frame, header and footer byte is charged before its write;
an excess is `output_limit`, never silently truncated history. Footer room is reserved
before records are accepted. Crash prefixes are not evidence. A partial archive never
gets a sealed descriptor or `windowsRetained: true`, and a failed archive cleanup
fails the attempt. Enforced by
`engines/k6/wrapper/attempt/archive`.

## Run result read

`GET …/runs/{runId}/result` returns the active attempt's sealed `EngineResult` or
null. The metadata reader resolves Run and active attempt in one transaction, then
re-verifies the adopted source envelope and derives the result from the sole
manifest; no extra summary body is stored. Replies are ≤ 73728 B and use the shared
large-original lane. The client matches run ID, scope, attempt and generation 1; the
UI also matches `Run.activeAttemptId` and engine and drops old results on any switch.
A sealed result renders as provisional until the Run is terminal; reading never
marks publication or outcome (`app/src/adapters/inbound/http/runs/result.ts`).

## Historical metric reads

`…/attempts/{attemptId}/metrics` lists series; `…/metrics/samples` reads one ordinal.
A read for an earlier attempt uses that attempt's own published artefacts, never the
Run's current engine or head pins.

| Limit | Value |
| --- | --- |
| Page size | 1..100 items, page ≤ 262144 B |
| Series ordinal | 0..4095 |
| Cursor | canonical base64url tuple ≤ 512 B, bound to scope, attempt, manifest, lane and selection/range |
| Time range | defaults 0..8640000000000000 ms, `from < to`; window overlaps when `end > from` and `start < to` |
| Descriptors examined | ≤ 128 published artefacts |
| Index | ≤ 1024 + 65536 × 256 + 256 B, streamed fully with SHA/EOF per sample query, ≤ 100 rows retained |
| Data range | one contiguous native read ≤ 8 MiB (newest suffix kept), one ≤ 1 MiB frame decoded at a time |
| Deadline | one 30 s monotonic budget across metadata, native read, parse and serialisation |

Availability is `pending | absent | unavailable | ready`; only `ready` carries
measurements. Recorded history needs exactly one `numeric-final` (v3 or v4) plus one
window/index pair whose headers and footers bind the same scope, data UUID, bytes,
SHA and count. No pair is `unavailable/not_recorded`; an unknown private version is
`unavailable/unsupported_format`; a broken pair is a storage failure. Sample pages
walk backwards from the newest window, points within a page ascend, and a null
cursor means the requested range is exhausted, not that capture was complete.
Missing samples are absent points or null ratios, never zero. One operation runs at
a time per service (`busy` otherwise); abort returns early but the native original
stays owned until settlement. Without byte or hash capability, ready reads fail 503.
Owner: `app/src/application/run-metrics`.

The browser chart holds ≤ 1000 points and ≤ 1 MiB, issues ≤ 10 sequential page
requests per action, polls a pending catalogue every 2 s only while visible, and
draws real gaps rather than interpolating.

## Live metric snapshots

Advisory only; never a verdict input and never a substitute for sealed history.

| Stage | Contract |
| --- | --- |
| Subset | ≤ 20 execute/engine descriptors chosen by `contracts/src/k6-live` before effects (latency, errors, throughput, load first); omissions counted; prepare/control excluded |
| Approval | scope, producer epoch UUID and subset digest derive from compile/launch inputs; readers never learn approval from a frame ([decision 014](../../decisions/014-live-metric-approval-authority.md)) |
| Producer | one pending projection, one write original, ≤ one publish per 2 s; writes ≤ min(65536, 1 + timeout/2000); no queue, retry, restart or final flush |
| Frame | version 1, ≤ 65536 B, `coalescedWindows = sourceSequence − publishedSequence`; series totals cover one source window only; `upstreamCoverage` unknown |
| Mailbox | dedicated tmpfs volume at `/beetle/live`, 128 KiB and 4 inodes, carved from the temporary allocation ([decision 013](../../decisions/013-live-metric-mailbox-custody.md)) |
| Envelope | `BLIVE001`, 128 B head and footer around a 65536 B payload (65792 B total); revision 1..65536 equals `publishedSequence`; payload is gzip, decoded ≤ 64 KiB |
| Budget | ≤ min(8 MiB, total/8, execute/8), taken from history; the 65792 B extent and every write are charged to execute |
| Agent read | ≤ 5 s, two of the 32 shared transport credits; capture, window end and publication ≤ 6 s old, never future; returns `X-Beetle-Live-Fresh-For-Ms` ≤ 6000; a missing, malformed or exhausted header makes the snapshot unavailable |
| Backend | `…/metrics/live`, resolves scope, run and active attempt before and after IO; ≤ 64 KiB reply; 5 s lifetime |
| Browser | polls the visible selected active attempt every 2 s after the previous read settles; switches to sealed history at terminal state |

Freshness is compared only on the agent's wall clock; each hop subtracts its own
monotonic elapsed time, so clock offsets between services never extend the 6 s age.
Unchanged revisions keep their original timestamps and expiry. A truncated, mixed or
mis-hashed mailbox image, plaintext payload, regression or overlap is `unavailable`
without retry. A safe producer failure leaves the outcome alone; failed producer
cleanup prevents sealing. Advisory producers never throw into the native drain or
the authoritative metric callback. A duplicate, overlapping or out-of-order window,
or a counter or clock overflow, permanently disables the live producer with a fixed
status. Publication starts after the measured-phase transition and drains before
collect begins. The image marker `BEETLE_K6_LIVE_METRICS_V2=1` enables the
profile; a suite or Offer cannot.

## Derived presentation

| Producer | Rules |
| --- | --- |
| Performance report (`engines/k6/report`) | text and CSV derived from the mapped result and admitted numeric snapshot, never from configuration, target URLs, headers, request bodies, datasets or secrets; ≤ 4600 series; overflow rejects the whole report with `output_limit`; blank CSV cells mean unavailable; leading formula characters neutralised; no rate recomputation or percentile averaging |
| k6 warnings (`engines/k6/wrapper/process/warnings.ts`) | classifier keeps ≤ 4096 B per line, ≤ 65536 B per chunk; counts insufficient VUs, high cardinality, max duration and other; unknown or discarded input makes coverage `partial`; counters count log records, not incidents or dropped iterations, and a zero under partial coverage proves nothing; an arrival hint appears only for a single arrival-rate scenario, and its median comes only from the execute-scoped global `iteration_duration` trend, never request latency; no raw message, URL or request data persisted |
| Target runtime (`engines/k6/wrapper/target-sampling`) | one fetch at a time, `redirect: error`, no credentials, ≤ 64 KiB per body; interval 1000..60000 ms, timeout 100..5000 ms (≤ interval), cooldown 0..60000 ms inside execute; stops and marks `limited` at 256 samples or 1 MiB; the path is relative under the compiled target, with no query or fragment and no segment that changes the origin; a failed reading only marks that sample unavailable, but failing to write, verify or seal `target-runtime.json` fails the execution |
| History summaries (`app/src/application/run-history-index/`) | one turn every 1 s, 45 s deadline; busy defers 1 s, unpublished sources and retirement in progress 30 s; integrity, unavailable and deadline read failures persist `unavailable`; commits bind run, attempt, manifest and artifact |
| Load advice (`web/src/features/runs/load-advice`) | dropped load needs one execute `dropped_iterations` counter with empty tags; planning needs complete coverage and one execute `iteration_duration` trend; VUs = ceil(median s × rate × (1 + headroom/100)); inputs ≤ 16 characters, rate ≤ 1000000, headroom 0..500 % (default 20 %) |

Warnings and target readings are advisory; they never change assertions or
thresholds. Missing series or readings are unknown, never zero. Target values are
target-reported and never relabelled as engine resource measurements.

Browser artefact reads (`web/src/lib/verified-artifact.ts`) share two originals
across kinds, verify length, SHA-256 and fatal UTF-8 within one 5 s read, and retire
on session, scope, attempt or artefact change without releasing unsettled originals.

## Run comparison

`POST …/comparisons` is a CSRF-guarded read with no side effects.

| Rule | Value |
| --- | --- |
| Runs | 2..4 distinct canonical IDs, first is baseline; all terminal and in scope, else 404 or conflict, never partial |
| Metric | optional baseline `RunMetricKey`; request/assertion aliases remapped by stable ID per revision; deleted work is `not_applicable` |
| Config diff | ≤ 100 pointers per peer, ≤ 65536 nodes, ≤ 4096 pending pairs, depth 64, ≤ 512 B per pointer; excess becomes a `limited` parent/root change |
| Reply | ≤ 262144 B; no config values, headers, bodies, URLs or secret locators |
| Lifetime | one active comparison per installation, ≤ 4 sequential run reads and metric lookups, one 30 s deadline |

Identity, version, active attempt and pinned revision are rechecked after source
reads. Differences are facts with fixed warnings (unknown secret version, target
revision or contention, sampler disabled, missing or partial result, limited diff,
metric unavailable or partial); they never claim runs are comparable. Engine result
summaries never override a Run's application outcome. Without a metric selection no
metric bytes are read, and a series ordinal is never a cross-run identity. Equal
revision pins skip the diff only after their content is proven equal; equal pins
with different content fail. Owner:
`app/src/application/run-comparison`.

## Resource observation publisher

`agent/src/observation/publisher.ts` turns resource samples into the journal
observation that admission reads. Interval 250 ms (10..5000), sample timeout
1000 ms (10..30000), freshness TTL 2000 ms (100..300000, greater than both); one
sample and one write original, one pending observation, snapshots ≤ 16 KiB.
Readiness needs a fresh acknowledged known sample while both output and timeout
guards are ready. Guard loss, expiry or clock failure publishes a full unknown
observation with zero capacity, and only a strictly newer complete sample restores
readiness. A `stored: false` reply only revokes readiness; a rejected or failed
journal write stops the publisher permanently, with no retry, and close then fails. `snapshot()` returns the acknowledged frame with its
original expiry; reads never renew it. Close publishes a final unknown revocation;
a failed revocation keeps ownership and rejects close.

## Related

- [Decision 008: measurement boundary](../../decisions/008-measurement-boundary.md)
- [Decision 009: result seal](../../decisions/009-result-seal.md)
- [Decision 010: readiness metric isolation](../../decisions/010-readiness-metric-isolation.md)
- [Decision 011: k6 outcome evidence](../../decisions/011-k6-outcome-evidence.md)
- [Decision 013: live metric mailbox custody](../../decisions/013-live-metric-mailbox-custody.md)
- [Decision 014: live metric approval authority](../../decisions/014-live-metric-approval-authority.md)
- [Decision 026: live metric freshness budget](../../decisions/026-live-metric-freshness-budget.md)
- [Exports](exports.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `engines/k6/wrapper/attempt/reservation.ts` | `f10b08b3c4fd` |
| `engines/k6/wrapper/attempt/archive/` | `94df1cb0c1a2` |
| `app/src/application/run-metrics/` | `dcd16994160c` |
| `app/src/application/run-comparison/` | `cddffebb9dee` |
| `contracts/src/k6-live/` | `2d0d9eb2c0d8` |
| `agent/src/live-metrics/` | `d042e8ca9260` |
