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

The current compiler does not admit a `checks` rate threshold. A design example
with a 99% checks SLO needs separate engine support; no threshold is fabricated.

## Anchors

| Code | Reviewed |
| --- | --- |
| `contracts/runner/v1/result-evidence.schema.json` | `dacc0045db72` |
| `contracts/runner/v1/engine-result.schema.json` | `e377fc467e47` |
| `engines/k6/wrapper/result/` | `97fe9b2a9759` |
| `web/src/features/runs/run-revision.ts` | `d57756f98b8a` |
| `web/src/features/runs/result/ThresholdReading.tsx` | `08971f65c4f9` |
| `web/src/features/runs/result/threshold-sentence.ts` | `0d4c20ba0491` |
