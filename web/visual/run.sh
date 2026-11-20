#!/bin/sh
# Builds the web app on the host, then renders screenshots in the pinned Playwright
# container so baselines match on every machine. Extra arguments go to `playwright test`,
# e.g. `web/visual/run.sh --update-snapshots` or `web/visual/run.sh specs/overview.visual.ts`.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"
if [ "${VISUAL_SKIP_BUILD:-0}" != 1 ]; then npx vite build --config web/vite.config.ts --logLevel warn; fi
[ -d web/visual/node_modules/@playwright/test ] || (cd web/visual && npm ci --no-audit --no-fund)
# A Git worktree may link its node_modules to the main checkout; mount the link targets too.
links=""
for dir in node_modules contracts/node_modules web/node_modules web/visual/node_modules; do
  if [ -L "$dir" ]; then links="$links -v $(cd "$dir" && pwd -P):/repo/$dir"; fi
done
# shellcheck disable=SC2086 # $links is a list of separate -v arguments.
exec docker run --rm --init --ipc=host \
  -v "$repo:/repo" $links -w /repo/web/visual \
  -e VISUAL_WORKERS -e CI \
  mcr.microsoft.com/playwright:v1.65.1-noble \
  npx playwright test "$@"
