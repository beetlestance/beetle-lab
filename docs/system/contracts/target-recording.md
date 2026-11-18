# Active target recording

Owner: `engines/k6/wrapper/attempt/target.ts`, composing the target sampler and
`engines/k6/wrapper/target-archive`. This is producer-side recording; active public
backfill and live-frame prefix transport are not wired yet. The existing live
frame still carries at most eight recent target observations.

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

## Anchors

| Code | Reviewed |
| --- | --- |
| `engines/k6/wrapper/attempt/attempt.ts` | `2ab9a3755951` |
| `engines/k6/wrapper/attempt/target.ts` | `96c208802739` |
| `engines/k6/wrapper/attempt/reservation.ts` | `bb58468fcfdd` |
| `engines/k6/wrapper/target-sampling/` | `93144f55e151` |
| `engines/k6/wrapper/target-archive/` | `072f111060d9` |
| `engines/k6/wrapper/artifact-custody/append-files.ts` | `0a83d0325b03` |
