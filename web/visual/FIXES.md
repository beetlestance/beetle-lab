# Fixes from the screenshot review

Every finding from the screenshot suite (CASES.md) that needs a change in the app. The Penpot
boards are the spec: where the app and a board differ, the app changes, unless the board
shows data the API cannot provide (those go to Backend and contract below).

Status: `[ ]` open, `[x]` fixed and screenshot re-checked against the board, `[~]` partly
fixed (note says what is left), `[-]` not changed (note says why).

Each package is one branch (`fix/<package>`) with its own files. Board PNGs are named by
slug (`Run result / Failed` → `run-result-failed.png`).

## First review pass

- Phone document width now stays within the viewport on populated Overview, Inputs and Exports. Wide
  inventories scroll inside their own keyboard-focusable region.
- Settings subsections are in browser history and use the existing route transition. Reduced motion
  continues to disable the animation.
- Gallery labels identify shared skin references and viewport fallbacks.
- Folder suite counts remain direct by design. The result headline uses the aggregate overview when
  available. Source and sample data need checking before making changes to either.

## Fresh review pass

Codex re-exported all 150 Penpot boards and checked the seven prototype flows in Chromium
against `806200f9`. Its findings are folded into the packages below (P1, P4, P5, P6) and the
new P7 motion package. The fresh gallery paired 145 boards with app screenshots.

Live Reconnecting waits for fresh metrics, Cancelling waits for settlement, and restored history
remains read-only.

## P1 overview-shell — `web/src/features/workspace-overview`, `organization-overview`, app shell

- [ ] org-overview-tab — (revised by the fresh review; replaces the dashboard item) the Organization board is a workspace table: add Suites, Runs and 24-hour activity per workspace (needs an authoritative source; if the API has none, Backend and contract) and put Organization settings below the table, as on the board
- [ ] org-overview-states — Organization / Empty shows its own no-runs content and illustration; Loading and Search as on the boards
- [x] overview-blank-space — the accessibility table no longer expands the document
- [ ] overview-width — ultrawide: hero capped at 820px while the lower row stretches; contain the page so everything aligns (Ultrawide / Overview)
- [ ] overview-refresh-line — "As of 19:21. Refresh overview" is not on the board
- [ ] overview-section-tabs — workspace section tabs above the hero are not on the board
- [ ] overview-copy — headline, summary line, "Local agent" title and status line as on the board
- [x] phone-live-card — Phone Overview keeps the active phase label above the progress marker at 390 px.
- [x] phone-menu-sign-out — verified at 390 px with keyboard dismissal and focus restoration
- [ ] phone-org-table — phone: organization table actions run off the screen
- [x] connection-lost — Runs keeps the last verified page and its timestamp during a failed refresh. Filters, paging, comparison and pinning pause until a successful refresh. First-load failures and permission refusals hide rows.
- [ ] nav-highlight — run pages highlight "Workspaces"; match the boards' nav state

## P2 namespaces — organization, workspace and folder dialogs

- [x] folder-menu-delete — the open popover stays interactive as the pointer leaves the row
- [ ] create-dialogs — New folder, New workspace, New organization: titles, labels, character counter and address derived from the name, as on the boards
- [ ] workspace-name-taken — name taken is shown inline on the field, as New folder / Name taken does
- [ ] suite-rename — Rename suite with `patchSuite`, plus Changed elsewhere (Overlay / Rename, Overlay / Rename / Changed elsewhere, Phone / Rename)
- [x] delete-organization-blocked — The retirement refusal lists active workspace names with verified suite and run totals and links to Workspaces. Unavailable counts are identified.
- [ ] refusal-blockers — refusal dialogs show only "Version or intent conflict"; show what blocks the action as the boards do (Delete workspace / Blocked, Delete folder / Not empty, Retire … / Refused). If the API reply has no blocker detail, list it under Backend and contract
- [ ] namespace-copy — remaining copy on these dialogs as on the boards

## P3 suites — suites list, suite page, editor, script, start run

- [-] folder-count — the agreed count includes direct suites; subfolders are separate
- [x] new-suite-picker — both shortcuts use the picker and retain the requested editor mode
- [ ] sample-file-folder — Add a sample file has no folder choice
- [ ] export-file-name — the exported script is always named `suite.js`; name it after the suite
- [ ] budget-units — GiB in the app, GB on the boards; use one unit consistently with the boards
- [ ] budget-over — no over-budget state can be reached (Suite / Start run / Budget)
- [ ] dialog-backdrop — check in a real browser whether a dialog's backdrop stops after the first screen when the page scrolls; fix if real
- [ ] suites-copy — remaining copy on these screens as on the boards

