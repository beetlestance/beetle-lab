# k6 outcome evidence

Status: selected for wrapper implementation; mapper and finalization pending.
The generic result schema describes structure. This decision defines k6 evidence
semantics without changing that wire format.

## Required assertion unit

`requiredAssertions` counts configured required assertion definitions on workload
requests; exclude optional definitions and readiness. Repeated evaluations never
inflate that count. Require `required = passed + failed + unknown`.

A definition fails when its observed failure count is positive. It passes only
when its owning request has positive attempt count, evaluation count equals that
attempt count, and failure count is zero. Missing/unexercised/skipped evaluations
are unknown. This matters because transport failure increments request attempts
but skips assertion evaluation. More evaluations than attempts, failures greater
than evaluations, or incompatible global required-failure totals are contradictory
evidence. Never convert them to a passing or ordinary assertion-failure result.

Use compiler labels and the shared evidence layout. Sum required failure
evaluations separately from definition counts and reconcile that sum against
`beetle_required_failures` only when all relevant terms are known; missing terms
are unknown, not zero. Numeric health counts and native `count==0` verdicts must
agree. Complete pass requires known required health and consistent zero execution
health. Positive execution failures take execution-error precedence over test failures.

## Completion and discovery

Unknown child ownership, incomplete stop confirmation or outstanding issued work
is not sealable. Confirmed never-started work may produce an error result, never a
pass. Cancellation, timeout, script/adapter errors and contradictory evidence are
inconclusive; absence of summary/measurement evidence cannot imply success.

For confirmed normal completion, known required assertion or ordinary SLO failure
is failed. Ordinary pass requires exit zero and complete passing decision evidence.
Native exit 99 requires a known failing threshold/guard explanation; other
unexplained exits are execution errors. No outcome follows from an exit alone.

Preserve ordinary SLO verdicts and native inverse discovery verdicts. A discovery
threshold with `ok=false` is an observed stop-comparison witness. Choose the first
known reached discovery rule in compiled order for `expectedAbort`; otherwise use
the first configured rule with reached=false, meaning no observed witness, not
proof of non-occurrence. Missing verdicts remain incomplete; retain every known verdict.
Discovery pass requires exit 99, a witness, and complete healthy ordinary/required
evidence. Exhaustion without a witness is inconclusive. A witness does not prove
which rule caused termination or that termination happened early.

## Evidence scopes

`execution.exitCode` is the native k6 child's exit. Agent `runtime.exited` observes
the wrapper container; finalization must not require those codes to be equal.
`execution.stoppedAt` is the trusted coordinator time at which terminal state is
confirmed, including confirmed never-started work. It is not a source metric time
or a timestamp reconstructed from summary duration.

Result completeness covers decision evidence and declared sealed artifacts.
Required unknown assertions, unknown configured verdicts, missing/invalid marker,
partial native collection or contradictory health evidence prevent complete pass.
Missing unrelated optional statistics alone do not change a known outcome.
Exact final totals can coexist with partial chart windows: preserve the explicit
window coverage in numeric evidence/reports; never label those windows complete.
Native counter-rate denominator remains whole engine duration; do not reevaluate
discovery using measured windows or averaged quantiles.

The mapper is pure and receives verified private evidence plus trusted scope/time.
It neither verifies files, authenticates producers, seals/persists results nor
releases reservations. Application finalization independently checks scope,
generation, artifact custody, seal content and agent execution evidence.
