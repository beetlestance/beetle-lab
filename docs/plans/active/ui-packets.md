# Plan: UI task packets

Status: active (2026-11-18). Board-to-API map for [ui-implementation.md](ui-implementation.md), read from Penpot and the contracts on 2026-11-18.

Sources: `docs/plans/active/ui-implementation.md`; Penpot "Screens" page (all 105
top-level boards read as text via `execute_code`, read-only, no page switch, no
exports needed); `contracts/api/v2/http-operations.json` (63 ops, all
`implemented`) and `contracts/api/v2/*.schema.json`; `web/src`.
Binary routes outside `http-operations.json` (in `contracts/src/api/*`):
artifact content `.../runs/:runId/attempts/:attemptId/artifacts/:artifactId/content`,
export content `.../exports/:exportId/content`, input content `.../inputs/:inputId/content`.

## Cross-cutting facts that cause most of the gaps

- **No actor or timestamps on authoring objects.** `Suite` = {id, version, name,
  folderId, currentRevisionId}. `SuiteRevision` = {ordinal, engineId(k6), digest,
  config, inputManifest}. They have no description, saved-at, author ("by Meera"),
  revision message, or run count. `InputRecord` has no created-at. `Run` has only
  `requestedAt`. It has no start, finish or actor field and no note.
- **No suite description field anywhere.** It is not in `Suite`, and the k6 config
  top level is version, loadPlan, target, requests, datasets, secrets, selections,
  readiness, targetSampling.
- **No agent or host status operation.** CPU, memory and disk usage, "image cached",
  host-reported capacity, run-slot holders and queue position are not available.
- **No pinning.** It is gated (`docs/plans/proposed/run-pinning.md`). **No folder
  summaries, suite last-run, suite search or sort.** Those are gated
  (`proposed/suite-folders.md`). `listSuites` and `listFolders` take only `PageQuery`.
- **No pre-rendered script text.** A script exists only after `createExport` reaches
  `ready`. The text is then read from the export content route.
- Display IDs such as `a7f2` can be derived on the client (a UUID prefix).
  Durations such as "Took 01:00" come from `RunPage.summaries[].testDurationMs`.
- Restored history: `BrowserSession.readOnly === true` marks the historical viewer.
  The backup timestamp ("restored backup from 12 Nov, 02:00") is not in the API.
- **Shared-file hot spots.** `app/routes.ts`, `app/App.tsx` (Route table,
  `InvalidRoute`), `app/queries.ts` (keys), and app-level tests in `web/src/app/*.test.tsx`.
  Plan rule: Wave 0 owns the route table and shell. Each package below lists what
  it would need added, so the coordinator can add those entries centrally.
- **D/E conflict.** Live run and Run result share `routes.runPattern` and are both
  rendered by `features/runs/RunDetail.tsx`. Recommendation: Wave 0 or the
  coordinator owns one state dispatcher in RunDetail. D owns a new
  `features/runs/live/`, and E owns a new `features/runs/result/`.

---

