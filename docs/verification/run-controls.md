# Run controls and agent admission carrier

Status: independently reviewed local components, integrated and verified.
Source: `cd1ec8b445868b2426823226a45bee4da455da66`.
The integration merges retain the exact source tree of `82fbeb2`; the worker
commits are preserved in history. No push or publication is implied.

## Implemented behavior

Workspace run history uses bounded opaque pages, namespace-scoped keys and UUID
route guards. Detail polls every two seconds while nonterminal, stops on terminal
states/errors and removes scoped queries on retirement. State, outcome and engine
validation are displayed separately; finalizing does not imply pass. No metrics,
artifacts or future controls are fabricated.

Only immutable saved revisions can launch runs. Opening the explicit form fetches
current effective settings; ordinary revision views issue no settings/run mutation.
Per-run budgets, profile, parallel/isolated mode and prefer-idle are explicit.
Submission captures one body/request ID before asynchronous work, blocks duplicate
issuance and retains the original for explicit replay after an unknown outcome.
Changed defaults do not reprice that original. A replay receipt never overwrites
current detail with its historical queued version. Scope/session retirement aborts
and fences late callbacks, including a response arriving after re-pairing.

Agent admission captures its closed four-field command independently of the
original Offer. The generic original caps remain 65,536 nodes, depth 64 and 4,096 items
per collection, with independent 1MiB config and 2MiB Offer byte caps. The fixed
command remains bounded by 2MiB+64KiB without building another joined string merely
for size measurement. Parent and worker reuse one capture owner and preserve exact
original bytes/enumeration order; the existing TWO shared original credits remain.
This is a trusted private producer boundary, not a hostile local-object sandbox.

## Evidence

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0:

- Runner/API/compiler generated-output checks, all three TypeScript targets and lint.
- Architecture: 1,105 source files; documentation: 177 files.
- Production frontend build; existing large-main-chunk notice remains 610.59kB.
- 366 test files / 3,884 tests passed; test phase 477.33 seconds.

Before the full gate, scoped run UI plus existing suite/scope checks passed 72 tests.
Additional lifetime/integration coverage passed 8 tests, including three new cases.
The cache tests inspect actual retired/current QueryCache contents. The issuance
harness invokes the hook twice in one event without a disabled-button guard.
Removing only its busy guard in an in-memory test transform produces two POSTs and
fails that unchanged test; normal production passes. No production source mutation.

Agent carrier tests retained identical frozen tests and originals across the old
code's 6 failures/12 passes and the correction's 18 passes. Independently counted,
schema-valid k6 originals at 65,536 nodes and depth 64 traverse the compiled journal
worker, replay, close/reopen and raw stored JSON checks. Boundary+1, byte/config,
collection, descriptor/shape and identity negatives remain rejected. Integrated
carrier/envelope/shared-credit checks passed 34 tests across four files.

Initial UI test passes exposed selectors, timers and invalid error fixtures;
corrections preserved the generated-client boundary. One root lifetime assertion
was corrected to await asynchronous fetch issuance. The old envelope padding test
was changed to reject unknown command fields while retaining positive original
acceptance. It is no longer evidence of isolated total-carrier byte overflow.
Independent source reviews found no blocking defects; targeted oracle gaps were
closed and reviewed again. Review opinions do not substitute for execution evidence.

## Limits

Browser visual/accessibility qualification remains pending: the required browser
execution tool was unavailable. DOM checks do not establish browser rendering.
Host evidence is macOS arm64 with Node 26.7; target Node 24/container and native
amd64/arm64 qualification remain separate. Compiled journal workers are real, but
these new checks do not execute k6 in Docker or measure physical stack overhead.

Backend-to-agent delivery, durable authority binding, events/ACK, cancellation
propagation, artifact transfer and terminal finalization remain required. See
[delivery authority](../design/lld/delivery-authority.md) and [PLAN](../../PLAN.md).
No complete end-to-end rewrite or release qualification is claimed.
