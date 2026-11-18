# Plan: user documentation site follow-up

Status: active (2026-11-18). The user pages in `site/src/content/docs/` were
rewritten to the Penpot "Screens" design while the app is still being finished
in `web/`. Delete this plan once every item below is rechecked.

## Recheck after app UI lands

Each line is a UI statement in a user page that could not be confirmed in
`web/src` on `rewrite/integration` at `6dab957f`, or where the board and the code
disagree. Recheck against the merged app, then fix the page or the app.

| Page | Statement to recheck |
| --- | --- |
| start/first-test.md | Creating an organization asks for a name and a "slug". Code labels it "Organization slug"; the "New organization" board calls it "Address" |
| start/first-test.md | Start run: the budget can be changed "for this run only". The board's link text "Change for this run" was not found in `StartRun.tsx` |
| start/first-test.md | The "Matches this installation" note says `/docs` ships with the app. True for the frontend image, but the header's **Docs** item routes to `/reference`, and nothing in `web/src` links to `/docs` |
| start/first-test.md, concepts/results.md | Run result sections: only Summary, Thresholds and Script version are described. The board's Endpoints, Charts and Target runtime sections and its **Export script** button are not in the code (`runs/result/CONTEXT.md` says the API lacks the data) |
| concepts/runs.mdx | Runs tab: "pick a suite" filter; the board's "All suites" control label was not confirmed |
| concepts/retention.md | "Open the retention controls": code has **Manage run retention** in workspace Settings; the board puts **Preview removal** beside the age row |
| concepts/retention.md | Single-run delete dialog: board has Frees, Checked at, **Keep run** and **Delete run**; code shows **Preview this run deletion**, then **Delete run XXXX**. The page stays generic |
| concepts/retention.md | The preview does not warn when pinned runs alone exceed a limit (board "Pinning / States" shows a warning). Update the page if the warning ships |
| concepts/retention.md | Runs list pin column (a toggle per row) from the board is not built; the page mentions only the **Pinned** filter and badge |
| guides/suites-and-inputs.md | Add a sample file follows the code: `users.csv` 100 rows (`id`, `username`, `email`, `password`), `product-ids.csv` 500 rows (`product_id`), `order-body.json` 20 orders, uploaded to the workspace root, name field "Input name". The board shows 1,000 users with other columns, `sku, price`, a templated body, a Folder picker and "Must be unique in the folder" |
| guides/export-scripts.md | Exports from the app use a 1 MiB size limit and a 3-minute script time limit (`exports/prepare.ts` defaults). Confirm the shipped defaults and whether the dialog shows them |
| guides/export-scripts.md | Ready dialog text says "The download is checked against this SHA-256", but **Download script** is a plain link; the page tells users to check it themselves |
| guides/upgrade.md, reference/troubleshooting.md | No upgrade screen exists ("Upgrade / States" board). How the app presents fenced refusals (`503 capacity_unavailable`) was not confirmed |
| concepts/workspaces.md | Organization page columns (suites, runs in 24 hours, right now, last run) and **Overview** showing the current workspace |