## A. Home and navigation (13 boards)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Overview | Hero: workspace name; "1 run in progress"; "8 runs finished in 24 h, 1 failed"; "5 suites, 4 input files ready". Live-run card (suite, run id, stage plan, elapsed/left/ETA, %, rps, p95, failed%, "Open live run"). Last-24 h hourly bars. Recent runs (state, suite, id, time, p95, "All runs"). Agent panel (status, k6 image, CPU, memory, disk). | `getWorkspaceOverview` (counts.active/submitted24h/failed24h/suites, activity[24], recent[≤8], active[≤20]); `listRuns` limit 8 + `summaries` (p95); `listSuites` page for suite names (OverviewRun has only suiteId); `getRunLiveMetrics` + `getSuiteRevision` (stages) for the live card | `features/workspace-overview` (`WorkspaceOverview`, `OverviewFacts`); `runs/live-metrics` (`useLiveMetrics`); `suite-overview/configuration.ts` (stage projection) | **Agent panel: no operation → hide the whole panel.** Input-file count is not in `OverviewCounts` → count `listInputs` `published` only when `nextCursor==null`, otherwise hide. `submitted24h` counts submitted runs, not finished ones → reword the copy. Buckets are counts only (no pass/fail split) → use a single-colour bar. ETA and elapsed need the actual start time, which `requestedAt` does not give → take it from the `listRunEvents` start or hide ETA. |
| Overview / Empty | "No runs in X yet", "Write your first suite", agent-ready line | counts.runs==0 | same | Agent line ("8 CPUs and 6 GiB free") → drop it |
| Overview / Loading | Skeleton table | – | – | none |
| Overview / Search, Overlay / Search | ⌘K palette: suites, "Start <suite>" action, runs with state | `listSuites`, `listRuns` first pages | `features/command-search` (whole) | The "Start suite" action needs the run-start entry from B → link to the suite's Start run route. Visual restyle only. |
| Organization | Org name; "2 workspaces, 1 in progress, 9 runs in 24 h, 1 failed". Workspace table: suites, runs 24 h, right now, last run. Organization settings link. Scope menu: orgs, workspaces, "1 running". | `getOrganizationOverview` (counts, recent[] with workspaceId, `workspaces` = an integer only); `listWorkspaces`; per-row figures need `getWorkspaceOverview` × N | `features/organization-overview`, `features/workspaces/WorkspaceList.tsx` | Per-workspace suites, runs-24 h and right-now values are **not** in the org overview → N fan-out reads (cap at first page ≤100; show "unknown" on error) or show the name plus a last run taken from org `recent` only. Scope-menu running badges have the same problem. Scope menu belongs to the Wave 0 header. |
| Organization / Empty, / Loading | Empty copy, "Open payments", settings link | `listWorkspaces` | same | none |
| Not found / Organization, Script, Suite, Run | Message + back link | ApiError `not_found` from get* | `App.tsx` `InvalidRoute` | Needs a shared NotFound component. Owned by A, but B/C/E render it on their 404s → Wave 0 should export it, or A ships it first. |
| Phone / Overview, Ultrawide / Overview | Same content, re-laid out | same | – | Same gaps. Phone / Menu open belongs to Wave 0. |

Owns: `features/workspace-overview/*`, `features/organization-overview/*`,
`features/organizations/*`, `features/workspaces/*`, `features/command-search/*`
(restyle), a new `features/not-found/`.
Shared: `App.tsx` (InvalidRoute→NotFound, home route); `routes.ts` (no new
patterns needed; "Overview" = `routes.workspace`); app tests `scope.test.tsx`,
`states.test.tsx`, `mutations.test.tsx` (namespace editor flows).
Reuse level: **high** (data layer exists; mostly layout).

---

