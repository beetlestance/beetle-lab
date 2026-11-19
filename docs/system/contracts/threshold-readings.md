# Native threshold readings

Optional `threshold.reading` is `{source: native-summary, metric, stat, value}`.
The wrapper copies the already supported native statistic used to admit the native
threshold boolean. It never evaluates the rule again or uses histogram estimates.
Zero is a reading; missing sample/statistic support is unknown. Existing result
verdicts and discovery inverse-comparison semantics remain authoritative.

The common closed threshold schema owns the optional field. Closed successful SLO
and discovery branches reference the same field; older results may omit it.
If the unsealed result exceeds 64,000 encoded bytes, the wrapper removes all optional
readings. Mandatory verdicts and existing result/frame byte limits are preserved.
This is display evidence, not new authority to declare a run successful.

The browser verifies the saved revision against run scope, suite, revision ID and
digest before using labels/limits. A limit also needs the same rule ID, metric and
statistic as the native reading. A mismatch has no meter; legacy missing values
stay explicit. The meter is decorative, finite and clamped, never a new verdict.
Discovery inverse false is labelled trigger reached rather than failed SLO.

Headlines count only SLO verdicts; an inverted discovery trigger never becomes a
failed SLO or a claim that SLOs passed when none exist. A single failed SLO can show
its native reading and pinned limit only when one saved rule matches ID, metric
and statistic. Missing or ambiguous matches retain the threshold ID. Display text
describes the native verdict; it does not reevaluate the rule from the reading.

Comparison uses the same native-verdict sentence and limit formatter. Optional
compact comparison detail obeys the [comparison contract](result-presentation.md#native-slo-comparison).

`checks` supports the native `rate` statistic. Each assertion evaluation emits one
native check from its existing boolean, including optional assertions. Native
`phase:execute` submetrics exclude readiness. The shared catalogue uses bounded
assertion aliases; native system tags and raw assertion names remain excluded.
A checks SLO neither replaces required-assertion health nor admits a zero-sample
verdict. Native k6 can report a vacuous true with no workload checks; the mapper
requires known passes/fails with a positive denominator before accepting it.
The result reading remains a native statistic; the UI never computes its verdict.

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/runner/v1/result-evidence.schema.json` | `379ecd645141` |
| `contracts/runner/v1/engine-result.schema.json` | `e377fc467e47` |
| `engines/k6/wrapper/result/` | `bc94b5adb495` |
| `web/src/features/runs/run-revision.ts` | `d57756f98b8a` |
| `web/src/features/runs/result/ThresholdReading.tsx` | `cd060ae04f02` |
| `web/src/features/runs/result/threshold-sentence.ts` | `a5ccdb7f0a16` |
| `contracts/src/k6-metrics/index.ts` | `ae909fa57f1f` |
| `engines/k6/runtime/native.ts` | `f2277e65a4b4` |
| `engines/k6/runtime/native-api.d.ts` | `1d0f5d2b55d1` |
