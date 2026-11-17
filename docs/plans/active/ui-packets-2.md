# Plan: UI task packets, part 2

Status: active (2026-11-18). Packages D–F and the gated boards; cross-cutting facts and A–C are in [part 1](ui-packets.md).

## D. Live run (20 boards: base, 6 states, 8 animated, Compare tooltip, Script picker, Download open, Phone, Ultrawide)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Live run | Header: suite (engine), run id, revision, start time, stage headline, state; Pause stream; Cancel run; threshold sentence. Progress: stage bar, elapsed/left/ETA, %, rps, p95 vs limit, failed vs limit, VUs busy of max. p95 whole-run chart with markers. Thresholds holding. Endpoint table (share, rps, p50, p95, failed). Metrics grid (rps, latency p50/p95/p99, failed/s, VUs busy/allocated). Target runtime (heap/RSS, CPU, event-loop, handles). | `getRun` (poll), `getRunLiveMetrics` (≤20 series, `excludedSeries`), `listRunMetricSeries`/`getRunMetricSamples` for the whole-run chart, `getSuiteRevision` (stages, slos, request weights), `cancelRun` | `runs/live-metrics` (`RunLiveMetrics`, `useLiveMetrics`, `position.ts`), `runs/metrics` (Chart, range), `runs/load-advice`, `runs/RunCancellation.tsx`, `useCancellation.ts`, `runs/timeline` | Live target runtime: graph `LiveMetricSnapshot.target` (≤8 recent samples of RSS, heap, CPU, event-loop delay, handles; values may be null) and show a gap where `omittedSamples` > 0. Live subset ≤20 series → an endpoint table with 5×(rps, p50, p95, failed) may be partial → show the rows that are present and mark excluded series "not in live view". Start time for ETA: `requestedAt` is request time → derive from events or show elapsed from the first live sample. "Pause stream" is client-only (fine). |
| / Starting | Steps: accepted, compiled, starting grafana/k6 0.54, first metrics | `listRunEvents` (agent-event), `Run.state`, `Run.engine.profileId` | `runs/timeline` | none |
| / Waiting for capacity | "Both run slots are busy… catalog-crawl c3d1 and soak-30m 7e1a hold both", "Queued, first in line" | `Run.state=queued` | – | **Slot holders and queue position:** `getRunQueue` (lane: installation status); hide until it merges. |
| / Paused | Stream paused at 05:16; Resume | client | `live-metrics` visibility pause | none |
| / Reconnecting | "No word for 24 s", Retry now, stale figures | client read failures/freshness (`capturedAtMs`) | `live-metrics` watchdog | none |
| / Cancelling | Cancelling…, stopped sending at, 5 s grace copy | `cancellationRequested`, `cancelRun` | `RunCancellation` | "Stopped sending at 05:16" → last live sample time |
| / Finalizing | "Sealing 5 files", summary written / hashing / closing sampler | `state=finalizing`, `listRunEvents` | `runs/timeline` | The sub-step checklist is only as good as the events → show the event rows present. |
| / Animated 01–08 | Progress ticking (same data) | poll | – | none (motion spec only) |
| / Compare tooltip | "Compare with another run" | `compareRuns` needs terminal runs | – | Disable it while live, with the tooltip explaining why. |
| / Script picker | Revisions with dates, message, run count, author; "This run", "Latest" | `listSuiteRevisions` | `suites/History.tsx` | Date, message, run count and author: none → ordinal + digest only. Links to C's script route. |
| / Download open | Report so far .txt, Metrics so far .csv, Script .zip | – | – | **No live report or metrics download** (artifacts are published at seal) → hide until terminal. Script = C's export flow (not instant) → link to the script view. |
| Phone / Live run, Ultrawide / Live run | Re-layout | same | – | same |

Owns: a new `features/runs/live/` (wrapping `live-metrics`, `metrics`, `timeline`, `load-advice`).
Shared: `features/runs/RunDetail.tsx` dispatcher (**conflict with E**; see top);
`runs/runs.css`; no new routes (`routes.runPattern`). Tests: `runs/live-metrics/*`,
`runs/cancellation.test.tsx`, `runs/detail.test.tsx`.
Reuse level: **high** for data, medium for layout.

---

