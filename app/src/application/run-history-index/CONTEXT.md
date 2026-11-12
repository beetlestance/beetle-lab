# History indexing lifetime

startRunHistoryIndexer owns one HistoryTurn, no detached queue. Each turn's fixed
45s monotonic budget begins before scan and includes metadata/native/projection/
commit. Independent expiry immediately fences/aborts, records sticky failure and
notifies; held originals still occupy admission and close waits for settlement.
All phases check the same owner after awaits and before another effect. Existing
commits can have unknown outcomes; restart/CAS replay never causes execution.
One indexed due key per turn; pending publication defers30s, busy defers1s. Known
metric read failures persist unavailable; unexpected storage/lifetime failures
stop the indexer with observable state. No target/engine/cleanup effects.
Private metadata originals retain failed worker termination. Shared metadata,
metric service and namespace remain bootstrap-owned. Bootstrap must drain this
indexer before closing those owners. Contract: run-history-summary.md.
Focused tests: app/test/run-history-index; fake clocks test held originals.
