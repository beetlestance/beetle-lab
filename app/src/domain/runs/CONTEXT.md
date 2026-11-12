# Attempt observations

Public: mergeAttemptObservation({expected,previous,incoming}) in index.ts.
The shared ../attempt-observation owner validates and merges physical snapshots.
This wrapper rejects exportResult and projects only performance Run activity.
Projection returns dispatching/active/finalizing only; final admission facts request
finalization, not success. SQL atomics/finalization are separate future owners.
Contract: docs/design/lld/attempt-observation.md.
Checks: app/test/domain/run-observation*.test.ts, Node TS/lint/architecture.
