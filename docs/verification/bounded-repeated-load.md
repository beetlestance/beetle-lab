# Bounded cardinality and repeated runs

Source images b48936d870f7e500d3b6c3f91a17eb5a267904ed, native Linux ARM64,
Node24.22.3; qualifier based on21f2926e with624 frozen input hashes. The final
trial passed192.684s, normal and independent cleanup both returned0, and all
frozen measurement inputs remained unchanged. Private evidence:
`.agent-work/bounded-load/{plan4.json,checks4,arm4,source-at-launch4.json}`.
This reuses unchanged engine/metric paths; it does not qualify the later workspace
migration against these older images. Batch the new runtime candidate separately.

Four sequential4VU×100-iteration requests use150ms waits and a10,000-value random
query dataset under one fixed configured request ID. The same three independent
browser sessions read across all runs. No history purge, service restart, pool
increase or automatic mutation retry occurs between runs. Output is explicitly
requested at8MiB per run under the unchanged stock pool and service/attempt limits.

Each run finished passed:400 physical requests,19 distinct metric series,
complete final totals,400 request counters and400 duration samples. Every trend
histogram passes the shared distribution validator. Dynamic URLs never become
metric tags. All eight artifacts per run pass extent/SHA checks (32 overall).
Final target counts:4readiness,1600work,0unexpected,1487distinct query values.
Distinct-query counts are cumulative; this is finite coverage, not arbitrary
series-overflow or unbounded-input acceptance.

| Completed run | Cumulative work | Distinct queries | Post-idle frontend MiB | Backend MiB | Agent MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 400 | 395 | 9.93 | 157.89 | 139.98 |
| 2 | 800 | 776 | 9.93 | 158.04 | 140.98 |
| 3 | 1200 | 1151 | 9.93 | 158.63 | 141.12 |
| 4 | 1600 | 1487 | 9.93 | 145.75 | 141.30 |

Each phase/service has at least two process-RSS observations. All observed summed
RSS stays under64/256/256MiB service ceilings. RSS sums count shared pages more
than once. The agent remains above its initial baseline; these four runs do not
prove a leak-free steady state. Broader quiescent growth/accounting remains open.
Loaded endpoint p95 maxima:6.88ms Run,194.32ms live metrics. Reader refusals remain
explicit (40of105live polls); this is not uninterrupted availability. It does not
resolve the separate long AMD live-p95 miss or telemetry on/off cost.

After all four runs, the stopped, hash-checked metadata shows each original
execution released with zero pending events and an original8,454,144-byte output
allocation (8MiB+64KiB). Those immutable rows record the original allocation amounts; they
do not independently prove current charged debt or refunds. Installation-wide
file/accounting reconciliation remains open.

## Preserved failures and corrections

ARM1 failed60.442s with fresh reader counts2/2/1 at50ms waits. Reviewed150ms
pacing leaves request counts,30s native maximum,480s outer cap and reader gate
unchanged; the retry does not prove the original pacing's availability.
ARM2 failed57.937s because the checker expected bare totals instead of the actual
version4 envelope. The adapter now checks version/exact scope/quantiles/windows
before nested metrics. A separate SHA-bound cold replay of the5919-byte original
passed; ARM2 remains failed overall. Three oracle tests cover valid counts,
missing/duplicate/partial samples, URL tags and wrong envelope/scope.
ARM3 failed75.298s after its first full case at the intentional session-creation
rate limit. Reusing three sessions fixes the harness; rate limits stay unchanged.
All failed trials retain successful normal/independent cleanup and private evidence.

Slow-reader/flood/cancellation stress, full disk custody and telemetry comparison
are separate packets. No user installation, registry image or release tag changed.
