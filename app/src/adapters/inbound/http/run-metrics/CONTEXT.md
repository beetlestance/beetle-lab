# Metric history HTTP

Public entry: registerRunMetricRoutes. Shipped authenticated JSON operations reuse
schema compilers and Host/Origin/session authorization. Two request lifetimes
can overlap with one physical metric reader and one bounded waiting intent.
Each RequestContext owns deadline, cancellation and actual response settlement. close fences
requests and closes/drains service before shared metadata/native adapters close.
Routes: getRunMetricOverview, getRunChartHistory, getRunStoppedHistory,
listRunMetricSeries, getRunMetricSamples and getRunLatencyAttribution.
The stopped-history read serves only scoped, finalized checkpoint observations.
No public file paths or live transport. Focused checks: app/test/http/run-metrics.
