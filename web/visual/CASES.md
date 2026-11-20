# Screenshot cases

Every screen, state and flow the app has, one line per case. A case is done when its
spec captures it in both skins (the `darkroom` and `scarab` projects) and the baseline
has been looked at. `Board` names the Penpot board it should match; `—` means the app
has the state but no board draws it (still captured, so a reviewer sees it).

Viewports: `D` desktop 1440, `P` phone 390, `T` tablet 834, `U` ultrawide 2560.
Overlays and menus are captured with the page behind them at the viewport size.

Status: `[ ]` not written, `[x]` captured and looked at, `[!]` captured but the app is
missing the state or renders it wrongly (note says what; this is a finding, not a skip).

## 1. Session and connection — `specs/session.visual.ts`

- [x] session-connecting — Session / Connecting — session read pending — D P
- [x] session-signed-out — Session / Signed out — session 401 unpaired, loopback — D P
- [x] session-pair-this-browser — Session / Pair this browser — remote address, pairing form — D P
- [x] session-pairing-failed — Session / Pairing failed — pair POST refused — D
- [x] session-expired — Session / Expired — session expired while signed in — D
- [x] session-address-not-allowed — Session / Address not allowed — forbidden origin — D
- [x] session-cant-reach — Session / Can’t reach Beetle — session read transport failure — D P
- [x] connection-lost — State / Connection lost — signed in, then API stops answering — D P
- [x] connection-lost-never-loaded — — — nothing loaded yet variant — D
- [x] upgrade-paused — Upgrade / States — a request refused `upgrade_pending` → paused banner — D
- [x] upgrade-settings-open — Upgrade / States — `/settings?view=upgrade`, phase open — D
- [x] upgrade-settings-fenced — Upgrade / States — phase fenced — D
- [!] upgrade-settings-draining — Upgrade / States — contract has no draining phase; open + unfinished work captured; board is "Planned / Not built" — D

## 2. Shell, overview and navigation — `specs/overview/`

- [x] overview — Overview — workspace dashboard, populated (one run active) — D P T U
- [x] overview-idle — — — workspace dashboard, nothing running — D
- [x] overview-empty — Overview / Empty — new workspace, no suites or runs — D P
- [x] overview-loading — Overview / Loading — overview read pending — D
- [x] overview-error — — — overview read fails — D
- [x] overview-search — Overview / Search — search typed in overview — D
- [x] organization — Organization — org overview, three workspaces — D P U
- [!] organization-empty — Organization / Empty — no board-style empty page; closest state + organization-empty-no-workspaces — D
- [x] organization-empty-no-workspaces — — — org with no workspaces — D
- [x] organization-loading — Organization / Loading — pending — D
- [x] organization-first-run — Organization / First run — newer board; installation's first org — D
- [x] organizations-home — — — `/` with several orgs — D P
- [x] workspaces — — — `/workspaces` and `/organizations/:id/workspaces` — D P
- [x] workspaces-redirect — — — `/workspaces` redirects into the org — D P
- [x] scope-menu — Scope menu (component) — scope switcher open, two orgs — D
- [x] scope-menu-many — Organization / Menu / More than 20 — newer board — D
- [x] scope-menu-many-more — Organization / Menu / More than 20 — after Show more — D
- [x] phone-menu-open — Phone / Menu open — phone nav menu open — P
- [x] search-overlay — Overlay / Search — ⌘K open with results — D P
- [x] search-overlay-empty — — — no query — D
- [x] search-overlay-no-match — — — no match — D
- [x] engines — Engines — engine catalogue — D P
- [x] engines-unavailable — Engines / Unavailable — catalogue unavailable — D
- [x] not-found-organization — Not found / Organization — unknown org id — D
- [x] not-found-workspace — — — unknown workspace id — D
- [x] invalid-route — — — unknown path — D
- [x] reference — — — `/reference` page — D
- [x] unavailable-note — Unavailable note — shown inside any page with a not-measured value — D
- [!] states-controls — States / Controls — no such page in the app; not captured — D

## 3. Organizations, workspaces, folders: dialogs — `specs/namespaces/`

