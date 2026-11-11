# Sealed metric history reads and charts

Status: accepted first consumer of [metric archives](k6-metric-archive.md).
This is historical data after publication, not live unsealed-file transport.
Live metrics and wider report/compare/export scope remain in PLAN.

## Public read contract

Both authenticated GETs are under the requested organisation/workspace/run/attempt:
`.../metrics?limit&cursor` lists series; `.../metrics/samples` selects one ordinal
with limit1..100, optional fromTimeMs/toTimeMs and canonical cursor. Reuse
RunAttemptParams, existing Host/Origin/session guards and generated JSON client.
No file path/offset, engine image, raw config or filesystem selector is public.
Historical requested attempts use existing scoped publication readers; never
substitute the Run's current engine/head pins for that attempt's source.

RunMetricSeriesPage carries id/scope/attempt/generation1, manifestDigest,
availability pending/absent/unavailable/ready, reason, window count, total series,
measurement source time, window coverage, current <=100 descriptors and nextCursor.
Pending/absent have no manifest or measurements. Unavailable has a manifest but no
items; not_recorded/unsupported_format are explicit. Only ready has measured data.
Descriptors carry immutable ordinal0..4095, metric/kind/scope/tags/unit and final
numeric summary. Totals refer to the whole recorded execution, not the chart range.

RunMetricSamplesPage carries the same ownership/digest, selected descriptor,
window coverage, requested range, examined count, beforeWindow, firstWindow,
chosen source span, <=100 ascending points and nextCursor. Each point binds its
source-window sequence and start/end with one numeric summary. Counter sum is a
source-second bucket count; rate preserves numerator/denominator and nullable
ratio when no samples. Gauges retain latest source time/min/max. Trends expose
count/sum/extrema/mean and p50/90/95/99 estimates with source/scale/lower/upper.
Do not clamp legitimate floating mean roundoff or replace native threshold verdicts.

Pages, including metadata, are <=262,144 bytes. Keep one pure representation and
histogram validator/percentile implementation in @beetle/contracts/metrics.
Move existing metric value types by meaning, not copies of the engine algorithms.
Capture unknown bounded data, closed keys, finite values, safe counters and tagged
kind consistency. Trend count/extrema bind its distribution; mean equals sum/count.
Readiness/prepare values cannot appear as execution measurements. Missing samples
are absent points or null ratios, never invented measured zero.

## Cursor and reverse scan

Closed canonical base64url arrays <=512 bytes avoid oversized descriptive payloads.
Catalogue tuple: ['metric-series-v1',org,workspace,run,attempt,manifest,nextOrdinal].
Samples tuple: ['metric-samples-v1',org,workspace,run,attempt,manifest,seriesOrdinal,
fromTimeMs,toTimeMs,beforeWindow]. UUIDs lower-case; manifest lowercase SHA256.
Normalise omitted time bounds to0/8640000000000000; require from<to. All integer
positions are safe/bounded. Catalogue nextOrdinal is1..4095. Sample beforeWindow
is0..65536; initially the archive window count, then first examined sequence minus1.
Bind every cursor to scope, requested attempt, manifest, lane and selection/range.
No replay across a different selection or silent cursor recovery.

Sample pages start at the newest selected windows and move backwards. Examine at
most limit index entries; if their contiguous data range exceeds8MiB, keep the
newest suffix that fits. Points within a reply stay ascending. A selected series
may be absent from an examined window; advance the cursor anyway, never scan an
entire run to manufacture a full point page. A window overlaps the requested range
when end>from and start<to; return that whole bucket with its actual interval.
Null nextCursor means the requested source range is exhausted, not perfect capture.

## Publication and byte owner

Resolve existing RunArtifactsReader list/file lookups, at most128 descriptors.
Require exactly one numeric-final plus one metric-windows and metric-index pair
for recorded history. No pair means unavailable/not_recorded; a broken pair is
storage failure. Unknown private versions are unavailable/unsupported_format.
Require numeric-final v3 complete metric processing/retained IDs, matching scope,
count/bytes and one indexed data identity. Headers/footers must bind that same scope,
data artifact ID, complete data SHA/bytes and count; reject contradictory evidence.

Reuse the actual installation publishedBytes.read view. Full numeric read <=1MiB
is verified through EOF/SHA. Index size <=1024+65536*256+256 bytes; stream the whole
index per sample query with <=64KiB buffers, complete SHA/EOF and structural proof:
closed rows, sequence, monotonic times, contiguous offsets/lengths and final bounds.
Retain at most100 candidate rows, not the full index. Selected data is one contiguous
native range job <=8MiB; decode one <=1MiB frame at a time and validate exact indexed
length/sequence/time and catalogue dimensions. No whole-history array or per-frame
native job. Catalogue may probe bounded headers/footers; partial data reads rely on
native physical custody and indexed/schema binding, not a new full-file SHA claim.
Yield during long bounded parsing; no synchronous whole-index materialization.

RunMetricsService owns one operation, no queue, and captures readers/capability.
Both port methods take MetricReadContext {signal,deadline}; fixed <=30s monotonic
budget covers metadata/native/parse/final serialization. Never reset it between IO.
Wait for native result AND settlement; original work remains owned after abort.
No-agent configurations can report pending/absent metadata but ready byte reads
fail503, not fake empty success. Close aborts/fences/drains this service; it does not
close shared metadata/native adapters. HTTP has its own one-request lifetime owner.
Installed bootstrap supplies the same native view and closes HTTP/service before
metadata; preserve other input/artifact/agent shutdown and busy-publication semantics.
No migration, new writer, ACK, finalization, reservation refund or result mutation.

## Browser surface

Use existing app tokens/design, RunDetail, generated client and registered query
keys. First consumer is one selectable series chart, <=1000 projected points/1MiB
cache, one current catalogue page; other/live views remain later required work.
Load newest pages sequentially, at most10 requests per chart action, with original
abort/selection ownership checks before every next call. Stop on error. A bounded
partial view has an explicit limit notice and older/latest navigation; replace
views rather than accumulate a run corpus or cursor-keyed caches. Page/series/scope/
attempt/session changes retire late reads. Manual operations never overlap.

Pending catalogue polls2s only while visible; ready/absent/unavailable/error stop.
Do not infer publication from terminal Run state; retain terminal-refresh ownership.
Draw real source gaps, never interpolate missing points as zero or smooth across
them. Trend default is estimated p95 with bounds/scale available; label source and
whole-run totals. Counter chart labels source-second buckets; rates name samples.
Engine scope stays distinct from request scope. No raw artifact IDs, private paths,
JSON dumps, fake percentage progress or independent saved-file/integrity claim.
Keyboard selection, focus, small viewports and reduced motion use existing patterns.

## Acceptance

Actual native publication/metadata/TCP reads and real generated client establish
catalogue/sample values, reverse pages, range boundaries, missing series and source
coverage; storage charges/events stay unchanged. Cover corrupt/wrong pair/header/
footer/hash/row/sequence/UTF8, limits, cursor scope/selection/manifest, positive zero,
ratio missing/mean roundoff, abort/held original/late settlement/busy/shutdown.
Use exact wrapper-produced archive fixtures, not only hand-crafted JSON success.
Scoped chart tests cover generated-client composition, gaps/estimates/limits,
sequential calls, stale selections, paging/visibility and errors/manual retry.
Run changed tests/lint, Node/web types; coordinator reviews once and one composed
changed seam. No Docker/full-suite/overhead/native/browser qualification by inference.
