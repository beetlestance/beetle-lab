# Web UI

Rules every browser feature in `web/src/features/` follows, so that the UI never
shows data from the wrong scope, never claims an outcome the backend has not
recorded, and keeps every read and buffer bounded. Feature internals are in each
feature's `CONTEXT.md`; the stack choice is [decision 019](../../decisions/019-frontend-stack-and-engine-sdk.md).

## Ownership

| Concern                      | Owner                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes and route builders    | `web/src/features/runs/RunHistory.tsx` | `000000000000` |
| `web/src/features/runs/HistoryEmpty.tsx` | `000000000000` |
| `web/src/features/runs/HistoryHeader.tsx` | `000000000000` |
| `web/src/app/navigation.ts` | `000000000000` |
| `web/src/app/shell/AppShell.tsx` | `000000000000` |
| `web/src/features/runs/HistoryTable.tsx` | `000000000000` |
| `web/src/features/runs/result/PinControl.tsx` | `000000000000` |
| `web/src/features/runs/result/usePin.ts` | `000000000000` |
| `web/src/app/routes.ts`, the only source of in-app URLs                                                                                                                     |
| Server state                 | One TanStack Query client; keys from `web/src/app/queries.ts`, nested organisation → workspace → run → attempt                                                              |
| API access                   | The generated client from `contracts/`; no hand-written DTOs, no second client factory                                                                                      |
| Session access               | The session gate's one verified read, passed down as `SessionContext` (`web/src/app/session.tsx`: read-only and restored backup); features never read the session           |
| Input bytes                  | One byte client per paired session (`InputTransferContext`); see [inputs](inputs.md)                                                                                        |
| Drafts, chart and form state | The feature that renders them; never in the query cache or browser storage                                                                                                  |
| Visual tokens and motion     | `web/src/styles/tokens.css` (Darkroom and Scarab skins, bundled fonts, reduced-motion policy) and the primitives in `web/src/components/`; features add no palette or fonts |

## Scope and lifetime

- Scope and run identities come from validated routes. A reply is rendered only
  after the generated client binds it to the requested organisation, workspace,
  run and attempt; a foreign, duplicate or misordered reply is rejected.
- A scope, session or attempt change retires the old view immediately: late
  replies may settle but cannot render, navigate, mutate a retired cache entry or
  issue another request. Pending or failed reads in a new scope never show the
  previous scope's values.
- Session replacement remounts the application. Logout and unmount remove global
  listeners and never focus a disconnected node.
- At most one read per query is in flight. Manual refresh never cancels and
  overlaps an issued read (`cancelRefetch: false`; controls disabled while fetching).

## Truthful state

- Loading, empty, unavailable, stale, error and ready are distinct messages. An
  error hides cached figures or marks them unknown; missing values are never zero.
  Exception: the run timeline keeps its rows on a read error and labels them
  retained, not current (`runs/timeline/index.tsx`). Authoring and Script retain
  local draft/export intent through cached metadata refresh failures, with a warning.
- Artifact states are pending, absent, ready-empty and ready; an empty ready page
  is not source-free absence.
- Finalizing uses one indeterminate sealing card. Recorded events confirm files.
  K6 collect or seal entry confirms sampler closure when configured; seal confirms collection.
  Read errors label retained state and offer retry. Last-window time does not confirm execution stop.
- Run state and outcome come from the application. An engine-reported result is
  labelled provisional until the run is terminal; cancellation requested is not
  stopped, runtime exit is not passed, and a terminal run does not imply that the
  event stream or publication is complete.
- No synthetic progress, percentage with an unknown total, success badge after a
  browser hand-off, or download link before bytes are verified.
- Event rows show plain labels only: never raw event JSON, private runtime
  identifiers or filesystem paths. Event timestamps are for correlation, not
  elapsed time.
- Dynamic text is rendered as React text. Relative paths, IDs and names never
  become URLs except through route builders or the shared content-path helpers.

## Polling

| Surface                                                  | Interval          | Stops on                                                                   |
| -------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| Run result, run timeline, Overview featured run (active) | 2 s while visible | Terminal run (then one final refresh after any issued read settles), error |
| Artifact publication (pending)                           | 2 s while visible | Ready, absent, error; terminal run alone does not mean ready               |
| Export jobs list / single job                            | 2 s / 1 s         | All jobs terminal, error                                                   |
| Retention batch (applied)                                | 2 s               | Any other state                                                            |
| Overview aggregates, suite summaries, command search     | Never             | Manual refresh only                                                        |