## P4 runs-results — runs list, live run, run result, compare

- [ ] runs-paging-text — "Showing 1–8 of 24" cannot be known under the paging contract (no total); show what the contract allows
- [ ] p95-headline — the run result headline's p95 is the slowest endpoint's, not the run's
- [x] delete-run-dialog — compact check and confirmation use the existing protected preview
- [ ] incomplete-target — the Incomplete results state still shows a Target runtime section
- [x] target-resize-reread — the same report stays ready across the phone breakpoint
- [ ] results-copy — headline and tile copy on Run result states as on the boards
- [ ] compare-copy — compare headline and rows are more verbose than the board
- [x] failed-result-header — Failed desktop results group the status, Run again, Export script and Pin. Compare, Download, Refresh and Delete are in More actions. Idle and Starting… are captured in both skins.
- [ ] live-download-menu — Live run / Download open: the board's menu is compact and in place; the app's is wider and shows selection details below the action bar

## P5 inputs-exports

- [~] inputs-detail — dedicated scoped page with file facts and usage; still missing: revisions grouped by suite, the file's folder, and Rename (needs an API)
- [ ] upload-dialog — Upload input is a plain form; the board is a dialog with a drop zone
- [~] upload-checking — fingerprint check and confirmed progress are visible in the existing form
- [~] upload-interrupted — confirmed bytes and explicit refresh-to-resume are visible while the draft is open
- [~] delete-input-in-use — definitive refusal now offers Close and still names the saved revisions; dialog styling remains
- [ ] export-rows — export rows have no secondary line (Exports)
- [ ] export-cancelled-invariant — a cancelled export with `cancellationRequested: false` makes the whole Exports list "unreadable response"; check whether the server can produce it. If it can, Backend and contract

## P6 session-settings

- [ ] session-copy — every session screen's copy as on the boards (Connecting, Signed out, Expired, Pair this browser, Pairing failed, Address not allowed, Can't reach Beetle)
- [ ] session-address — address box and loopback / remote distinction as on the boards
- [ ] session-countdown — "Checking again in 12 s" on Can't reach Beetle; expiry countdown where the boards show one
- [x] settings-workspace-tab — all known levels are reachable from either settings entry point
- [ ] settings-inherited — inherited value detail and Turn off button (Settings / Field states)
- [ ] settings-field-errors — one generic "Invalid value" banner; show the error on its field
- [x] settings-retention — Workspace retention preview and progress open on the batch screen. Expiry disables Apply and a stale apply removes nothing.
- [ ] settings-copy — remaining copy as on the boards

## P7 motion — `web/src/styles/tokens.css`, overlays and menus

The prototype uses a 220 ms dissolve for pages and panels and a 120 ms dissolve for small
menus and tooltips. Reduced motion already works and must keep working.

- [~] motion-page-duration — Page, Settings and Results report panels fade in at 220 ms. The outgoing page is removed immediately, so this is an entrance fade rather than the two-surface prototype dissolve.
- [x] motion-search — Search opens with a 220 ms fade and Escape still closes it immediately.
- [x] motion-download — Results and Live Download menus fade in at 120 ms.
- [x] motion-compare-picker — The Results Compare picker fades in at 220 ms.
- [x] motion-artifact-close — Artifact viewer closes with a 220 ms fade and restores focus. Reduced motion closes it immediately.

## Backend and contract — after the packages, one owner

- [ ] host-usage — agent CPU and memory use are always "not measured"; the board shows "62% of 8 CPUs" with bars
- [ ] live-rates — live requests a second and failed rate show "–" when not every endpoint is followed; needs a server-side total
- [ ] upgrade-draining — the upgrade status has no draining phase (board: Upgrade / States)
- [ ] plus anything the packages list here (refusal blockers, upload resume, export invariant)

## Not app changes

- Notes (Note / Live run vs Run result, Note / Run result vs Live run) and States / Controls are design pages.
- Sticky save bar half-way down full-page screenshots, and the running row's live figures on the runs list, come from how the screenshots are taken.