## E. Runs, results, compare (25 boards)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Runs | "24 runs"; state chips with counts; suite filter; search "by suite, run or note"; sort; table: suite+id+rev, result, Pinned, started, length, rps, p95, failed%; tick to compare (first = baseline), "Compare 2"; Newer/Older paging | `listRuns` (RunListQuery: state, outcome, order, name, runIdPrefix, suiteId, cursor) + `summaries` | `runs/RunHistory.tsx`, `HistoryFilters.tsx`, `HistorySummaryCells.tsx`, `comparison/selection.ts` | **Chip counts: no count operation** → chips without counts. Total "24 runs" → omit. **Note search: no note field** → search name and run ID only. **Pinned badge: gated** → hide. "rev 4" needs revisionId → ordinal lookup. |
| Runs / Empty, / Loading | copy | – | – | none |
| Run result | Header: suite (engine), run id, revision, time "by Meera", outcome; Run again; Pin; summary sentence. Section nav. Whole run: avg/peak rps, p50/p95/p99, failed of N, checks %, dropped iterations. Chart. Thresholds with values vs limits. Script version: revision, config digest, "saved 5 days ago by Meera: message", "Same revision as previous run b9e4", View script, Export script. Endpoints (64, filter, sorted). Metrics grid. Target runtime. Report tabs: Report (text), What happened, Artifacts (5), Diagnostics; Download report; Copy | `getRun`, `getRunResult` (engine-result: outcome, thresholds, requiredAssertions, completeness), `listRuns` summaries, `listRunMetricSeries`/`getRunMetricSamples`, `listRunArtifacts` + artifact content, `listRunEvents`, `createRun` (Run again), `createExport` | `runs/RunDetail.tsx`, `RunResultRead.tsx`, `run-results/RunResultPanel.tsx`, `runs/metrics`, `runs/performance-report`, `runs/target-observations`, `runs/timeline`, `runs/diagnostics`, `runs/warnings`, `runs/artifacts`, `retention` (delete) | **Pin: gated** → hide (or a disabled "Planned" control). "by Meera" and the revision saved/by/message: none → omit. Previous-run line → `listRuns{suiteId}`, the run after this one in order. Peak rps → max of the samples (bounded read) or omit. |
| / Failed, / Cancelled, / Out of memory, / Output full, / Incomplete results | Variant headlines ("over its 4 GB limit at 06:42", "reached 2 GB output at 07:10"), "Not judged", unavailable-charts note | `Run.state/outcome/reason` (memory_limit, output_limit, cancelled, artifact_incomplete), `budget`, result `completeness`, metric `availability` | `run-results/view.ts` | Stop time ("at 06:42"): no field → from events, or omit the time. |
| / Restored history | Banner "restored backup from 12 Nov, 02:00", read-only; Back to live | `BrowserSession.readOnly` | `features/session` | Backup date from `BrowserSession.restoredBackup.createdAt`; hide "Back to live" unless configured. |
| / Toast | "Run c3d1 is pinned" | – | – | **Gated (pinning)** → skip |
| / Diagnostics | "No warnings. k6 exited cleanly." Open sanitized log | diagnostic artifact | `runs/diagnostics`, `runs/warnings` | none |
| / Artifacts, / Artifact viewer, Overlay / Artifact viewer | File, what it holds, size, Verify and open; viewer with "Size and SHA-256 match the sealed manifest", JSON, Download | `listRunArtifacts` (kind, relativePath, bytes, sha256, sealedAt) + content route | `runs/artifacts`, shared VerifiedArtifactReads (`diagnostics`, `performance-report`) | "What it holds" → a static map by `kind`; unknown kinds show the kind. |
| / What happened | Timeline 00:00 accepted … sealed; "p95 rose for about 30 s, mostly GET /content…" | `listRunEvents` | `runs/timeline` | "p95 rose" comes from `getRunLatencyAttribution`; map `rN` to the revision's request names; any `reason` → omit the line. |
| / Compare picker | Same-suite runs (rev, outcome, time, length, p95), "Every suite" | `listRuns{suiteId}` + summaries | `comparison/selection.ts` | none |
| / Download open | Report .txt, Summary .json, Metrics .csv, Script .zip | artifact content (report/summary/metrics kinds); export | `performance-report`, `artifacts` | Script .zip → C's export flow (not instant); the format is whatever the export publishes (`suite.js`, not a zip) → label honestly. |
| / Target by phase | Before / during / after table, deltas, timed-out sample count | target-runtime artifact | `runs/target-observations` (`summary.ts` has phases) | none |
| Overlay / Delete run | "Delete run 7e1a?", frees 1.4 GB, checked at / valid until; Keep / Delete | `previewRunDeletion` → `RetentionPreview` (estimatedBytes, capturedAt, expiresAt, snapshotId) → `applyWorkspaceRetention` | `features/retention` (`RetentionControls({scope, run})`) | Suite name and finish time in the copy: `Run` has no finish time → use requestedAt. |
| Overlay / Delete run / Pinned | Pinned, Unpin | – | – | **Gated** |
| Compare (+ Empty) | Baseline and others with %/pp deltas for peak rps, p50/p95/p99, failed, checks, dropped, length; per-threshold pass; overlaid charts (rps, p95, failed/s, VUs); target runtime overlay; "What was different" (revision, executor, rate, VUs, note); Make baseline | `compareRuns` (items: result, environment, differences.configChanges, metric read) | `runs/comparison/*` (`Facts.tsx`, `useComparison`), `target-observations/comparison.tsx` | **CONTEXT says "no synthesized … deltas"**: the deltas in the design would be new client math on API values (allowed only if labelled). Note row: no field → omit. One metric per `compareRuns` call → the multi-chart grid = several calls (bounded ≤4 runs). |