Errors stop automatic polling; recovery is an explicit retry. A page with a next
cursor is backlog to drain at the normal cadence, not a tight loop.

## Bounded views

| Surface                  | Bound                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lists and folder pickers | Pages of 100; folder history 20 pages; one selected label across pages                                                                                          |
| Run timeline             | 100 rows and 64 KiB of projected rows, oldest evicted with a visible notice; bootstrap uses at most 2 requests (limit 1, then a seek to `durableThrough - 100`) |
| Artifact inventory       | One current page of 100 descriptors; pages never appended across attempts or manifests                                                                          |
| Result panel             | At most 128 declared artifacts, shown as declarations, never as download receipts                                                                               |
| Live chart buffers | At most 900 received windows; run-relative coordinates do not imply historical backfill |
| Script source            | verified text ≤ 1 MiB; at most 34 rendered rows and four index bytes per line; Copy/Export use complete source                                                  |
| Script changes           | two verified artifacts; ≤ 4,096 combined lines and 4M LCS cells, checked before allocation; same-suite choices from one page of 100 revisions                   |
| Command search           | First page of 100 per scope; query up to 128 characters; 40 results with the full match count                                                                   |
| Input upload             | One file up to 8 MiB; 64 KiB sequential appends; directory import 128 files, 8 MiB each, 128 MiB total, depth 8                                                 |
| Input download           | One verified result up to 8 MiB per control; one object URL, revoked on replacement or unmount                                                                  |

## Transfers

- Upload follows create → read → append → seal → read, binding every observed
  record to the prepared identity. No failed request retries automatically; an
  unknown outcome needs an explicit status read, and replay reuses the identical
  request ID and body. Cancel aborts but claims no rollback; a partial input may
  remain on the server and the UI says so.
- While an upload intent exists its file, name and folder are locked and one
  in-flight guard refuses a second submission. A `deleting`, `deleted` or
  `failed` record stops byte work with an explanation; the UI never recreates,
  compensates or deletes on its own. Download controls are hidden while the
  record is refreshing or pending deletion.
- Download waits for the complete verified result before creating a Blob, with a
  generated `input-<UUID>.bin` name; a Save link needs explicit activation.
- Run artifacts use a same-origin anchor from `runArtifactContentPath` with a fixed
  `artifact-<UUID>` name. The browser owns transfer progress and cancellation; the
  backend verifies length and digest before end of file (see
  [outputs collection](outputs-collection.md)).

## Command search

Navigation only: it never creates, cancels or mutates anything. One labelled
modal dialog owns focus (Tab wraps, arrows move, Enter activates, Escape closes),
captures the invoker and restores it on cancel, or focuses the main landmark after
navigation. It closes on route change before another scope's queries run, uses the
same query keys as list views, and closing it never cancels another observer.
Control or Command+K opens it. An organisation scope searches its first page of
workspaces; a workspace scope also searches its first pages of suites and runs. It
ignores composition and repeated keystrokes, never takes focus from another modal
and never resets an editor draft.

## Editors

New-suite links use `routes.newSuite` to select form or JSON authoring after the
user creates a named suite. Dismissing creation clears that entry intent.
The suite form and JSON views share one lossless draft; switching never drops
unknown fields. The suite page tab, editor view (form, Run setup, JSON) and open
request are URL state built by `routes.suitePage`, so deep links and back/forward
switch views without touching the draft. Invalid JSON stays editable but blocks conversion and saving. A
failed save keeps the draft; an unknown outcome offers replay of the identical
request; a stale version reads the latest head and offers explicit save as a new
revision, preserving earlier immutable history.

Script links resolve real organisation/workspace names before reading owners.
`routes.suiteScriptFromRun` carries one optional `run` UUID: the breadcrumb reads
and checks that run belongs to the suite, while labelling the selected script
revision separately. Malformed/duplicate origins issue no read. Cached namespace,
suite or revision refresh failures keep unknown export replay mounted; initial
not-found and foreign-suite data still refuse. Restored history disables run admission.
Changes compares generated JavaScript bytes, independently of configuration-derived
summary chips. Both sources bind scope, revision digest and published artifact
identity before rendering. Missing scripts require explicit preparation; comparison
never creates export jobs automatically or substitutes a configuration diff.

