# Live run metrics
Public createRunLiveMetricsService uses compact RunExecutionReader and the existing
installation gateway. Two original operations, no queue/background loop or corpus.
Validate scope/run/selected active attempt and durable physical binding before I/O;
recheck the same authority/current active run after it. Never reads Offer/config.
Five-second whole-operation lifetime; original metadata/network calls remain owned
after caller abort until settlement. Close fences synchronously, aborts and drains.
Shared frame/hash/64 KiB validation and agent-origin <=6 s freshness budget.
Only the agent compares source UTC. Recheck receiver monotonic expiry after final
metadata, then return that expiry and verification stamp alongside the frame.
No durable mutation, launch, ACK, retry or inferred execution/result status.
Tests: app/test/run-live-metrics and app/test/http/run-live-metrics.
