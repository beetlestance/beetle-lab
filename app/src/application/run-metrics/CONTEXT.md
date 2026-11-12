# Historical metrics

Public entry: createRunMetricsService with frozen RunMetricServiceOptions.
One metadata/native read operation, no queue; caller abort returns failure while
original metadata/native result AND settlement remain owned. close fences and
drains without closing shared adapters. One original <=30s monotonic budget via shared metric-read-lifetime.
Private archive codec transforms sealed k6 v3 numeric and v1 NDJSON pair into
bounded public series/sample pages. Fresh injected SHA streams full numeric/index;
partial data ranges rely on existing pinned native custody and indexed binding.
Index scan retains <=100 rows and <=64KiB input buffers, selected contiguous data
range <=8MiB and one <=1MiB frame. No result/writer/accounting mutations.
Focused checks: app/test/run-metrics and app/test/http/run-metrics.
Internal lookupRunMetricSeries captures one exact RunMetricKey, reuses that same
verified source/projection and returns its ACTUAL original (no early deadline race).
Catalogue/sample routes retain their prior early caller failure and owned drain.
Lookup shares their one physical admission; no pagination/corpus or second parser.
