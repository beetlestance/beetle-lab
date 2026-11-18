# Public live metric reads
Public registerRunLiveMetricRoutes serves the generated getRunLiveMetrics operation.
Existing local session authentication precedes a two-context/five-second owner.
Reject queries/bodies; no-store. Scope/run/attempt service uses existing private
agent wiring only. <=64 KiB successful frame; safe existing API errors otherwise.
onSend rechecks the service expiry against its verification stamp, then carries
only the remaining integer budget as X-Beetle-Live-Fresh-For-Ms (1..6000 ms).
Missing, regressed or exhausted receipts fail closed; body shape is unchanged.
Response deadline destroys stalled output; original service remains owned/drained.
No SSE, history cache, subscription, launch, source transfer or retention effects.
Tests: app/test/http/run-live-metrics/native.test.ts.
