# Suite listing

How the Suites tab lists folders and suites by their latest run without reading
every run. Shapes are `SuiteListQuery`, `SuitePage`, `SuiteListSummary`,
`SuiteLatestRun`, `SuiteGroup` and `FolderSummary` in
`contracts/api/v2/suite-listing.schema.json`, `suite-requests.schema.json` and
`namespace.schema.json`; general suite and history rules are in [Public API](public-api.md).

## Latest run and display group

- A suite's latest run is its latest **retained** run by `requestedAt`, then run
  UUID, both descending. Deleting it reveals the previous retained run; none left
  means no runs.
- The header carries `suiteId`, current `suiteName`, `runId`, `state`, `outcome`,
  `requestedAt`, `startedAt` and `testDurationMs`; state/outcome stay separate.
- `startedAt` is the active attempt's first durable runtime-start event, or null;
  its RFC3339 source spelling and independent agent clock are preserved.
  `testDurationMs` is the identity-bound ready history summary's measured k6 test
  duration, or null until recorded. Missing values never become request age or zero.
- Each suite is in exactly one group:

| Group | Latest retained run |
| --- | --- |
| `in_progress` | `state` queued, dispatching, active or finalizing |
| `passed`, `failed`, `inconclusive` | `finished` with that outcome |
| `stopped` | `cancelled` or `errored` |
| `no_runs` | none, including a suite with no revision |

- Storage keeps the latest run on the suite row (`latest_run_id`,
  `latest_requested_at`, `latest_group`). SQL triggers update it in the same
  statement as run insert, every state or outcome change of that run, and run
  deletion, which recomputes from the next retained run through
  `runs_history_suite`. A suite without a revision is stored as a private
  `no_revision` group so the engine filter stays index-bounded; it is reported
  as `no_runs`.
- Every header uses a scoped run/suite primary-key join, at most four indexed
  durable runtime-event rows and at most 2048 bytes of validated summary JSON.
  No metric/file reads or per-row HTTP requests. The stored latest-run derivation,
  current name, run/attempt identity and submission sort key are checked; corrupt
  or foreign facts make that workspace unavailable. No cross-clock order is assumed.

## Folder summaries (`listFolders`)

`FolderPage.summaries` has one entry per listed folder, in item order:

- `suiteCount` and `subfolderCount`: direct children only; descendants are
  never folded in.
- `groups`: a count for every group, classifying each direct suite once.
- `latestRun`: the newest latest-run header among direct suites, or `null`.

Items and summaries are read in one transaction. Counts read the
`suites_latest_folder_recent` index with no table rows; the newest header is one
index seek per run group.

## Suite list (`listSuites`)

| Field | Rule |
| --- | --- |
| `limit` | 1 to 100, required |
| `folderId` | Exact folder only; an unknown folder is `not_found`. Descendants are not included |
| `group` | One display group |
| `engineId` | The current revision's engine; a suite without a revision never matches |
| `order` | `recent_run` (default) or `name` |
| `name` | Suite-name search; same folding and limits as run-history `name` |

- `SuitePage.summaries` has one `SuiteListSummary` per item, in item order:
  `engineId` (`null` without a revision), `group` and the inline `latestRun`.
  No row needs its own `listRuns`.
- `recent_run`: `latest_requested_at` descending, then suite UUID descending;
  suites with no runs come last, ordered by suite UUID descending.
- `name`: folded name ascending by UTF-8 bytes, then suite UUID ascending.
- Each page runs one indexed keyset query per stored group, at most `limit + 1`
  rows each, and merges them; only the selected rows are projected.
- `FolderPage.summaries`, `SuitePage.summaries` and `SuiteRevisionSummary.runCount`
  are optional in the schema so older fixtures stay valid; this server always
  sends them.

## Cursors

- `suite-page-v1` binds scope, limit, `folderId`, `group`, `engineId`, `order`,
  `name` and the last position; any mismatch or malformed cursor is
  `invalid_input`.
- `recent_run` keeps the last latest-run time (`null` for no runs) and suite UUID.
  `name` keeps only the suite UUID and re-reads its folded name inside the page
  transaction; suites are never deleted.
- A suite's latest run, group, revision or name can change between pages, so
  membership can change. Pages are not a snapshot; refresh restarts.

## Name search

- Reuses the run-history name postings (`history_name_grams`, kind `suite`
  only) with the same folding, length rules and `search_indexing` refusal.
- Unlike run search, workspace and folder names never match and descendants
  are not expanded. More than 256 matching suites is `search_too_broad`.
- Index readiness is prepared before the page transaction; matching, then
  filtering and ordering of at most 256 candidates by their stored keys, happen
  inside it.

## Revision run counts

- `SuiteRevisionSummary.runCount` is the number of retained runs of that
  revision. `suite_revision_run_counts` holds one row per revision, maintained by
  triggers on revision insert and run insert and delete; a missing row aborts the
  run write (`revision run count`) and count rows can never be deleted.
- Reads are one primary-key probe. A revision created in the same transaction
  reports 0; run and export intake skip the count.

## Settlement and retention guards

- Backend settlement may purge a run: the generic suites guard now covers only
  the original suite columns plus `description`, and `settlement_suites_latest`
  lets the latest-run columns change only for the suite whose latest run is
  being deleted by settlement. Count rows may only decrement by one during
  settlement and are frozen during retention reservation.
- A later migration that adds a suites column must extend that guard's column
  list.

## Migration 034

Adds the three suites columns with their checks and backfill, four indexes
(`suites_latest_recent`, `suites_latest_name`, `suites_latest_folder_recent`,
`suites_latest_folder_name`), the triggers and the count table with its
backfill. It runs after run pinning (033). The upgrade test
projects a populated schema 34 fixture back to 33, re-applies 034 and checks
every derived value and page. Query-plan tests run on the exact prepared
statements and assert index use with no full scan.

## Related

- [Public API](public-api.md), [Authoring metadata](authoring.md),
  [Outputs settlement](outputs-settlement.md)
- Decision [021: bounded history search](../../decisions/021-bounded-history-search.md)

## Anchors

| Code | Reviewed |
| --- | --- |
| `app/src/adapters/outbound/sqlite/migration034.ts` | `2384729bf080` |
| `app/src/adapters/outbound/sqlite/suite-list/index.ts` | `ff7fc6508555` |
| `app/src/adapters/outbound/sqlite/suite-list/statements.ts` | `2e64b536de82` |
| `app/src/adapters/outbound/sqlite/suite-list/folders.ts` | `96429cc9bf54` |
| `app/src/adapters/outbound/sqlite/suite-list/presentation.ts` | `e212702cc2b7` |
| `app/src/adapters/outbound/sqlite/suite-list/latest-run.ts` | `9f7c47d3e604` |
| `contracts/src/api/suite-list.ts` | `d5e892bde351` |
