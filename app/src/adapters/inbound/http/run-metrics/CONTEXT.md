# Metric history HTTP

Public entry: registerRunMetricRoutes. Shipped authenticated JSON operations reuse
schema compilers and Host/Origin/session authorization. One request lifetime owns
original service reads, deadline/cancellation and final response. close fences
requests and closes/drains service before shared metadata/native adapters close.
Routes: listRunMetricSeries, getRunMetricSamples, getRunLatencyAttribution.
The stopped-history read serves only scoped, finalized checkpoint observations.
No public file paths or live transport. Focused checks: app/test/http/run-metrics.
