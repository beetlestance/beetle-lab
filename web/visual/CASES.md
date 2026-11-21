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
- [x] retire-organization — Retire organization — newer board — D
- [x] retire-organization-refused — Overlay / Delete organization / Blocked + Retire organization / Refused — Active workspace names from the scoped API — D
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
- [x] suites-new-suite — Suites / New suite — both entry links show the engine picker — D
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

See [runs, results, inputs, exports and settings](CASES-runs.md) for sections 5–8.