## B. Suites (13 boards)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Suites (folder list) | Workspace tabs; "45 suites in 6 folders"; New folder / New suite; search all suites; sort "Recently run"; folder table: suites count, pass/fail/in-progress mix, last run suite+time+result+duration, subfolder count | `listFolders`, `listSuites` (PageQuery only), `createFolder`, `createSuite` | `workspaces/FolderList.tsx`, `suites/index.tsx`, `suites/MetadataEditor.tsx` | **Gated (suite-folders).** Per-folder result mix, last run, search and sort have no operation. Fallback: folder name plus suite count computed from the loaded suite page only when it is complete; subfolder count from `parentFolderId` on a complete folder page; hide the result mix and last run; client-filter search on the loaded page and label it so. |
| Suites / Empty, / Loading | Empty copy, "Write a suite" | `listSuites` | same | none |
| Suites / New suite + Overlay / Engine picker | Picker: k6 (Choose), 5 others "Planned"; Not now | `createSuite`; installation `supportedProfiles` / `getExportProfiles` for installed engines | `suites/MetadataEditor.tsx` | Planned engines are static product copy (honest if labelled Planned). |
| Suites / Folder | Status chips with counts (All/In progress/Passed/Failed/No runs); engine filter; search; sort; table: suite, description, engine, plan (executor, total time, request count), revision #+saved date, last run state+time, Start run; "Showing 8 of 20, Show 12 more" | `listSuites` (filter by folderId client-side); `getSuiteRevision` per suite (engine, plan); `listRuns{suiteId,limit:1}` per suite | `suite-overview` (`SuiteLatestRun`, `configuration.ts`), `runs/HistoryFilters` | **Gated (suite-folders).** Server folder filter, status counts, sort-by-last-run, search and paging are missing. Per-row last run = N `listRuns` calls (the proposal flags exactly this). **Description: no field → hide.** Revision saved date: none → show the ordinal only. Fallback: client folder filter on the loaded page, last run lazily per visible row (≤ page size) or hidden, no status chips. |
| Suites / Folder / Empty, / No match | Empty/no-match copy, Clear search | same | – | "No match" only applies to client-side search |
| Suite / Overview | Header: name, description, "Revision 4, saved … by Meera"; tabs Overview/Edit/Revisions(n); load-shape chart + stages + VUs; requests table (method, path, share %, body input name, checks); thresholds; datasets; recent runs (state, rev, time) | `getSuite`, `getSuiteRevision` (config), `listSuiteRevisions` (count), `getInput` for body/dataset names, `listRuns{suiteId}` | `suite-overview/ConfigurationSummary.tsx`, `configuration.ts`, `SuiteLatestRun` | Description, saved-at and author → hide. The revision count needs paging through `listSuiteRevisions` → show it only when `nextCursor==null`, otherwise "n+". The "rev N" label on recent runs maps `Run.revisionId` → ordinal through the loaded revisions page. |
| Suite / Revisions | Per revision: title message, Latest, date by author, run count, change bullets ("rate: 1,000 to 1,200"); View script, Run this revision | `listSuiteRevisions` (SuiteRevisionSummary: ordinal, digest, preflight) | `suites/History.tsx` (`History`, `SavedRevision`) | **Message, date, author and run count: no fields → hide.** Change bullets → client diff of adjacent `getSuiteRevision` configs on demand (bounded), or hide. |
| Suite / Start run (+ Budget) | Dialog: revision select, plan preview, length vs. limit ("Within the 30-minute limit"), budget (CPU/mem/procs/output) with provenance "from checkout-team", "Change for this run", target, "Run alone" | `createRun` {revisionId, engineProfile, budget, executionPolicy{mode parallel/isolated, preferIdle}}; `getWorkspaceSettings` effective (`NumericEffectiveLeaf.value/source/allowedRange`) | `runs/RunSavedRevision.tsx`, `runs/useSubmission.ts` | Target is read-only (CreateRunRequest has no target override) → display it, don't edit it. The plan length comes from config stages (client). |

Owns: `features/suites/*` (list and overview parts), `features/suite-overview/*`.
Shared: `routes.ts` needs a folder route (e.g. `.../suites?folder=` or
`.../folders/:folderId`), suite tab routes (`/suites/:id/revisions`, `/suites/:id/start`
or a query param); `App.tsx` Route entries; `queries.ts` maybe a per-suite latest-run key
(today `runsPage` with suiteId is reused). Overlaps C in `features/suites/*` →
split: B owns `index.tsx`, `History.tsx` and `MetadataEditor.tsx`; C owns
`RevisionEditor.tsx`, `ConfigFields.tsx`, `draft.ts` and `useWrite.tsx`. App test:
`app/suites.test.tsx` (shared with C).
Reuse level: **medium**. The data reads exist, but the folder-first lists are gated.

---

## C. Suite editor and scripts (13 boards)

