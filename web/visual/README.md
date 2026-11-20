# Screenshot tests

Full-page screenshots of every screen and state of the web app, in both skins, at the
Penpot board sizes. The checklist of cases is [CASES.md](CASES.md).

## Run

```sh
web/visual/run.sh                          # build web/dist, compare against baselines
web/visual/run.sh --update-snapshots       # write new baselines
VISUAL_SKIP_BUILD=1 web/visual/run.sh specs/runs.visual.ts --project=darkroom
```

`run.sh` builds the app on the host, then runs Playwright inside the pinned
`mcr.microsoft.com/playwright:v1.65.1-noble` container, so fonts and antialiasing are
identical on every machine. Never update baselines outside the container. The HTML
report lands in `web/visual/dist/report/` (open `index.html`).

## How a case works

- `serve.mjs` serves `web/dist` with an SPA fallback. It never answers `/api/`.
- `harness.ts` gives every test an `api` fixture. Each API call is matched by method and
  path against `contracts/api/v2/http-operations.json` and answered by the handler set
  with `api.on('<operationName>', reply)`. A call without a handler fails the test.
  A reply is a JSON body, `{ status, body }`, a function of the call, or `'pending'`
  (never answered: loading states).
- The clock is fixed at `NOW` (2026-11-07 23:40 UTC), the time zone is UTC, motion is
  reduced, and the skin comes from the Playwright project (`darkroom`, `scarab`).
- `world/` holds the data the screens show. `world/index.ts` has the shared
  installation, organization and workspace (`signedIn(api)`); each family adds its own
  module (`world/runs.ts`, …) built from the contract fixtures in
  `contracts/fixtures/api/valid`. Fixture data must satisfy the API contract: the app
  validates every reply and would show an error state instead.
- `shoot(page, path, name, { viewports })` opens a route and captures
  `<name>-<viewport>.png` per viewport. For states reached by clicking or typing, act on
  the page and call `capture(page, name)`.

Baselines live in `baselines/<skin>/<spec>/`. A changed screenshot is a review item:
look at the diff in the report before accepting it with `--update-snapshots`.
- `node web/visual/gallery.mjs <board-export-dir>` builds `web/visual/dist/gallery/index.html`: each screenshot beside its Penpot board.
