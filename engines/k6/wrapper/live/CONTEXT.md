# Advisory metric publisher core

Public entry: createLiveMetricPublisher in index.ts; fixed types in types.ts.
Trusted accumulator windows project using the shared metric owner and bounded
frame codec. One latest pending projection and one write original; no queue,
retries, source corpus, filesystem or native attempt integration.
Acceptance never calls the sink. Publication timers enforce 2 s monotonic cadence.
Frame scope/subset and original capabilities are captured before effects.
Stop fences synchronously, discards pending data, aborts hints and drains actual
write then close originals. Cleanup failure remains fenced and observable.
Caller must provide physical output accounting, approved subset and root custody.
Focused checks: engines/k6/wrapper/live/*.test.ts.
Private V2 mailbox payloads are gzip snapshots; public HTTP snapshots stay JSON.
Encode/decode each cap 64 KiB independently. Charge actual compressed bytes before
IO; sink also charges every header write. No byte/cadence/series limit is raised.
Optional target source (target.ts): at publication, read <=8 newest before/during
samples synchronously, filter future/stale/unordered ones and attach a fixed-key block.
A target block that cannot be read or fit is dropped and counted; metrics still publish.

Optional archivePrefix comes from the trusted archive owner at publication. It is
scope-bound completed-prefix evidence, never sealed output or crash durability.
A failed/invalid read or decoded/compressed/write-budget overflow omits only this
field, preserving available target data and metric publication. Existing envelope,
64 KiB and lifetime/cadence bounds remain. Matching release readers understand the
optional schema extension; older closed-schema readers reject enriched frames.
