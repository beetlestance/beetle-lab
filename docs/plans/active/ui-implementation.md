# Plan: implement the Penpot design in `web/`

Status: active (2026-11-18). The Penpot "Screens" page is the target; the
current UI and layout do not constrain it. Rules in
[web UI](../../system/contracts/web-ui.md) still hold (truthful state, scope,
bounded reads, generated client only). Work runs in parallel worktrees and is
integrated into `rewrite/integration` by the coordinating session.

## Waves

| Wave | Package | Penpot boards | Depends on |
| --- | --- | --- | --- |
| 0 | Foundation | States / Controls, Components page, header of every board, Phone / Menu open | none |
| 1 | A. Home and navigation | Overview (+Empty, Loading, Search), Organization (+Empty, Loading), Overlay / Search, Not found / *, Phone and Ultrawide / Overview | 0 |
| 1 | B. Suites | Suites (+Empty, Loading, New suite), Suites / Folder (+Empty, No match), Suite / Overview, Suite / Revisions, Suite / Start run (+Budget), Overlay / Engine picker | 0 |
| 1 | C. Suite editor and scripts | Suite / Edit (+Request, Run setup, JSON), Panel / Save revision / Errors, Overlay / Save conflict, Script / revision 1 (+Changes, One column), Overlay / Export script / * | 0 |
| 1 | D. Live run | Live run and its states (Starting, Waiting for capacity, Paused, Reconnecting, Cancelling, Finalizing, Animated 01–08, Compare tooltip, Script picker, Download open), Phone and Ultrawide / Live run | 0 |
| 1 | E. Runs, results, compare | Runs (+Empty, Loading), Run result and its 14 variants, Overlay / Artifact viewer, Overlay / Delete run, Compare (+Empty) | 0 |
| 1 | F. Inputs, engines, settings | Inputs (+Empty), Engines, Settings (+Loading), Installation (+Capacity), Workspace (+Retention preview, progress), Overlay / Delete workspace, organization, folder, input | 0 |
| 2 | Responsive and QA | Phone boards, ultrawide, keyboard and reduced motion; visual comparison against board exports | 1 |
| gated | Pinning, upgrade, folder summaries | Pinning / States, Upgrade / States, folder counts on Suites | backend proposals in `proposed/` |

## Rules for every package

- Wave 0 owns tokens (Darkroom and Scarab), fonts, shared primitives, the app
  shell and the route table. Wave 1 packages edit only their own feature folders
  and their route's page component; a needed primitive change is reported, not
  made locally.
- Where an API the board needs does not exist, build against what exists, hide
  the missing part, and list the gap. Never fake a value.
- Checks per package: web typecheck, the package's vitest files, lint and format
  on touched files. The coordinator runs `build:web` and the full web test set
  once per integration.
- No push. Commits stay on the package branch until merged.

## Estimates

Agent time, not calendar time, assuming the current API covers most boards.

| Package | Estimate |
| --- | --- |
| 0 Foundation | 4–6 h |
| A | 3–5 h |
| B | 4–6 h |
| C | 5–8 h |
| D | 5–8 h |
| E | 6–9 h |
| F | 5–8 h |
| 2 Responsive and QA | 3–5 h |
| Integration (coordinator) | 1 h per merge, about 6 h |

Total about 40–60 agent hours. With six wave-1 lanes in parallel, roughly two to
three working days end to end. Gated features add backend work first.

## File ownership in wave 1

Per-board data, reuse and gaps are in [part 1](ui-packets.md) and [part 2](ui-packets-2.md).

| Package | Owns |
| --- | --- |
| A | `organization-overview`, `workspace-overview`, `organizations`, `workspaces`, `command-search` |
| B | `features/suites/index.tsx`, `History.tsx`, `MetadataEditor.tsx`, `suite-overview` |
| C | `features/suites/RevisionEditor.tsx`, `ConfigFields.tsx`, `draft.ts`, `useWrite.tsx`, `exports` |
| D | `features/runs/live/` and the live-metrics, timeline and cancellation views it composes |
| E | `features/runs/result/`, run history, artifacts, comparison; composes `retention` for run deletion |
| F | `inputs`, `input-*`, `settings`, `retention`, `namespace-deletion`, engines |

Wave 0 makes `RunDetail` a state dispatcher into `live/` and `result/` and owns
the shared not-found component. Shared app tests (`suites.test.tsx`,
`settings*.test.tsx`, `inputs*.test.tsx`) belong to the package that owns the
feature; B and C coordinate `suites.test.tsx` through the coordinator.

## Backend wave (decided 2026-11-18: implement, do not drop UI)

| Lane | Scope | Migration |
| --- | --- | --- |
| Authoring metadata | Suite description; revision `savedAt`, `message`, `savedBy`; run notes in search; run start and finish | 031 |
| Inputs | Added date; row and column counts; usage lookup and named delete blockers | 032 |
| Pinning | [run-pinning](../proposed/run-pinning.md) | 033 |
| Suite folders | [suite-folders](../proposed/suite-folders.md); revision run count | 034 |
| Installation status | Agent and host facts, image presence, slot holders and queue position | 035 if needed |
| Live extras | Live target readings, provisional downloads, p95 attribution, backup date | 036 if needed |

Upgrade follows separately. Wave-1 UI packages build against these fields once
each lane merges, and hide them until then.
