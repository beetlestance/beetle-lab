# Plan: folder-first Suites tab

Status: active (2026-11-18). Backend and API shipped on the suite-folders branch
with migration 034 (after run pinning 033); shipped behaviour is in
[Suite listing](../../system/contracts/suite-listing.md). Remaining: the web
Suites tab adopting `listSuites` filters and summaries, and `includeDescendants`
(deferred). Design: Penpot "Screens" boards
"Suites" (folder list) and "Suites / Folder" (one folder: status filter, engine
filter, search, sort, 100-row pages).

Today `listFolders` and `listSuites` take only `PageQuery`. Suites carry
`folderId` but cannot be filtered by it, searched or ordered by last run, and
each suite row would need its own `listRuns` call.

## Latest run

- A suite's latest run is its latest **retained** run by `requestedAt`, then run
  UUID, both descending. Deleting it reveals the previous retained run; none left
  means "No runs" (never "Never run").
- The response carries the run's `state` and `outcome` separately, as `Run` does.
  The interface derives one display group:

| Group | Latest run |
| --- | --- |
| In progress | `state` queued, dispatching, active or finalizing |
| Passed | `finished` and `passed` |
| Failed | `finished` and `failed` |
| Inconclusive | `finished` and `inconclusive` |
| Stopped | `cancelled` or `errored` |
| No runs | no retained run |

The filter chips show All plus every group with a nonzero count.

## Folder summaries (`listFolders`)

Each folder reports its direct suite count, subfolder count, a count per group
that classifies each **direct suite once** by its latest retained run, and the
newest latest-run header among its direct suites (suite, run, `state`,
`outcome`, `requestedAt`). Child folders are never folded in; the row says
"Has N subfolders". Items and summaries come from one read transaction.

## Suite list (`listSuites`) additions

| Field | Meaning |
| --- | --- |
| `folderId` | Exact folder only. `includeDescendants` is deferred; nested folders are browsed one level at a time |
| `group` | One display group from the table above |
| `engineId` | The engine of the suite's current revision. A suite with no revision has no engine, matches no `engineId` filter and shows "No revision" |
| `order` | `recent_run` (default) or `name` |
| `name` | Suite-name search |

Every row carries its latest-run header inline: one bounded response of at most
100 rows, never a request per row.

## Ordering and cursors

- `recent_run`: latest retained `requestedAt` descending, then suite UUID; suites
  with no runs come last, ordered by suite UUID.
- `name`: folded name, then suite UUID.
- The cursor binds scope, limit, `folderId`, `group`, `engineId`, `order`,
  `name` and the last position, like the run-list cursor; any mismatch rejects.
- A suite's latest run, group, revision or name can change between pages, so
  membership can change. Refresh restarts pagination; pages are not a snapshot.

## Search

Reuse the run-history name index (same folding, 3 or more scalars, ≤ 64 bytes,
`search_too_broad` and `search_indexing`) but not its matching rule. Run search
matches workspace and folder names and expands descendants; suite search
matches **suite-name postings only**.

## Bounded work

A page size and reply cap do not bound scanning. Without stored state,
`recent_run` order and group counts would read every suite's runs.

- Store the latest retained run per suite (`suites.latest_run_id`,
  `latest_requested_at`, `latest_group`), updated in the same transaction as run
  creation, every state or outcome change of that run, and run deletion (which
  recomputes from the next retained run through
  `runs(suite_id, requested_at DESC, run_id DESC)`).
- Indexes for each actual query, for example
  `suites(workspace_id, folder_id, latest_requested_at DESC, suite_id)`,
  `suites(workspace_id, folder_id, name_folded, suite_id)` and
  `suites(workspace_id, folder_id, latest_group)`.
- Query-plan tests on the exact prepared statements (not handwritten copies)
  asserting index use and no full scan, as `INDEXED BY` already does for run
  search.
- Folder counts read the group index; summaries and items share one read
  transaction.

## Evidence

Migration test from the previous schema with backfill of the stored latest run;
tests for deletion revealing the previous run, each group, `recent_run` ties and
no-run ordering, cursor binding, suite-only search and the query plans.