| Board | Shows / actions | API | Reuse | Gaps → fallback |
|---|---|---|---|---|
| Suite / Edit | Form/JSON toggle; About (name, folder, description, target); How load arrives (executor, peak rate, ramp/hold/drain, max VUs, chart); Requests list (method, path, weight, body from input, checks chips, add/remove); Pass only if thresholds; Datasets; "Save as revision 5" | `createSuiteRevision` {expectedVersion, config}; `patchSuite` (name, folder); `listInputs` (body/dataset choices); k6 schemas `contracts/engines/k6/v1/*` | `suites/RevisionEditor.tsx`, `ConfigFields.tsx` (JSON text + minimal method/path/executor/target controls), `draft.ts` (`parseDraft`, `updatePart`), `useWrite.tsx` (replay) | **Description: no field → drop it.** Most structured form controls are new UI over `draft.ts`; there is no API gap for them. |
| Suite / Edit / Request | Name, method, path, query params, headers (secret refs), body None/Inline/From input, size limits copy, checks (kind/path/value, Required/Optional), insertable `{{data.*}}`/`{{secret.*}}` | config `requests[]` (`requests.schema.json`), `datasets`, `secrets` | `draft.ts` | Values palette from config datasets/secrets plus input column names. **CSV column names are not in `InputRecord`** → offer only dataset ids, or read the input content header (an extra download; skip). |
| Suite / Edit / Run setup | Scenarios (≤64) executor/start/graceful stop/rates/VUs; request mix weights/wait/limit; readiness probe; target sampling (`/debug/process`, interval, timeout, keep-reading) | config `loadPlan.scenarios`, `selections`, `readiness`, `targetSampling` | `ConfigFields.tsx` scenario executor control | none (schema-backed) |
| Suite / Edit / JSON | Complete JSON | same | `ConfigFields` JSON mode | none |
| Panel / Save revision / Errors | "Fix 3 things", per-field errors with jump-to; "users.csv was deleted" | `ApiError.fields[{path, code}]` from `createSuiteRevision` | `suites/useWrite.tsx` `WriteStatus` | Field codes are generic (required/type/format/range/…); human messages are client-mapped. "Input was deleted" → client check of `inputManifest` ids against `listInputs`/`getInput` state `deleted`. |
| Overlay / Save conflict | "Revision 5 was saved at 05:31 from another tab"; Copy my edits / Open revision 5 / Save as revision 6 | 409 `conflict` → `getSuite` (version, currentRevisionId) → `getSuiteRevision` | `useWrite.tsx` replay | Save time and source tab: no data → "Another revision was saved". |
| Script / revision 1 | Script source with line numbers; "Runs with plain k6… put users.csv … next to it" | `createExport` → `getExport` (ready, artifact) → export content route | `features/exports` (`ExportSavedRevision`, `Job.tsx`, `useWrite.ts`) | **No direct script read.** Viewing requires an export job (agent work). Fallback: "Prepare script" → show text when ready. Input file names come from `inputManifest` ids → `getInput` names. |
| Script / … / Changes (+ One column) | Compare-with revision select, +/− counts, semantic bullets, side-by-side or unified diff | two ready exports, or two `getSuiteRevision` configs | – | Diffing scripts needs two export jobs → diff config JSON instead (honest, no agent), or diff scripts only when both exports exist. Semantic bullets are client-derived. |
| Overlay / Export script / Preparing | Steps Queued → Sent → Writing (for 12 s) → Checking; Close; Cancel export | `ExportJob.state` queued/dispatching/generating/publishing; `cancelExport` | `exports/Job.tsx` | Per-state elapsed time: only `requestedAt` → show elapsed since request. |
| … / Ready | File name, size, SHA-256, made-at; Copy SHA; Download | `ExportJob.artifact{name, bytes, sha256}` + content route | `exports/Job.tsx` | Made-at: no artifact timestamp → omit. |
| … / Uses secrets | Names the secret; Open the editor | Pre-check `config.secrets`; server `reason: unsupported_secrets` | – | none |
| … / Unknown | "Last heard 6 min ago", "Reserved 64 MB" | `state: unknown`, `budget.outputBytes` | – | Last heard: no field → omit. |

Owns: `features/suites/{RevisionEditor,ConfigFields,draft,useWrite}*`, a new
`features/suite-editor/` (form sections), `features/exports/*`, a new `features/script-view/`.
Shared: `routes.ts`: edit route (`/suites/:id/edit`, `/edit/requests/:reqId`,
`/edit/setup`), script route (`.../revisions/:revisionId/script`); `App.tsx` Routes;
`queries.ts` `exports`/`export` keys already exist. App test `app/suites.test.tsx`.
Reuse level: **medium-low** (write and replay plumbing exists; the form editor is mostly new).

---

Packages D–F continue in [part 2](ui-packets-2.md).