- [x] new-organization — Overlay / New organization — D P
- [x] new-organization-address-taken — Overlay / New organization / Address taken — D
- [x] new-workspace — Overlay / New workspace — D
- [x] new-workspace-name-taken — — — D
- [!] rename — Overlay / Rename — board is Rename suite; app has no suite rename, Rename workspace captured — D
- [x] rename-changed-elsewhere — Overlay / Rename / Changed elsewhere — D
- [x] phone-rename — Phone / Rename — P
- [x] delete-workspace — Overlay / Delete workspace — D
- [x] delete-workspace-blocked — Overlay / Delete workspace / Blocked — D
- [x] retire-workspace — Retire workspace — D
- [x] retire-workspace-refused — Retire workspace / Refused — D
- [x] phone-retire-workspace — Phone / Retire workspace — P
- [!] delete-organization-blocked — Overlay / Delete organization / Blocked — unreachable: org delete mode is never opened; not captured — D
- [x] retire-organization — Retire organization — newer board — D
- [x] retire-organization-refused — Retire organization / Refused — D
- [x] new-folder — Overlay / New folder — D
- [x] new-folder-name-taken — Overlay / New folder / Name taken — D
- [x] new-folder-too-deep — Overlay / New folder / Too deep — D
- [x] delete-folder-not-empty — Overlay / Delete folder / Not empty — D
- [x] delete-folder — — — empty folder — D

## 4. Suites and scripts — `specs/suites/`

- [x] suites — Suites — workspace root, folders and suites — D P
- [x] suites-empty — Suites / Empty — D
- [x] suites-loading — Suites / Loading — D
- [x] suites-folder — Suites / Folder — inside a folder — D
- [x] suites-folder-empty — Suites / Folder / Empty — D
- [x] suites-folder-no-match — Suites / Folder / No match — filter with no match — D
- [!] suites-new-suite — Suites / New suite — ?new=form/json show the same name dialog, not the engine picker — D
- [x] suites-new-suite-json — — — `?new=json` — D
- [x] add-sample-file — Add a sample file — D
- [x] add-sample-file-name-taken — Add a sample file / Name taken — D
- [x] suite-overview — Suite / Overview — D P
- [x] suite-revisions — Suite / Revisions — D
- [x] suite-edit — Suite / Edit — form view — D T
- [x] suite-edit-request — Suite / Edit / Request — `&request=` open — D
- [x] suite-edit-run-setup — Suite / Edit / Run setup — D
- [x] suite-edit-json — Suite / Edit / JSON — D
- [x] save-revision — Panel / Save revision — D
- [x] save-revision-errors — Panel / Save revision / Errors — D
- [x] save-conflict — Overlay / Save conflict — D
- [x] engine-picker — Overlay / Engine picker — D
- [x] suite-start-run — Suite / Start run — `&start=1` — D P
- [!] suite-start-run-budget — Suite / Start run / Budget — board's 6 GB is under the 8 GiB limit; no over-budget state reachable — D
- [x] script — Script / revision 1 — D
- [x] script-changes — Script / revision 1 / Changes — D
- [x] script-changes-one-column — Script / revision 1 / Changes / One column — D
- [x] export-script-preparing — Overlay / Export script / Preparing — D
- [x] export-script-ready — Overlay / Export script / Ready — D
- [x] export-script-unknown — Overlay / Export script / Unknown — D
- [x] export-script-uses-secrets — Overlay / Export script / Uses secrets — D
- [x] not-found-suite — Not found / Suite — D
- [x] not-found-script — Not found / Script — D

## 5. Runs and live run — `specs/runs/`

- [x] runs — Runs — list with mixed outcomes — D P
- [x] runs-pinned — — — `?pinned=true` — D
- [x] runs-empty — Runs / Empty — D
- [x] runs-loading — Runs / Loading — D
- [x] pinning-states — Pinning / States — pin, pinned, pin limit reached — D
- [x] pinning-states-pending — Pinning / States — pin request in flight — D
- [x] pinning-states-unreachable — Pinning / States — pin request fails (500) — D
- [!] delete-run — Overlay / Delete run — app shows generic retention preview, not Keep/Delete dialog — D
- [x] delete-run-pinned — Overlay / Delete run / Pinned — D
- [x] live-run — Live run — active run with live metrics — D P U
- [x] live-run-starting — Live run / Starting — D
- [x] live-run-waiting-for-capacity — Live run / Waiting for capacity — queue read — D
- [x] live-run-paused — Live run / Paused — D
- [x] live-run-reconnecting — Live run / Reconnecting — D
- [x] live-run-cancelling — Live run / Cancelling — D
- [x] live-run-finalizing — Live run / Finalizing — D
- [x] live-run-compare-tooltip — Live run / Compare tooltip — hover — D
- [x] live-run-download-open — Live run / Download open — D
- [x] live-run-script-picker — Live run / Script picker — D
- [x] live-run-ticks-01 — Live run / Animated 01 — live poll tick 1 — D
- [x] live-run-ticks-02 — Live run / Animated 02 — live poll tick 2 — D
- [x] live-run-ticks-03 — Live run / Animated 03 — live poll tick 3 — D
- [x] live-run-ticks-04 — Live run / Animated 04 — live poll tick 4 — D
- [x] live-run-ticks-05 — Live run / Animated 05 — live poll tick 5 — D
- [x] live-run-ticks-06 — Live run / Animated 06 — live poll tick 6 — D
- [x] live-run-ticks-07 — Live run / Animated 07 — live poll tick 7 — D
- [x] live-run-ticks-08 — Live run / Animated 08 — live poll tick 8 — D
- [!] note-live-vs-result — Note / Live run vs Run result — board is design commentary; no such note in the app; not captured — D
- [x] not-found-run — Not found / Run — D