## Suite inventory

The Suites empty screen needs a complete folder page with root summary proving
zero suites and no non-root folders. A partial page or absent summaries stays
unknown. Loading uses one accessible status and decorative skeletons, with no
invented counts. Empty-state authoring opens the real engine and suite-details
flow; authoring controls are disabled in restored read-only history. Folder rows
use inline current names and measured durations, with one visible-tab clock for
actual runtime elapsed. Missing/unparseable/future starts stay explicit; restored
unfinished runs open recorded results, retain their state at backup and never tick
as current work; run, pending metric/artifact and timeline polling stays off.

## Overviews

Organisation and workspace overviews are one scoped GET each, built from metadata
in a single SQLite read transaction against the trusted server clock: exact
counts, 24 hourly UTC submission buckets over `[generatedAt − 24 h, generatedAt)`,
8 recent and at most 20 active run headers. Replies are capped at 32 KiB
(`app/src/application/overview/`, `organization-overview/`). Noncanonical stored timestamps make the snapshot
unavailable rather than miscounted; future submissions are excluded; active means
an active record, not a reachable engine; failed outcomes and execution errors are
counted separately. A missing scope is not found, never an empty dashboard.
Each hour partitions submissions by current passed, failed, in-progress and other
outcomes. The client checks bucket sums, scalar failure/state bounds and bounded
recent/active witnesses; colours never infer outcomes from a total submission count.
The header observes the current scope's successful cached snapshot without owning
another query. Suites and direct live-run headers own one snapshot read only after
organisation/workspace metadata succeeds, so a direct entry also fills the badge without early or duplicate
reads. Its badge counts active records exactly, including beyond the
20-header bound; absent/error snapshots and restored history show no badge.

The selected suite shows configuration summaries parsed from its immutable
revision (target origin without credentials or path, at most 8 scenarios, literal
durations only) and its latest retained run via a `suiteId` history filter. That
filter is resolved under the workspace before any run read, and its cursors are
bound to the suite; no retained runs does not mean never run. Resetting ordinary
filters keeps the suite context; an explicit workspace-history link clears it.

## History frame

Run history uses its existing page's scoped workspace name for the workspace frame;
a failed refresh hides cached names. Empty unfiltered history uses the exported
Runs illustration and opens the real suite creation flow; restored history keeps
only read navigation. A suite-filtered empty page never claims the workspace has
no runs. Names, row contexts and numeric facts never require per-row reads. Wide history tables retain readable columns in a named, keyboard-scrollable region.
The last column shares receipt-only pinning: unfinished runs hide it, restored pins are read-only at backup.
Accepted writes refresh history; uncertain writes permit identical replay; retention refusals preserve state.
Row and checkbox labels expand colliding source UUIDs, never inventing an ordinal.

Workspaces opens an organization chooser or the scoped workspace directory. Settings
keeps Installation, Organization and Workspace available from each level. Page and
tab entry honor reduced motion. Docs opens the bundled `/docs/` site as a full
document navigation. `/reference` remains the standalone generated API viewer.

## Related

- [Public API](public-api.md), [inputs](inputs.md), [results](results.md), [exports](exports.md)
- [Decision 012: UI redesign after the functional rewrite](../../decisions/012-ui-redesign-after-functional-rewrite.md)
- [Architecture](../../engineering/architecture.md)

## Anchors

| Code                                           | Reviewed       |
| ---------------------------------------------- | -------------- |
| `web/src/features/runs/HistoryTable.tsx` | `2df690223904` |
| `web/src/features/runs/result/PinControl.tsx` | `cf04755d6025` |
| `web/src/features/runs/result/usePin.ts` | `722f5660f124` |
| `web/src/app/routes.ts` | `61a58672901a` |
| `web/src/app/queries.ts` | `725fc7c07eb0` |
| `web/src/features/runs/timeline/read.ts` | `cbd57b66d9b4` |
| `web/src/features/runs/timeline/projection.ts` | `c683fdfec49a` |
| `web/src/features/command-search/model.ts` | `6d1867832757` |
| `web/src/features/input-directory/plan.ts` | `f0ec22cf9b89` |
