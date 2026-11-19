# Active target recording

Owner: `engines/k6/wrapper/attempt/target.ts`, composing the target sampler and
`engines/k6/wrapper/target-archive`. This records samples and carries their optional prefix in approved live frames.
Native/public active history returns captured target samples and the browser
merges them on entry/reconnect. Each live frame still carries at most eight.

## Limits and authority

| Rule | Value |
| --- | --- |
| Enabled | target sampling configured and trusted live-mailbox opt-in enabled |
| Reservation | 1 MiB carved from the accepted output budget before history/build; execute also reserves that MiB |
| File | fixed `target-samples.ndjson`, exclusive no-follow create, owned 0600 regular single-link file and pinned 0700 root |
| Header | version 1, scope, artifact UUID, approved interval |
| Records | one JSON sample per line, contiguous sequence 1..256; at most 16 KiB per line and 1 MiB overall |
| Native work | one append original; writes at most 64 KiB with bounded partial-write calls; no queue or per-sample sync |
| Completed prefix | immutable scope, interval, count, file UUID, byte extent and SHA-256 through the last complete newline |

Prefixes describe completed advisory bytes, not crash durability, adopted output
or sealed evidence. Partial and failed bytes remain charged. An in-flight append
retains its previous prefix; failure, fencing or close withdraws it. Fixed-file
custody is shared with the metric archive through `AppendFiles`.

## Composition and phase accounting

Sampling takes the original baseline before native execution. Before the measured
transition, samples stay in the sampler's existing bounded memory. After execute
starts, recording writes a header and that retained snapshot. Any not-yet-retained
observation waits for this same initialization original, then appends serially;
there is no duplicate sample, second corpus or queue. With no measured marker,
no archive is created. All archive bytes are charged to execute, including the
baseline snapshot and cooldown observations.

Cooldown and recording drain before collect. The sealed `target-runtime.json`
keeps its existing format, reservation, publication gate and retained samples.
The active archive is never named in the sealed artifact manifest. Recording
failure blocks execution/publication and preserves its original fixed cause
across execution callbacks; a failed close blocks sealing. Shutdown first drains
the sampler and archive initialization, then closes the archive's retained file.

`targetSampling.units` optionally declares compatible units for each fixed metric.
Config and sealed report reference one shared schema. Sampling freezes a detached
declaration before baseline; its bytes remain inside the same 1 MiB report cap.
Active samples stay raw; the verified pinned revision supplies their unit context.
Only declared units convert for presentation. Older reports stay explicitly raw;
missing units never imply bytes, percent or milliseconds. Incompatible dimensions
are rejected; non-finite converted values stay unknown. No outcome changes.
Live chart groups normalize fully declared readings to MB, %, ms and counts.
A known series without units keeps its whole group raw with explicit source labels;
missing series do not block conversion. Positive underflow stays unknown, never zero.
Hover outside observed coverage or across a marked gap stays unknown.

## Prefix transport

`LiveMetricArchivePrefix.target` optionally carries the target archive's scope,
UUID, interval, count, fixed path, completed extent and hash. The schema fixes
256 samples and 1 MiB; its scope matches the enclosing frame and all three file
UUIDs differ. The target interval must match the approved source even if current
target readings are unavailable. The publisher drops an invalid/unaffordable target
hint before dropping the metric prefix; frame size, cadence and budgets stay exact.
The agent independently checks the approved interval. Its private frozen baseline
refuses UUID/interval/count/extent/hash regression and survives omitted hints;
equal counts keep exact bytes/hash, increasing counts require growing bytes.
Returned frame mutation cannot change this baseline. Metadata hints grant no
sealed-result authority. Target-file reads additionally require the existing
approved actor, native custody and [active-history verification](active-history.md).

## Managed request landmarks

A complete native k6 execution can seal optional request landmarks in the
target report. The wrapper takes the earliest execute dispatch counter and
latest HTTP duration point, whose native timestamp records completion. Only
approved request labels participate, and per-label dispatch and completion counts
must agree with ordered extrema. The bounded tracker consumes the existing
metric stream. It emits no extra metric records and keeps no request log.
The report exposes UTC landmarks separately from sampler phases, whose labels
remain as recorded. Old, incomplete and unmatched sources omit the field.
The numeric archive keeps its existing format. No execution outcome changes.

## Anchors

| Code | Reviewed |
| --- | --- |
| `engines/k6/wrapper/attempt/attempt.ts` | `7ca31d6d9130` |
| `engines/k6/wrapper/attempt/target.ts` | `36dc1ecb06b8` |
| `engines/k6/wrapper/attempt/reservation.ts` | `bb58468fcfdd` |
| `engines/k6/wrapper/target-sampling/` | `c601c5e4dfb5` |
| `engines/k6/wrapper/target-archive/` | `7bc3a5dba7c2` |
| `contracts/runner/v1/target-runtime-units.schema.json` | `05a6a5565ff1` |
| `contracts/src/target-runtime/` | `67aa82aa131b` |
| `engines/k6/wrapper/artifact-custody/append-files.ts` | `0a83d0325b03` |
| `contracts/api/v2/live-history-prefix.schema.json` | `995b549a49d8` |
| `contracts/api/v2/live-metrics.schema.json` | `7595a5a70b98` |
| `contracts/src/api/live-metrics.ts` | `49964b8426b1` |
| `agent/src/live-metrics/` | `feac352cffc7` |
| `engines/k6/wrapper/live/` | `9ab8c75609b9` |
| `web/src/features/runs/live/target-charts.ts` | `788710258b75` |
| `web/src/features/runs/live/Charts.tsx` | `37c406ecb622` |
