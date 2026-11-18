# Plan: wave 2 browser QA against the Penpot boards

Status: active. The running UI was compared with the Penpot board exports at
1440, 390 and 2560 wide, in both skins, with keyboard and reduced motion. Clear
mismatches in `web/` are fixed on the QA branch; the rest are listed below with
the reason they remain. Parent plan: [UI implementation](ui-implementation.md).

## Method

- QA install on loopback (port 4590); host Vite served the worktree's `web/`
  with an API proxy to that install. No image was rebuilt.
- Data seeded through the UI only: organization Acme, workspaces Checkout team
  and Search team, folders capacity and smoke, three suites with revisions, two
  runs, and one input via Add a sample file.
- Headless Chrome scripts recorded horizontal overflow
  (`scrollWidth - clientWidth`), console errors and failed requests per route.
- Truthful-state rule (`docs/system/contracts/web-ui.md`): no value was
  invented to match a board. Where data is missing, the gap is reported here.

## Checks that pass

- Header sits at the board position; Tab order is skip link, brand, scope,
  nav, Search, skin, Sign out, then page content. Every stop shows a ring.
- Dialogs trap focus, close on Escape and return focus to the invoker.
- Cmd-K and Ctrl-K open search; Escape closes it.
- The phone menu closes on Escape and returns focus to Menu.
- Reduced motion: no animation or transition longer than 10 ms remains.
- Scarab skin: header, tables, buttons and status colours follow the tokens.
- No horizontal overflow on any captured route at 1440, 390 or 2560 after
  the fixes below.

## Per screen

| Screen | State | Commit or reason |
| --- | --- | --- |
| All screens | Fixed: fonts were inlined as `data:` URIs that the CSP blocks | 9530f523 |
| Header | Fixed: session strip removed, Sign out in header tools | 27903a30 |
| Tables (organization, runs, folders) | Fixed: row headers shaded like headers; links underlined | 947d5039 |
| Dialogs | Fixed: actions right-aligned, Cancel before primary | 947d5039 |
| Create and rename | Fixed: inline panels became dialogs; stale "Changes saved" gone | 10c9811f, 31b49005 |
| Organization | Matches layout. Remaining: Suites and Runs-24h columns | Data gap (not in the overview read) |
| Overview (workspace) | Fixed: nested `<p>` console error | d97396de |
| Overview (workspace) | Legacy folder admin table and Overview tabs removed; folder create/rename/move/delete now live in Suites | Implemented; full visual acceptance remains open |
| Overview, empty | Remaining: hero illustration missing | Needs decision (asset) |
| Overview, Local agent | Remaining: disk reads "70,800 of 117,871 GiB" | Backend: `backendTotalBytes` is 126.6 TB on a 494 GB host |
| Search overlay | Matches | |
| Suites, folder, suite overview, revisions | Match layout | |
| Start run | Matches | |
| Suite edit (form, request, run setup, JSON) | Remaining: "Longest duration" sits lower than its siblings because of its hint | Minor; field grid alignment |
| Engines | Remaining: Choose is not amber text; planned rows are not dimmed in the picker | Minor |
| Runs | Fixed: legacy breadcrumb row removed, workspace tabs added | 1ff04358 |
| Runs, phone | Fixed: state filter widened the page by 49 px | 91b14bcf |
| Live run | Fixed: KPIs in sans, endpoint table full width without thresholds, Cancel run inverse | 6c8f823f, 947d5039 |
| Live run | Remaining: p95 chart is empty until samples arrive ("Since this page opened") | Data: the live read has no backfill |
| Run result | Fixed: 3827 px overflow, then a second overflow from the raw report `<pre>` | 1ff04358, c487b764 |
| Run result | Fixed: "Runs / run xxxx" context line replaces the breadcrumb | 1ff04358 |
| Run result | Remaining: separate KPI cards rather than one panel; legacy "Recorded metrics" chart with ISO times | Needs decision: larger rework of the result read |
| Run result | Remaining: intermittent 503 on thresholds and result details | Backend |
| Run result, phone | Fixed: artifact paths wrapped one character per line | 7f77e56f |
| Compare | Matches structure; "Metric: not_requested." shows a raw code | Minor copy fix |
| Inputs | Fixed: header names the workspace; empty state no longer repeats header actions | 76c98acb |
| Inputs | Remaining: board puts the workspace name as h1 and tabs under the header | Needs decision: same header pattern for Inputs, Exports, Runs |
| Exports | Same header pattern question as Inputs | Needs decision |
| Settings (installation, org, workspace, retention) | Save bar inverts when dirty as on the board | |
| Settings, installation | Remaining: memory 0.536871 GB, output 0.0671089 GB | Needs decision: unit formatting |
| Settings, installation | Remaining: Beetle version row | Backend gated |
| Delete dialogs | Match | |
| Not found (path, organization) | Match | |
| Not found (run) | Fixed: showed a "Resource not found" retry banner | b0894077 |
| Folder table, phone | Fixed: action buttons stacked, rows 350 px tall | 69060171 |
| Scope switcher | Remaining: shows "Organization" on run and compare routes | Needs decision: the switcher never fetches; the org query is not cached there |

## Console

- 401 on `/auth/session` before the loopback session opens: expected flow.
- 404 for the probe of a missing run or organization: expected.
- One unidentified 404 resource on the organization page (not an API call).

## Next

- Decide the workspace header pattern (Inputs, Exports, Runs) and move folder
  management from the workspace overview into Suites.
- File the disk-size measurement and the result-details 503 as backend issues.
- Rework the run result summary into the board's single KPI panel.