## 6. Run result and comparison — `specs/results/`

- [x] run-result — Run result — passed run — D P
- [x] run-result-failed — Run result / Failed — D
- [x] run-result-failed-run-again — Run result / Failed / Run again — Run again clicked, start pending ("Starting…") — D
- [x] run-result-cancelled — Run result / Cancelled — D
- [x] run-result-out-of-memory — Run result / Out of memory — D
- [x] run-result-output-full — Run result / Output full — D
- [x] run-result-incomplete — Run result / Incomplete results — D
- [x] run-result-restored-history — Run result / Restored history — D
- [x] run-result-target-by-phase — Run result / Target by phase — D
- [x] run-result-what-happened — Run result / What happened — D
- [x] run-result-diagnostics — Run result / Diagnostics — D
- [x] run-result-diagnostics-log — Run result / Diagnostics — sanitized log opened — D
- [x] run-result-artifacts — Run result / Artifacts — D
- [x] run-result-artifact-viewer — Run result / Artifact viewer + Overlay / Artifact viewer — D
- [x] run-result-notes — Run result / Notes — note editing — D
- [x] run-result-notes-saving — Run result / Notes — saving — D
- [x] run-result-notes-conflict — Run result / Notes — changed elsewhere — D
- [x] run-result-download-open — Run result / Download open — D
- [x] run-result-compare-picker — Run result / Compare picker — D
- [x] run-result-toast — Run result / Toast — after an action — D
- [x] run-result-pending — — — result not ready yet — D
- [x] compare — Compare — two runs — D P
- [x] compare-empty — Compare / Empty — D
- [x] compare-metric-not-recorded — — — a metric absent on one side — D
- [x] export-run-preparing — Overlay / Export run / Preparing — Export script… on a run result, job generating — D
- [!] note-result-vs-live — Note / Run result vs Live run — board is design commentary; not captured — D

## 7. Inputs and exports — `specs/inputs/`

- [x] inputs — Inputs — D P
- [x] inputs-empty — Inputs / Empty — D
- [!] inputs-detail — Inputs / Detail — no detail page; inline status panel, no columns — D
- [x] upload-input — Overlay / Upload input — D
- [x] upload-input-uploading — Overlay / Upload input / Uploading — D
- [x] upload-input-publishing — Overlay / Upload input / Publishing — D
- [x] upload-input-published — Overlay / Upload input / Published — D
- [x] upload-input-chosen — — — file chosen, ready to send — D
- [!] upload-input-checking — Overlay / Upload input / Checking — no checking screen; busy state shown — D
- [x] upload-input-failed — Overlay / Upload input / Failed — D
- [x] upload-input-too-large — Overlay / Upload input / Too large — D
- [!] upload-input-interrupted — Overlay / Upload input / Interrupted — app shows refresh/discard, no Resume — D
- [x] phone-upload-input — Phone / Upload input — P
- [x] delete-input-in-use — Overlay / Delete input / In use — D
- [x] exports — Exports — job list, mixed states — D P
- [x] exports-empty — — — D

## 8. Settings — `specs/settings.visual.ts`, `specs/settings-states.visual.ts`

- [x] settings — Settings — `/settings` — D P
- [x] settings-loading — Settings / Loading — D
- [x] settings-installation — Settings / Installation — D
- [x] settings-installation-capacity — Settings / Installation / Capacity — D
- [x] settings-organization — — — `/organizations/:id/settings` — D
- [x] settings-organization-manage — Settings / Organization / Manage — newer board — D
- [x] settings-workspace — Settings / Workspace — D
- [x] settings-workspace-retention-preview — Settings / Workspace / Retention preview — D
- [x] settings-workspace-retention-progress — Settings / Workspace / Retention progress — D
- [x] settings-field-states — Settings / Field states — invalid/override/inherited fields — D
- [x] settings-field-states-couldnt-save — Settings / Field states — save refused — D
- [x] settings-field-states-saved — Settings / Field states — saved — D
- [x] settings-changed-elsewhere — Settings / Changed elsewhere — save conflict — D
