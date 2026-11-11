# Historical metrics

Public entry: createRunMetricsService with frozen RunMetricServiceOptions.
One metadata/native read operation, no queue; caller abort returns failure while
original metadata/native result AND settlement remain owned. close fences and
drains without closing shared adapters. One original <=30s monotonic budget.
Private archive codec transforms sealed k6 v3 numeric and v1 NDJSON pair into
bounded public series/sample pages. Fresh injected SHA streams full numeric/index;
partial data ranges rely on existing pinned native custody and indexed binding.
Index scan retains <=100 rows and <=64KiB input buffers, selected contiguous data
range <=8MiB and one <=1MiB frame. No result/writer/accounting mutations.
Focused checks: app/test/run-metrics and app/test/http/run-metrics.
