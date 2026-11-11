# Live run metrics
Public createRunLiveMetricsService uses compact RunExecutionReader and the existing
installation gateway. Two original operations, no queue/background loop or corpus.
Validate scope/run/selected active attempt and durable physical binding before I/O;
recheck the same authority/current active run after it. Never reads Offer/config.
Five-second whole-operation lifetime; original metadata/network calls remain owned
after caller abort until settlement. Close fences synchronously, aborts and drains.
Shared frame/hash/64KiB validation and <=6s capture/publication/window-end age,
no future or wall regression; freshness is rechecked after final metadata read.
No durable mutation, launch, ACK, retry or inferred execution/result status.
Tests: app/test/run-live-metrics and app/test/http/run-live-metrics.
