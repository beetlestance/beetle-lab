# Active target recording

Owner: `engines/k6/wrapper/attempt/target.ts`, composing the target sampler and
`engines/k6/wrapper/target-archive`. This records samples and carries their optional prefix in approved live frames.
Native/public target backfill remains unwired; live readings still carry at most
eight recent target observations.

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
sealed-result or target-file-read authority.

## Anchors

| Code | Reviewed |
| --- | --- |
| `engines/k6/wrapper/attempt/attempt.ts` | `2ab9a3755951` |
| `engines/k6/wrapper/attempt/target.ts` | `36dc1ecb06b8` |
| `engines/k6/wrapper/attempt/reservation.ts` | `bb58468fcfdd` |
| `engines/k6/wrapper/target-sampling/` | `93144f55e151` |
| `engines/k6/wrapper/target-archive/` | `c031a2fc30f1` |
| `engines/k6/wrapper/artifact-custody/append-files.ts` | `0a83d0325b03` |
| `contracts/api/v2/live-history-prefix.schema.json` | `995b549a49d8` |
| `contracts/api/v2/live-metrics.schema.json` | `7595a5a70b98` |
| `contracts/src/api/live-metrics.ts` | `49964b8426b1` |
| `agent/src/live-metrics/` | `feac352cffc7` |
| `engines/k6/wrapper/live/` | `9ab8c75609b9` |
