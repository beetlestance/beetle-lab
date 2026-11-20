# Fixes from the screenshot review

Every finding from the screenshot suite (CASES.md) that needs a change in the app. The Penpot
boards are the spec: where the app and a board differ, the app changes, unless the board
shows data the API cannot provide (those go to Backend and contract below).

Status: `[ ]` open, `[x]` fixed and screenshot re-checked against the board, `[~]` partly
fixed (note says what is left), `[-]` not changed (note says why).

Each package is one branch (`fix/<package>`) with its own files. Board PNGs are named by
slug (`Run result / Failed` → `run-result-failed.png`).

## P1 overview-shell — `web/src/features/workspace-overview`, `organization-overview`, app shell

- [ ] org-overview-tab — Overview at organization level shows the dashboard from `getOrganizationOverview` (live card, Last 24 hours, Recent runs linking to each run's workspace, counts); the workspace table, Create, Rename, Delete and paging stay only on Workspaces
- [ ] org-overview-states — Empty ("Write your first suite"), Loading and Search for the organization dashboard; Organization / Empty board
- [ ] overview-blank-space — about 700px of empty page below the overview content (page 1873px tall, content ends near 1204px)
- [ ] overview-width — ultrawide: hero capped at 820px while the lower row stretches; contain the page so everything aligns (Ultrawide / Overview)
- [ ] overview-refresh-line — "As of 19:21. Refresh overview" is not on the board
- [ ] overview-section-tabs — workspace section tabs above the hero are not on the board
- [ ] overview-copy — headline, summary line, "Local agent" title and status line as on the board
- [ ] phone-live-card — phone: the live card's progress marker overlaps its label (Phone / Overview)
- [ ] phone-menu-sign-out — phone: "Sign out" is cut off in the open menu (Phone / Menu open)
- [ ] phone-org-table — phone: organization table actions run off the screen
- [ ] connection-lost — losing the connection replaces the page with an error; the board keeps the last data with a banner (State / Connection lost)
- [ ] nav-highlight — run pages highlight "Workspaces"; match the boards' nav state

## P2 namespaces — organization, workspace and folder dialogs

- [ ] folder-menu-delete — clicking Delete in a folder's ⋯ menu with the mouse does nothing (keyboard works)
- [ ] create-dialogs — New folder, New workspace, New organization: titles, labels, character counter and address derived from the name, as on the boards
- [ ] workspace-name-taken — name taken is shown inline on the field, as New folder / Name taken does
- [ ] suite-rename — Rename suite with `patchSuite`, plus Changed elsewhere (Overlay / Rename, Overlay / Rename / Changed elsewhere, Phone / Rename)
- [ ] delete-organization-blocked — Delete organization can be opened and shows its Blocked state (Overlay / Delete organization / Blocked)
- [ ] refusal-blockers — refusal dialogs show only "Version or intent conflict"; show what blocks the action as the boards do (Delete workspace / Blocked, Delete folder / Not empty, Retire … / Refused). If the API reply has no blocker detail, list it under Backend and contract
- [ ] namespace-copy — remaining copy on these dialogs as on the boards

## P3 suites — suites list, suite page, editor, script, start run

- [ ] folder-count — a folder's count leaves out suites in its subfolders
- [ ] new-suite-picker — `?new=form` and `?new=json` open the same name dialog; the board shows the engine picker first (Suites / New suite, Overlay / Engine picker)
- [ ] sample-file-folder — Add a sample file has no folder choice
- [ ] export-file-name — the exported script is always named `suite.js`; name it after the suite
- [ ] budget-units — GiB in the app, GB on the boards; use one unit consistently with the boards
- [ ] budget-over — no over-budget state can be reached (Suite / Start run / Budget)
- [ ] dialog-backdrop — check in a real browser whether a dialog's backdrop stops after the first screen when the page scrolls; fix if real
- [ ] suites-copy — remaining copy on these screens as on the boards

## P4 runs-results — runs list, live run, run result, compare

- [ ] runs-paging-text — "Showing 1–8 of 24" cannot be known under the paging contract (no total); show what the contract allows
- [ ] p95-headline — the run result headline's p95 is the slowest endpoint's, not the run's
- [ ] delete-run-dialog — Delete run uses the generic retention preview; the board is Keep run / Delete run from `previewRunDeletion`, plus Pinned (Overlay / Delete run, Overlay / Delete run / Pinned)
- [ ] incomplete-target — the Incomplete results state still shows a Target runtime section
- [ ] target-resize-reread — resizing the window re-reads the target report and flashes "Reading verified target observations…"
- [ ] results-copy — headline and tile copy on Run result states as on the boards
- [ ] compare-copy — compare headline and rows are more verbose than the board

## P5 inputs-exports

- [ ] inputs-detail — Inputs / Detail page from `getInput`, `getInputColumns`, `listInputUsage`
- [ ] upload-dialog — Upload input is a plain form; the board is a dialog with a drop zone
- [ ] upload-checking — no Checking step (Overlay / Upload input / Checking)
- [ ] upload-interrupted — Interrupted offers Refresh / Discard, the board offers Resume; resume if the transfer protocol allows it, else Backend and contract
- [ ] delete-input-in-use — buttons read "Clear rejected deletion" / "Replay identical deletion"; match Overlay / Delete input / In use
- [ ] export-rows — export rows have no secondary line (Exports)
- [ ] export-cancelled-invariant — a cancelled export with `cancellationRequested: false` makes the whole Exports list "unreadable response"; check whether the server can produce it. If it can, Backend and contract

## P6 session-settings

- [ ] session-copy — every session screen's copy as on the boards (Connecting, Signed out, Expired, Pair this browser, Pairing failed, Address not allowed, Can't reach Beetle)
- [ ] session-address — address box and loopback / remote distinction as on the boards
- [ ] session-countdown — "Checking again in 12 s" on Can't reach Beetle; expiry countdown where the boards show one
- [ ] settings-workspace-tab — Settings has only Installation and Organization; add Workspace (`getWorkspaceSettings`, `patchWorkspaceSettings`)
- [ ] settings-inherited — inherited value detail and Turn off button (Settings / Field states)
- [ ] settings-field-errors — one generic "Invalid value" banner; show the error on its field
- [ ] settings-retention — retention preview and progress as on Settings / Workspace / Retention preview and Retention progress
- [ ] settings-copy — remaining copy as on the boards

## Backend and contract — after the packages, one owner

- [ ] host-usage — agent CPU and memory use are always "not measured"; the board shows "62% of 8 CPUs" with bars
- [ ] live-rates — live requests a second and failed rate show "–" when not every endpoint is followed; needs a server-side total
- [ ] upgrade-draining — the upgrade status has no draining phase (board: Upgrade / States)
- [ ] plus anything the packages list here (refusal blockers, upload resume, export invariant)

## Not app changes

- Notes (Note / Live run vs Run result, Note / Run result vs Live run) and States / Controls are design pages.
- Sticky save bar half-way down full-page screenshots, and the running row's live figures on the runs list, come from how the screenshots are taken.
