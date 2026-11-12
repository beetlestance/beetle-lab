# Observed load guidance

Status: reviewed local F10 consumer implementation, not full F10 acceptance.
Base d4277ea; source is the integration commit containing this report.
Contract: [observed load guidance](../design/lld/load-advice.md).

## Behavior

A k6 run displays valid global dropped-iteration counts from its current verified
live window or recorded metric page. Missing, ambiguous, malformed and differently
scoped signals remain unknown. Partial/unknown coverage does not become proof of
zero drops. A catalogue page can omit a metric present elsewhere in the source.
Arrival-rate VU exhaustion and iteration-count maxDuration are both explained;
the count alone does not diagnose the cause.

An optional recorded-source calculator uses the actual iteration-duration median,
its histogram bounds and sample count, plus explicit desired iterations/second and
editable headroom. Complete source coverage and positive valid observations are
required. Its candidate allocation is labelled a heuristic, never measured safe
capacity. It neither substitutes HTTP request latency nor changes configuration.
Input size/ranges and output arithmetic are bounded; overflow gives no estimate.

## Local checks

- Initial model/UI selection: 26 tests passed in 1.26 seconds.
- Final load-advice plus live/recorded-metric regression: 86 tests in 13 files
  passed in 20.44 seconds (`npx vitest run web/src/features/runs/load-advice
  web/src/features/runs/live-metrics web/src/features/runs/metrics`).
- Frontend types: `npx tsc -p web/tsconfig.json --noEmit`, exit 0.
- Changed-file ESLint, architecture and documentation gates: exit 0.
- `npm run build:web`: exit 0; existing large-chunk warning retained.

The integration fixtures use existing generated-client catalogue/sample reads;
editing planner inputs adds no request or mutation. Refresh removes an old drop
signal when the current page no longer contains it. An expired held live window
removes its advice while keeping the existing one-in-flight polling owner.
Existing scope/attempt/session lifecycle regressions remain green.

Initial lint rejected three complexity violations; validation and display
responsibilities were factored without lowering gates. Initial typecheck caught
two invalid negative-test fixtures; they were corrected to valid alternative tags
and units. The independent source review found no blocking defects.

## Limits

No engine, native warning-log parser, backend, schema, query or budget policy
changed. F10 remains partial: raw-warning classification and automatic guidance
from configured scenario rates/executors require separate work. No Docker rebuild,
user-service restart, deployment or publication occurred. Native browser and release
qualification remain open; DOM tests do not substitute for them.
