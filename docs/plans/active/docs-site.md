# Plan: user documentation site follow-up

Status: active (2026-11-18). The user pages in `site/src/content/docs/` were
rewritten to the Penpot "Screens" design while the app is still being finished
in `web/`. Delete this plan once every item below is rechecked.

## Recheck after app UI lands

Each line is a UI statement in a user page that could not be confirmed in
`web/src` on `rewrite/integration` at `6dab957f`, or where the board and the code
disagree. Recheck against the merged app, then fix the page or the app.

| Page                                            | Statement to recheck                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| start/first-test.md                             | Creating an organization asks for a name and a "slug". Code labels it "Organization slug"; the "New organization" board calls it "Address"                                                                                                                                                                                                                            |
| start/first-test.md                             | Start run: the budget can be changed "for this run only". The board's link text "Change for this run" was not found in `StartRun.tsx`                                                                                                                                                                                                                                 |
| start/first-test.md                             | The "Matches this installation" note says `/docs` ships with the app. True for the frontend image, but the header's **Docs** item routes to `/reference`, and nothing in `web/src` links to `/docs`                                                                                                                                                                   |
| start/first-test.md, concepts/results.md        | Run result sections: only Summary, Thresholds and Script version are described. The board's Endpoints, Charts and Target runtime sections and its **Export script** button are not in the code (`runs/result/CONTEXT.md` says the API lacks the data)                                                                                                                 |
| concepts/runs.mdx                               | Runs tab: "pick a suite" filter; the board's "All suites" control label was not confirmed                                                                                                                                                                                                                                                                             |
| concepts/retention.md                           | "Open the retention controls": code has **Manage run retention** in workspace Settings; the board puts **Preview removal** beside the age row                                                                                                                                                                                                                         |
| concepts/retention.md                           | Single-run delete dialog: board has Frees, Checked at, **Keep run** and **Delete run**; code shows **Preview this run deletion**, then **Delete run XXXX**. The page stays generic                                                                                                                                                                                    |
| concepts/retention.md                           | The preview does not warn when pinned runs alone exceed a limit (board "Pinning / States" shows a warning). Update the page if the warning ships                                                                                                                                                                                                                      |
| concepts/retention.md                           | Runs list pin column (a toggle per row) from the board is not built; the page mentions only the **Pinned** filter and badge                                                                                                                                                                                                                                           |
| guides/suites-and-inputs.md                     | Add a sample file follows the code: `users.csv` 100 rows (`id`, `username`, `email`, `password`), `product-ids.csv` 500 rows (`product_id`), `order-body.json` 20 orders, uploaded to the workspace root, name field "Input name". The board shows 1,000 users with other columns, `sku, price`, a templated body, a Folder picker and "Must be unique in the folder" |
| guides/export-scripts.md                        | Exports from the app use a 1 MiB size limit and a 3-minute script time limit (`exports/prepare.ts` defaults). Confirm the shipped defaults and whether the dialog shows them                                                                                                                                                                                          |
| guides/export-scripts.md                        | Ready dialog text says "The download is checked against this SHA-256", but **Download script** is a plain link; the page tells users to check it themselves                                                                                                                                                                                                           |
| guides/upgrade.md, reference/troubleshooting.md | No upgrade screen exists ("Upgrade / States" board). How the app presents fenced refusals (`503 capacity_unavailable`) was not confirmed                                                                                                                                                                                                                              |
| concepts/workspaces.md                          | Organization page columns (suites, runs in 24 hours, right now, last run) and **Overview** showing the current workspace                                                                                                                                                                                                                                              |

## Decisions on the mismatches (2026-11-19)

| Item                               | Decision                                                                                                       | Owner               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| Retention after a pin change       | Keep the atomic refusal. Boards now say "preview expired; check again"; the page already describes the refusal | Done (boards, page) |
| Export Ready dialog SHA-256        | The app must verify the downloaded bytes before claiming it. Recheck the page's wording when that lands        | App                 |
| 3-minute export script limit       | Trace its source; a cap must not silently shorten an exported plan. Update the page with the outcome           | App                 |
| Docs entry in the app header       | Change the existing entry to `/docs`                                                                           | App                 |
| Rollback and old images            | The upgrade flow gives steps to restore the matching images. The upgrade guide lists the host steps today      | Upgrade work        |
| Settings completeness              | Later UI package                                                                                               | App                 |
| Stale board labels, copied buttons | Pinning and Upgrade notes updated, Inputs buttons removed from the Exports board                               | Done (boards)       |

## Site chrome status (lane A)

The site chrome, home and article styles follow the Penpot "Docs" boards
(Home, Guide, Concept, Reference, Phone / Guide). Skins come from
`site/src/styles/skins.css`, a subset of `web/src/styles/tokens.css`;
`npm run check:site-docs` fails when they drift. The `--doc-*` tokens (inline
code and illustration colours) are docs-only, and their Scarab values have no
board to check against.

CI job `ci/accessibility` (required by `ci/checks`) builds the site and runs
axe-core on every page in both skins and each diagram state
(`npm run check:a11y -- site`); text contrast below 4.5:1 fails it.

| Item                                                                    | State                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Header: tabs, Search ⌘K, "Open the app", Darkroom/Scarab radio switch   | Done. "Open the app" uses `DOCS_APP_URL`; it defaults to `/` and is hidden when the variable is set empty |
| Sidebar, breadcrumb/title/lede, "On this page" rail, previous/next      | Done                                                                                                      |
| Asides, tables, code blocks (language and Copy bar)                     | Done. Aside titles, ledes and backticked exit codes are page content, not chrome                          |
| Phone: Menu (focus kept inside, Escape closes), page bar, stacked cards | Done                                                                                                      |
| "Matches this installation" note (In-app board)                         | Not built: no page uses it yet                                                                            |
| Scarab `--doc-*` colours                                                | Recheck if the boards gain a Scarab frame                                                                 |
