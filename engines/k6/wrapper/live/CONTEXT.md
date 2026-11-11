# Advisory metric publisher core

Public entry: createLiveMetricPublisher in index.ts; fixed types in types.ts.
Trusted accumulator windows project using the shared metric owner and bounded
frame codec. One latest pending projection and one write original; no queue,
retries, source corpus, filesystem or native attempt integration.
Acceptance never calls the sink. Publication timers enforce 2s monotonic cadence.
Frame scope/subset and original capabilities are captured before effects.
Stop fences synchronously, discards pending data, aborts hints and drains actual
write then close originals. Cleanup failure remains fenced and observable.
Caller must provide physical output accounting, approved subset and root custody.
Focused checks: engines/k6/wrapper/live/*.test.ts.
