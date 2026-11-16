# k6 load-plan compiler

`index.ts` exports pure `compileLoadPlan(ValidatedLoadPlan)` and schema-derived types.
`validation.ts` exports `validateLoadPlan(unknown)` and the convenient
`validateAndCompileLoadPlan(unknown)` boundary. Validation uses shipped AJV2020
schemas plus the shared bounded JSON encoder, returns a frozen branded snapshot,
and excludes raw values and AJV details from errors. Compilation checks semantic
capacity, identity, duration and ramp bounds before emitting any options.

This is a load-plan component, not a runnable suite. The runtime/export owner must
compose this compiler, provide each metadata entrypoint (`loadScenario0`, etc.),
and supply requests, data, assertions and execution/result collection separately.
No Node, filesystem, environment, clock, randomness, subprocess or network imports
are reachable from the pure `index.ts` entrypoint. The validation and generation
adapters are separate Node/build entrypoints. There is no cancellation or I/O work.

Input: version 1; 1–64 scenarios; explicit offsets/grace; 1–128 stages each;
0–128 structured SLO rules. Rules have unique IDs, metric identifiers (no selectors),
stat (`avg/min/max/med/p50/p90/p95/p99/count/rate/value`), operator and finite value.
The later runtime owns registering custom metric names and metric/stat compatibility.
SLOs pass on the provided comparison; discovery stopRules use its logical inverse.
Discovery aborts the entire k6 invocation, including all companion scenarios, and
metadata lists affected IDs. Exhaustion is inconclusive; a later result mapper
needs actual abort evidence and ordinary SLO results to decide the final outcome.

Integer durations use ms/s/m/h, workload/offset <=24h, grace <=1h, execution <=48h.
Constant duration and iteration maxDuration >=1s; stages/offsets/grace allow ms.
The conservative wall bound adds offset + workload + both applicable grace windows.
VU counts <=100,000; positive integer rates/steps <=1,000,000; iterations <=1e9.
A ramp has <=128 steps, reaches its maxRate exactly, and keeps one maxRate plateau
when startRate=maxRate. Per-VU total iterations are iterations*VUs, never shared.
Shared iterations >=VUs; ramping VUs require a positive starting or stage allocation.
JSON input <=1MiB plus shared encoder depth/node/collection limits; issues <=16.
Unknown fields, JS entrypoints, shell hooks, host paths and legacy aliases fail.

Generate: `node --import tsx engines/k6/compiler/generate.ts` (add `--check` for drift).
Check: `npx --no-install vitest run engines/k6/test/compiler --maxWorkers=2`;
`npm run typecheck`; `npx --no-install eslint engines/k6/compiler engines/k6/test/compiler`.
Use `NODE_OPTIONS=--max-old-space-size=1024`. No real k6/runtime conformance is claimed.
