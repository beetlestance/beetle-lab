# Active history

`GET …/runs/{runId}/attempts/{attemptId}/metrics/live-history` returns actual source
windows and optional complete target samples from captured prefixes while running. It is an
advisory read, without publication, result, release or crash-durability authority.

## Authority and lifetime

- The backend resolves the scoped run and physical execution binding before and
  after the remote read. Terminal, cancelled, changed or foreign owners refuse it.
- The agent uses an existing running supervisor actor. Installed policy independently
  approves scope, producer epoch and subset; mailbox bytes cannot establish approval.
- A prefix becomes visible only after both data and index writes finish. File IDs
  stay fixed; count, extents and end advance together. Equal counts retain hashes.
- Native reads use retained no-follow descriptors, exact UID/mode and dev/inode
  checks. Files may append and the directory timestamps may change. Replacement,
  truncation below the captured extent and changed prefix bytes fail.
- All captured prefix hashes, headers, sequences, offsets, lengths and source
  times are verified before success. Actual closes and final named checks precede
  returning data. Sealed-output readers and their gates remain separate.
- Cancel/timeout hints retain issued originals. A failed native close keeps its
  admission credit and blocks retirement. Control cancellation does not wait on it.

## Bounds and sampling

| Boundary | Bound |
| --- | --- |
| Agent and backend ingress | One history original each; no queue or automatic retry |
| Lifetime | 30 s per read, without extending a run's execution budget |
| Native admission | Shared output range credits; overlapping cleanup excluded |
| Captured archive | Metric data + index ≤ 256 MiB / 65536 windows; target ≤ 1 MiB / 256 samples |
| IO and records | ≤ 64 KiB reads; data record ≤ 1 MiB, header ≤ 1 KiB, index row ≤ 256 B; target record ≤ 16 KiB |
| Partial reads | ≤ 4 × ceil(prefix bytes / 64 KiB) + 1024 calls per file |
| Reply | Existing 2 MiB API ceiling, 65536 JSON nodes, depth 64, 4096 entries per collection |
| Samples | ≤ 900 actual metric windows, first/final retained; every captured target sample retained |

The scan validates every source record. It selects candidate windows across the
prefix, then removes selected interior windows when byte/node budgets require it.
Values are never averaged; a sampled p95 is an actual window estimate. Gaps remain
visible in source times. `sampled: false` covers every retained prefix window,
not omitted upstream observations or the unfinished rest of the run.

The response binds scope, producer epoch, subset digest and prefix identity.
`contracts/src/api/live-history.ts` owns capture/encoding/decoding. The agent's
private `/runner/v1/attempts/{id}/live-history` route shares this DTO and normal
runner authentication. Latest-window reads retain their separate 5 s / 64 KiB limits.
With an approved [target prefix](target-recording.md#prefix-transport), the same native
owner opens the fixed target file and verifies scope, UUID, interval, contiguous
sequence/count, complete hash/extent and final name. The response's `targetSamples`
exists iff that prefix exists, with its exact sample count and the full shared
36-key target values, phases, nulls and optional GC pause windows. No cross-peer UTC comparison drops
recorded samples. Target metadata bytes/nodes are reserved before metric windows;
pressure thins only metric windows. No new route, read credit, queue or retry.
The shared sample schema is the existing runner `target-runtime-report` definition.

## Browser presentation

The active-run view reads history on its first verified feed and after reconnect,
not on each live poll. Pause, hidden documents, navigation and the 30 s deadline
abort its presentation lease. The browser keeps one issued original admitted until
fetch, body, hash and cleanup actually settle; an ignored abort cannot free it early.
Failure preserves existing readings and exposes an explicit retry.

The browser validates the bounded JSON, subset SHA-256, scope, epoch and current
archive identity before projecting at most 900 actual chart points. Archive window
ordinals and feed publication sequences remain separate. Charts deduplicate shared
windows, retain endpoints, label sampled coverage, and break across missing source
time. The same bootstrap merges all captured target samples and later live readings,
keeping at most 256 points and full fixed-key values, phases, reasons and nulls.
Recorded ordinals preserve duplicate UTC observations; overlapping live projections
cannot overwrite recorded values. The target UUID/interval/equal-count digest
baseline is detached, survives omitted hints and resets on scope/epoch/subset changes.
Unplottable timestamps reject presentation rather than yielding invalid geometry.
Only a verified producer prefix count of 256 marks the hard observation limit;
page-buffer capacity alone does not. Captions distinguish recorded and page-only
observations. Request/target charts share hover without interpolated values.
Undeclared target units stay as reported; unit-format acceptance remains separate.

The live download menu creates a provisional TXT report and CSV locally from the
same bounded browser projection, without another read. Both identify the run,
attempt, producer epoch, metric subset and sampled coverage. The report describes
the last retained window. CSV preserves actual window timestamps, source ordinals,
gaps, missing values and zeroes. Final artifacts remain a separate sealed path.

## Internal stopped checkpoint read

The native owner can also verify a stopped k6 checkpoint when a caller supplies
independent launch approval, the exact stopped output root identity and the
admitted byte limit. It opens only the two fixed 4 KiB slots, picks the newest
complete approved prefix and scans the referenced extent. The shared range lease
excludes cleanup until actual close. Stopped roots and files must keep their
full native signature through the final named checks. The prepared output root
must stay exclusive after stop. Partial bytes beyond
the selected extent are ignored. The active history and sealed-result gates
apply independently.

The agent commits the sampled observation alongside the original absence
receipt. The authenticated runner route `GET …/source/absence/history` uses the
same source credits as the absence route. It returns the exact committed proof
and either an observation with its canonical byte count and digest or
`observation: null`. An uncommitted proof returns `source_pending`. The agent and
backend gateway verify scope, journal authority, digest and wire bounds. The
payload budget is 2 MiB, plus the bounded proof and envelope. The route performs
no native archive read.

The backend waits for the exact released snapshot and full event acknowledgement
before fetching a stopped observation. It compares the companion proof to the
retained proof and commits available history in the same transaction as finalisation.
History consumes only payload bytes still available after events and provisional
result custody. The refund and eventual deletion credit include every retained
history byte. The installed agent and backend use matching release images.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/live-history/` | `92d2e3aefd8a` |
| `web/src/features/runs/live/backfill.ts` | `359fdea05c65` |
| `web/src/features/runs/live/provisional-download.ts` | `pending` |
| `web/src/features/runs/live/history.ts` | `4662308fcf90` |
| `app/src/application/live-attempt/` | `f142d17a3e6c` |
| `app/src/application/run-live-history/` | `ddb71f298e44` |
| `app/src/adapters/inbound/http/run-live-history/` | `5f005441d44a` |
| `app/src/adapters/outbound/runner/live-history.ts` | `3565a7c2df1a` |
| `agent/src/collection/live-history/` | `e8907b76b6c5` |
| `contracts/src/api/live-history.ts` | `019e342ddd15` |
| `web/src/features/runs/live/current.ts` | `3b7b190f7469` |
| `web/src/features/runs/live/target-history.ts` | `bffc0d996bc2` |
