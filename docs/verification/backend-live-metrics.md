# Scoped backend live metrics

Status: locally verified backend path; browser/packaging activation remain pending.

A compact read-only worker transaction returns current Run plus retained execution
binding, never Offer/config bytes. Parent and worker independently validate16KiB
DTO bounds and exact scope/run/attempt. The shared existing binding query preserves
published-result behavior; live additionally requires retained run/scope/intent,
acknowledged generation1 and valid physical Journal authority. No migration.

The service admits two originals without a queue. It resolves the selected active
attempt before agent I/O, rechecks binding/current state afterward and checks frame
freshness immediately before return. Cancelled, terminal, changed-authority,
stale/future/wall-regression values are unavailable. Five seconds cover metadata,
private network, capture and final reconciliation; ignored-abort originals remain
charged through settlement and shutdown. No corpus, scheduler or metadata writes.

Private live reads share the installed gateway and ordinary credits, with a separate
two-original telemetry subset and64KiB response bound. Public API uses existing
local authentication, scope/run/attempt parameters, no selectors/body, no-store and
a two-context/five-second response lifetime. The generated client binds scope,
attempt and generation and applies a shipped64KiB response-byte cap.

Scoped evidence covers compiled-worker reopen/parent capture, binding corruption,
original cancellation/drain, native HTTP custody, freshness and generated client.
Actual loopback proof connects private agent HTTP, the real gateway, scoped SQL,
the service, authenticated public HTTP and generated client without metadata change.
A separate real timeout proof retains two ignored-abort originals past public
response destruction and through shutdown. This uses synthetic frames, not a k6
container/browser activation or overhead qualification. User services stay unchanged.

The cross-service proof belongs to tools/qualification/native-application/live-http.test.ts;
service tests consume shared contract fixtures without importing another service.

The composed proof caught an extra attemptId passed into a strict RunKey; explicit
projection corrected it. Independent review caught age expiry during final metadata
reconciliation; final freshness/rollback regressions cover that correction.
