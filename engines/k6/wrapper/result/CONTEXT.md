# k6 outcome mapper

Public `mapK6Result` consumes accepted compiler IR, verified summary v2/numeric
snapshot, native process observation, trusted terminal confirmation time/scope and
mandatory orchestrationFailure/orchestrationQuiescent and artifact metadata. It
returns an immutable unsealed result body plus explicit chart
coverage, or fixed `not_quiescent`/`invalid_input`. No I/O, clocks or retries occur.
Wire shape is unchanged; ADR011 owns assertion units and decision semantics.

Required assertions count workload definitions, excluding readiness/optional ones.
Repeated evaluations do not increase that count. Request/evaluation/failure counts
detect skipped checks and contradictions. Global required-failure evaluations and
numeric/threshold health guards must agree when known. Missing is never zero.
Known positive global required health can fail the test without inventing missing
definition attribution; fully known contradictory totals remain execution errors.
Known failure subtotals remain lower bounds even when the exact sum is unknown;
missing evaluation counts cannot erase failures exceeding request attempts.
Native threshold booleans require the referenced statistic and sample support:
Trend count>0, Rate passes+fails>0, known Counter count (zero valid), Gauge value.
Compiled threshold prefixes provide native stat keys; no numeric rule reevaluation.
Discovery uses the first ordered supported inverse-rule failure, without claiming
causal or early termination. Unsupported native booleans are unknown, not witnesses.

Unknown stop/group/issued work is not sealable. Cancellation/errors remain
inconclusive; native child exit is distinct from wrapper/container exit. Complete
pass requires decision evidence, not every optional statistic. Partial chart
coverage survives separately even when exact final totals support an outcome.
Whole-orchestration quiescence is required independently from child quiescence.
Closed orchestration failure codes override native causes, retain observed facts,
and force partial/missing inconclusive evidence; missing/malformed fields reject.

Evidence is copied through the shared bounded JSON encoder (4MiB/depth64/nodes65536/
collection4096); accepted expanded compiler IR is reused, not copied. Result output
is bounded to1MiB and schema checked with an internal placeholder seal which is
stripped before return. The generic seal codec later owns content hashing.
Trusted artifact metadata does not establish file existence/integrity/custody.
This mapper neither authenticates producers, persists/seals output nor releases
agent reservations. Callers must publish coverage in numeric artifacts/reports.

Checks: scoped Vitest `engines/k6/test/result`, Node TypeScript and changed ESLint.
