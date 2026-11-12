# Backend file deletion driver

startOutputDeletionRuntime processes existing committed intents only. One sequential
file step shares the installed native store/credits and bound metadata worker.
Prepare result+settled precede plan persistence; remove consumes only persisted plan.
No new intent, producer cleanup, pin release, tombstone, quota refund or public API.

A bounded cursor/current intent/ordinal is advisory; metadata owns recovery. Close
fences timers/admission and waits issued originals. Rejected native quiescence
retains its job and remains pending after failure notification; it never permits
parent namespace release. Busy native admission defers to a later finite pass.
Contract: docs/design/lld/output-deletion-runtime.md.
Checks: vitest run app/test/output-deletion-runtime and affected output-runtime.
