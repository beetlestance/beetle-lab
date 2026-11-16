# Timeout watchdog

Public entrypoint: `index.ts`. `service.ts` owns bounded watch registration and
independent polling; `watch.ts` retains original typed stops and draining close.
`input.ts` snapshots fixed own data fields without traversing unrelated properties.

The installation captures monotonic time before reading durable supervision and
registers admittedAt/timeoutMs/high-water/fence before staging. Deadlines never
restart. Wall and monotonic ceilings both apply; invalid clocks fail closed.
Stop acknowledgement means intent only, not runtime exit or release.

At most64 watches, one interval, no pending queue. One timeout stop may escalate
once to clock_integrity; both originals drain. Stop rejection retains the
failed owner and rejects close. Closing fences callbacks and drains originals.
Supervisor dispatch-time checks and lifecycle ownership remain separate.

Contract: `docs/design/lld/timeout-guard.md`.
Checks: `npx --no-install vitest run agent/test/timeout --maxWorkers=1`;
`npx --no-install eslint agent/src/timeout agent/test/timeout`.
