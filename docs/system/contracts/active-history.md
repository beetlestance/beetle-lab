# Active metric history

`GET …/runs/{runId}/attempts/{attemptId}/metrics/live-history` returns actual source
windows from a completed archive prefix while that attempt is running. It is an
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
- Both captured prefix hashes, headers, sequences, offsets, lengths and source
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
| Captured archive | Data + index ≤ 256 MiB, ≤ 65536 windows |
| IO and records | ≤ 64 KiB reads; data record ≤ 1 MiB, header ≤ 1 KiB, index row ≤ 256 B |
| Partial reads | ≤ 4 × ceil(prefix bytes / 64 KiB) + 1024 calls per file |
| Reply | Existing 2 MiB API ceiling, 65536 JSON nodes, depth 64, 4096 entries per collection |
| Samples | ≤ 900 actual windows; first and final retained; explicit `sampled` flag |

The scan validates every source record. It selects candidate windows across the
prefix, then removes selected interior windows when byte/node budgets require it.
Values are never averaged; a sampled p95 is an actual window estimate. Gaps remain
visible in source times. `sampled: false` covers every retained prefix window,
not omitted upstream observations or the unfinished rest of the run.

The response binds scope, producer epoch, subset digest and prefix identity.
`contracts/src/api/live-history.ts` owns capture/encoding/decoding. The agent's
private `/runner/v1/attempts/{id}/live-history` route shares this DTO and normal
runner authentication. Latest-window reads retain their separate 5 s / 64 KiB limits.
An optional nested target prefix is [approved metadata](target-recording.md#prefix-transport)
only; this reader still verifies the metric pair and does not read target samples.

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
time. Recorded metric history does not backfill target-runtime samples: those
remain the bounded samples received while this page is open.

## Anchors

| Code | Reviewed |
| --- | --- |
| `web/src/features/runs/live-history/` | `92d2e3aefd8a` |
| `web/src/features/runs/live/backfill.ts` | `a6a0edea4d2f` |
| `web/src/features/runs/live/history.ts` | `cfa37714c424` |
| `app/src/application/live-attempt/` | `f142d17a3e6c` |
| `app/src/application/run-live-history/` | `ddb71f298e44` |
| `app/src/adapters/inbound/http/run-live-history/` | `5f005441d44a` |
| `app/src/adapters/outbound/runner/live-history.ts` | `3565a7c2df1a` |
| `agent/src/collection/live-history/` | `739ee70c2202` |
| `contracts/src/api/live-history.ts` | `ff4f2ae50747` |
