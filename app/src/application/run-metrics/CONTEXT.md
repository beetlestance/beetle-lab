# Historical metrics

Public entry: createRunMetricsService with frozen RunMetricServiceOptions.
One metadata/native read operation, no queue; caller abort returns failure while
original metadata/native result AND settlement remain owned. close fences and
drains without closing shared adapters. One original <=30 s monotonic budget via shared metric-read-lifetime.
Private archive codec transforms sealed k6 v3 numeric and v1 NDJSON pair into
bounded public series/sample pages. Fresh injected SHA streams full numeric/index;
partial data ranges rely on existing pinned native custody and indexed binding.
Index scan retains <=100 rows and <=64 KiB input buffers, selected contiguous data
range <=8 MiB and one <=1 MiB frame. No result/writer/accounting mutations.
Focused checks: app/test/run-metrics and app/test/http/run-metrics.
Internal lookupRunMetricSeries captures one exact RunMetricKey, reuses that same
verified source/projection and returns its ACTUAL original (no early deadline race).
Catalogue/sample routes retain their prior early caller failure and owned drain.
Lookup shares their one physical admission; no pagination/corpus or second parser.
readRunHistorySummary shares that same parser/actual-original lane and returns
compact v3/v4 source-bound scalars. Native4 timing comes from the sole collector;
HTTP request distributions merge through the shared k6 projector.
reader.getRunLatencyAttribution (latency.ts + pure rise.ts) streams the whole data
artifact once with full SHA (<=3600 windows, <=32 MiB, <=64 request labels) and
applies the fixed p95-rise definition in results.md "Derived presentation"; any
insufficiency is a fixed reason with rise null, never a guess.

reader.getRunChartHistory reuses scan.ts with the same full-SHA 3,600-window / 32 MiB
bound. <= 900 actual points retain endpoints; known-window count and observed peak
include all originals. Unknowns/gaps stay explicit, > 64 request labels refuse.
Reply <= 1 MiB / 65,536 nodes; no window corpus or new native admission. UI pending.
