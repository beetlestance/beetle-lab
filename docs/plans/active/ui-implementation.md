# Plan: implement the Penpot design in `web/`

Status: active (2026-11-18). The Penpot "Screens" page is the target; the
current UI and layout do not constrain it. Rules in
[web UI](../../system/contracts/web-ui.md) still hold (truthful state, scope,
bounded reads, generated client only). The coordinator implements one screen family at a time on `rewrite/integration`.
Independent review is required for high-risk persistence and recovery changes.

## Status (2026-11-18)

The first implementation and retention restyle are merged, but code gates did not
establish visual parity. The connected Penpot Screens page has 145 boards,
including state sheets and responsive variants. All require explicit acceptance.
The active end-to-end Goal includes missing backend APIs and safe upgrade flows.

Work starts with shared dialogs, illustrations, skeletons and session layouts,
then Overview, Suites/editing/exports, live runs, results/history/comparison,
inputs/settings/retention and upgrades. Blocked work stays incomplete; record its
exact dependency and continue with the next independent ready item.

Each family requires real-browser screenshots at matching board dimensions and
state, comparison with exported Penpot images, and correction before acceptance.
Both skins, phone/tablet/ultrawide variants, keyboard and reduced motion are part
of the same family. Test fixtures may establish controlled visual states; end-to-end
acceptance separately requires real backend data and effects, never fixture-only claims.

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
| per family | Responsive and visual acceptance | Matching board exports, phone/tablet/ultrawide, keyboard and reduced motion | that family |
| required | Upgrade | Upgrade / States | Safe offline tool, fence, exact backup/rollback before activation; pinning/folder APIs already shipped |

## Rules for every package

- Wave 0 owns tokens (Darkroom and Scarab), fonts, shared primitives, the app
  shell and the route table. Wave 1 packages edit only their own feature folders
  and their route's page component; a needed primitive change is reported, not
  made locally.
- Where a board needs an unavailable API, implement its contract, bounded backend
  behavior and failure handling first. Do not hide the element or fabricate data.
  Older packet fallback instructions are superseded by this rule.
- Use scoped checks for each changed seam and retain logs and failures. Visual
  comparison happens during implementation, not after all families are built.
  Run broader integration checks at meaningful boundaries; do not repeat unrelated
  passing checks without an invalidated input or concrete concern.
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

Per-board data, reuse and gaps are in [part 1](ui-packets.md), [part 2](ui-packets-2.md)
and [part 3](ui-packets-3.md).

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
| Pinning | [run-pinning](run-pinning.md) (backend shipped; UI pending) | 033 |
| Suite folders | [suite-folders](suite-folders.md); revision run count | 034 |
| Installation status | Agent and host facts, image presence, slot holders and queue position | None (in-memory) |
| Live extras | Live target runtime graphs (heap and RSS, CPU, event-loop delay), p95 attribution, backup date; no downloads while live | 036 if needed |

Upgrade is required by the current end-to-end Goal. Reconcile Claude's existing
upgrade work before touching its files; incomplete rollback and activation remain
incomplete functionality. Every other family builds and exposes its designed
fields once its real backend contract is implemented.
