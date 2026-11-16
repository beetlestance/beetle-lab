# k6 warning evidence and configured guidance

Status: locally implemented; [source and native evidence](../../verification/k6-warning-guidance.md) record acceptance limits.
Engine owns classification; shared contracts own the sealed artifact, and the
browser consumes it through existing scoped content verification. No backend job,
extra polling, public API route, metadata projection or new storage grant.

## Native source and privacy

Pinned k6 writes JSON diagnostics to stderr. Existing total diagnostic-byte limits,
process outcomes and original close/drain ownership remain enforced. An incremental
classifier retains at most4096 bytes per line and processes chunks up to65536 bytes.
Oversized chunks/lines are discarded without classifying a truncated prefix. Unknown,
malformed, interrupted and discarded evidence makes coverage partial. Classified
counters count observed log records, not unique incidents or dropped iterations.
Known non-warning JSON levels do not create warning counts. No raw message, URL,
request data or native error string is persisted or returned by this feature.
Classification cannot throw into the native drain path.

Categories: insufficient VUs, high cardinality, iteration max duration and other
warnings. Actual dropped-iteration totals retain their existing numeric owner.
Zero counters establish no absence when coverage is partial. Warnings are advisory;
execution/assertion/threshold verdicts remain with the existing result mapper.

## Publication and budget

After actual stdio settlement, publish one version1 scoped k6-warnings artifact.
If native observation never existed, omit it rather than inventing zero warnings.
Its4096-byte ceiling is carved from the existing1MiB numeric reservation before
execution; build/history/total ceilings do not increase. Collection retains that
slice and counts actual published bytes. Existing result/output metadata allowances
and descriptor ceilings remain; qualify the actual fixed k6 artifact count and
minimum-budget refusal. Missing capacity must refuse before side effects.

Artifact carries only scope, counters/coverage, configured scenario count and a
nullable single-arrival hint plus nullable complete global iteration-median estimate.
Use the existing canonical duration policy over compiled scenario options, without
changing emitted load or adding another compiler. Multiple/other scenarios produce
no automatic arrival hint. Median must identify the execute-global iteration series;
request latency, incomplete distributions and duplicate/ambiguous series cannot
substitute. Payload and semantic validation are shared and capped at4096 bytes.

## Browser behavior

Existing manifest selection, scope/hash/length/deadline verification and original
reader credits apply. Bind payload to expected organisation/workspace/attempt and
generation. Ambiguous artifacts, failed reads and old absence remain explicit.
Reuse the current VU planning math with configured peak iterations/second only when
one arrival scenario and eligible iteration evidence exist. Ramping/discovery uses
its configured peak as a conservative assumption; completed-iteration medians omit
unscheduled/interrupted work and do not establish safe machine capacity. Show
bounds/headroom and compare configured VU caps, with no automatic config mutation.

Live dropped-load guidance remains available separately. This artifact is final
warning evidence, not a live raw-log stream. Raw diagnostic retention and the full
UI redesign remain separate scope.

## Acceptance

Codec rejects scope/count/coverage/hint/median contradictions and oversized/canary
input. Streaming tests cover chunk splits, UTF8, malformed/overlong/flood/unknown
records, ignored abort and close. Prove fixed funding and descriptor bounds, actual
publication/hash accounting, artifact-reader late replies and ambiguous/source
scope rejection. Run one owned native qualification for pinned JSON format, positive
warning classification and sealed artifact. Record source/images/platform/limits.