Owns: `features/runs/{RunHistory,HistoryFilters,HistorySummaryCells}*`, a new
`features/runs/result/`, `features/run-results/*`, `runs/comparison/*`,
`runs/artifacts/*`, `runs/performance-report/*`, `runs/target-observations/*`,
`runs/diagnostics/*`, `runs/warnings/*`.
Shared: `RunDetail.tsx` (**conflict with D**), `features/retention/*` (shared with F:
E uses the run-deletion path, F the workspace path → one owner, F; E only composes it);
`routes.ts` (a run sub-route for Target by phase, e.g. `.../runs/:runId/target`);
`App.tsx` Route. Tests: `runs/*.test.tsx`, `run-results/results.test.tsx`.
Reuse level: **high** (almost every section has a feature module).

---

## F. Inputs, engines, settings (16 boards)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Inputs | "5 files, 9.0 MB"; Upload files; Add a sample file; folder segmented control; table: file, folder/type/rows/columns/kind, status (Ready, Stopped at 61%), used by suites, size, added date; Download, Delete, Resume | `listInputs` (name, folderId, bytes, offset, state, reason), `createInput`/`sealInput`/`deleteInput`, input content route, `listFolders` | `features/inputs` (`InputInventory`, `InputStatus`, `useDeletion`), `input-upload` (resume/recovery), `input-download`, `input-directory`, `input-screen` | **Used by: no reverse index** → hide the column. **CSV rows/columns, "Request body" kind: none** → show the extension only. **Added date: none** → hide. **"Add a sample file": no feature** → hide. Totals only when the page is complete. |
| Inputs / Empty | copy, upload, limits | – | same | Sample file → hide |
| Overlay / Delete input / In use | "Used by steady-1.2k Revisions 4 and 5" | `deleteInput` → ApiError `protected_dependency` | `inputs/useDeletion.ts` | **The list of revisions using it is missing** → generic "used by saved revisions" without names. |
| Engines | k6 installed (runs, pass/fail, result shows); 5 planned with sample bars | installation `supportedProfiles`; `getExportProfiles` | – | Planned cards are static copy (OK, labelled). Installed list from profiles. |
| Settings (org), / Installation, / Workspace, / Loading | Scope tabs; per setting: value, "Inherited from X"/"Set here"/"Inherit instead"/"Will inherit, not saved"; save bar "1 unsaved change", Discard, Save | `get/patch{Installation,Organization,Workspace}Settings`; `NumericEffectiveLeaf.source/allowedRange` | `features/settings` (`fields.ts`, `intents.ts`), `components/Editor` | none |
| Settings / Installation / Capacity | Runs at once, pool memory/CPU/procs/output, storage kept; "Host reports 10 CPUs, 32 GB memory and 412 GB free disk" | `InstallationValues.pool` (PoolCapacity) + patch | `settings` | **Host-reported capacity:** `getInstallationStatus` `host`/`disk` (lane: installation status); omit unmeasured fields. |
| Settings / Workspace / Retention preview | 38 runs would be removed, frees, kept by protection; table run/suite/finished/size/why; …and N more; never removed (pinned, running, cleaning); Discard / Remove 38 | `previewWorkspaceRetention` (candidates{id, estimatedBytes, reason}, protectedExclusions{reason, count, bytes}, expiresAt, nextCursor); `applyWorkspaceRetention`; `discardWorkspaceRetention` | `features/retention` (`Preview.tsx` `SnapshotSummary`, `useCommand`) | Suite name and finished date per candidate: not in candidate → `getRun` per row (bounded to the page) gives suiteId and requestedAt only; finished → omit. Pinned exclusions are gated (count may be 0). |
| Settings / Workspace / Retention progress | x of 38 removed, GB freed; stage table; blocked run with "Open diagnostics"; earlier batches (started, kind, count, freed, result) | `getWorkspaceRetentionStatus` (items phase/error, completedCount, refundedLogicalBytes), `listWorkspaceRetention` (summaries) | `retention/Batch.tsx`, `Parent.tsx` | Freed bytes per earlier batch: `RetentionBatchSummary` has none → omit the column or fetch status per batch. |
| Overlay / Delete workspace | Type-to-confirm; "What stays: 14 suites, 312 runs, 3 pinned, 9 inputs, 48.6 GB" | `deleteWorkspace`; `getWorkspaceOverview` counts (suites, runs) | `features/namespace-deletion` | Pinned (gated), input count (page), bytes (none) → show suites and runs only. |
| / Delete workspace / Blocked | In-progress list: run, export, upload | ApiError `protected_dependency` (no list) | – | Derive from overview `active`, `listExports` nonterminal, `listInputs` staging (bounded); label it as "found in progress". |
| Overlay / Delete organization / Blocked | Workspaces remaining with counts; "platform, deleted on 3 Nov" | `listWorkspaces` | `namespace-deletion` | Deleted workspaces and deletion dates are not listed → show only live workspaces. Per-workspace counts need N overview reads. |
| Overlay / Delete folder / Not empty | Inside: folders 2, suites 6, inputs 1 | `deleteFolder` → `protected_dependency` | `namespace-deletion` | **Folder contents counts are gated (folder summaries)** → count client-side from complete pages, or omit the counts. |

Owns: `features/inputs/*`, `input-*/*`, `features/settings/*`, `features/retention/*`,
`features/namespace-deletion/*`, a new `features/engines/`.
Shared: `routes.ts`: `/engines`, installation capacity sub-route
(`/settings/capacity`), workspace retention routes (`.../settings/retention`,
`.../retention/:snapshotId`); `App.tsx` Routes; tests `app/settings.test.tsx`,
`settings-mutations.test.tsx`, `inputs.test.tsx`, `input-controls.test.tsx`.
Reuse level: **high** for settings and retention; medium for inputs.

---

## Boards that need a backend change before they can be built honestly

- Suites folder list and Suites / Folder: status mix, last run, search, sort
  (`proposed/suite-folders.md`).
- Pin control, Run result / Toast, Overlay / Delete run / Pinned, Runs "Pinned"
  badge (`proposed/run-pinning.md`).
- Overview Agent panel and Empty "agent ready" line, and Installation / Capacity
  "Host reports …": `getInstallationStatus` (installation status lane). CPU use and
  available memory stay not measured.
- Live run / Waiting for capacity: slot holders and queue position come from
  `getRunQueue` (installation status lane).
- Suite description, revision message/author/date/run count (Suite header,
  Revisions, Script picker): need revision metadata fields.
- Inputs "Used by", Delete input / In use names: need an input→revision reverse
  lookup. Inputs rows/columns/added date: need input metadata.
- Live "Report/Metrics so far" downloads: dropped from the design.
- Run notes (Runs search, Compare "Note"): need a note field.
- Delete organization "deleted on" list: needs tombstoned workspaces listed.
- Merged: installation status and run queue (035, no migration) and live
  extras (target graph data, `restoredBackup`, latency attribution). Pending
  merge: 031 authoring, 032 input metadata, 033 pinning, 034 suite folders.
- Boards added on Nov 18 are listed in [ui-packets-3](ui-packets-3.md).
