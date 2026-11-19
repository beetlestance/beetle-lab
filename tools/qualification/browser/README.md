# Packaged browser functional acceptance

This is functional acceptance of explicit candidate images, not the UI redesign.
Use synthetic data only. Start from the repository root with Docker available.
The fixture creates its own home, project, target and loopback port and verifies
cleanup; it never selects the normal user's installation.

Install the pinned driver tools; a container browser avoids a host browser install:

```sh
npm ci --prefix tools/qualification/browser --ignore-scripts
npm run check --prefix tools/qualification/browser
npm run test:cleanup --prefix tools/qualification/browser
```

For a container browser, run a matching-version Playwright `run-server` in a
separate browser container, publishing its WebSocket port to loopback only. Set
`BEETLE_BROWSER_WS_ENDPOINT=ws://127.0.0.1:PORT/OPAQUE_PATH` on the acceptance command.
Client/server major and minor versions must match the pinned driver. The client
exposes only the owned installation's loopback port to that browser; app Host,
Origin and session rules remain unchanged. Fresh contexts and the normal cleanup
still apply. Remote downloads use `saveAs`; uploads are transferred by Playwright.
The caller owns and stops the separate browser container after acceptance. See
[Playwright remote connections](https://playwright.dev/docs/api/class-browsertype#browser-type-connect).

Without that variable, install the matching host browser with
`PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent-work/browser-binaries" node tools/qualification/browser/node_modules/playwright/cli.js install chromium --only-shell`.

On Linux install the documented Playwright system dependencies separately; this
script does not install global packages or change the host. Then supply the exact
six candidate image references in frontend/backend/agent/installer/engine/export order:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent-work/browser-binaries" \
  npm test --prefix tools/qualification/browser -- \
  FRONTEND BACKEND AGENT INSTALLER ENGINE EXPORT
```

Run from the repository root; references must already exist in the explicit
Docker default context. All six must have matching revision and native platform.
Do not substitute mutable images after a pass or treat a mounted diagnostic build
as normal candidate qualification. Native AMD64 and ARM64 proofs remain separate.

The run prints a closed result and owned evidence directory. Private error/body
files may contain session or configuration details and must not be uploaded.
A successful result requires browser closure plus verified installation cleanup.
Screenshots and private transcripts are not required for a pass. Reload buttons
are tested explicitly where available; no mutation is retried automatically.

The sequence covers automatic access, authoring, run/result/report/warning reads,
metrics, content hashes, history comparison, input roundtrip and directory import,
settings, offline export, live reconnect/cancellation and explicit run/folder deletion.
Each small run requests 8 MiB output; the one-VU live case is capped at 45 seconds.
The synthetic target permits at most 128 requests per path. This does not qualify
maximum load or resource enforcement. A full passing outcome is required; separate
feature probes do not establish that this entire sequence passed.

The UI-adapted harness has not yet completed a current-image run. Its source checks
cover scope/state binding and cleanup; they do not qualify installed images. Run
submission captures the suite/workspace and selected revision before accepting the
202 response, checks the exact 8 MiB budget, and binds later UI/API reads to it.
The `test:cleanup` command also runs these state-boundary tests.

Historical evidence before the UI redesign: unmodified candidate `5ee8d12` completed all twelve phases on
ARM64 in a private timed run, with verified cleanup. Deletion took 79 seconds,
exceeding the original browser wait of 60 seconds. The harness now allows up to
180 seconds for deletion, retaining every settlement, acknowledgment and 404
assertion. Product deadlines and resource limits are unchanged. This latency is
an observed limitation, not a performance target. The final normal harness passed all twelve phases with
verified cleanup on `5ee8d12` ARM64. It used restored, hash-verified CI images;
AMD64 browser execution remains separate from its accepted native API proof.

The separate `BEETLE_BROWSER_PROFILE=interaction` profile reuses authoring but
runs only the remaining keyboard/appearance/scope checks. Set that environment
variable and `BEETLE_BROWSER_EVIDENCE=ABSENT_ABSOLUTE_DIRECTORY` on the same
explicit-image command above. Ownership is saved before Compose and the
installation identity before authoring, so the existing native `cold/cleanup.ts`
can independently clean exact owned resources after interruption. It tests skip-to-content,
command shortcut/focus trapping/Escape/navigation, persistent Darkroom/Scarab
preferences, reduced motion, controls at 375/768/1440px, and real wrong-organisation
404/cache isolation through visible navigation. It creates no performance runs.
This is a finite functional matrix, not a complete accessibility certification.
Keep it outside any exclusive resource measurement window. The default profile
continues to require the original twelve functional phases.

The optional `BEETLE_BROWSER_PROFILE=reference` requires its own evidence directory
and checks visible filtering/operation/schema navigation, all four browser downloads
against exact shipped frontend file hashes/sizes, HEAD MIME/length/nosniff, missing
asset404 and static POST405. It verifies an implemented settings GET, the skill's
MIT and retired-shell notices, zero page-issued API operations during reference
navigation, and zero performance target work. It is not an agent-model integration.

`BEETLE_BROWSER_PROFILE=target-runtime` with an absolute
`BEETLE_BROWSER_EVIDENCE` selects only target-report view acceptance. It authors
a sampler revision and checks zeros, known/null values, phase rows and visible
manual Reload/reconnect; it does not assert automatic initial availability.

## Accessibility scan

`a11y.mjs` runs axe-core (WCAG 2.1 A and AA rules, contrast included) in a real browser.
Static JSX rules are in the root ESLint config (`eslint-plugin-jsx-a11y-x`, strict, on
`web/src`); this scan covers what only the rendered page shows.

```sh
(cd site && npm run build)
npm run check:a11y -- site                         # docs site, both skins, each diagram state
npm run check:a11y -- app http://127.0.0.1:4567    # a running installation, same-origin pages
```

Set `BEETLE_BROWSER_CHANNEL=chrome` to use an installed Chrome when Playwright's bundled
Chromium is not installed. Any violation exits 1.

`BEETLE_BROWSER_PROFILE=run-results` requires an explicit evidence directory and
covers authoring, a real run, report/metric verification and downloads, history
comparison, durable-result reconnect, active-metric reconnect/cancellation and
run deletion. It reports its own profile and seven completed phases. It does not
cover input/directory imports, folder deletion, settings or standalone exports;
a pass is never a full functional-profile pass. The default twelve-phase profile
continues to require those flows and preserves its own failures.

`BEETLE_BROWSER_PROFILE=run-deletion` is a three-phase author/run/delete check with
explicit evidence. It checks the real scoped preview contains exactly that run
before applying, then waits for authoritative cleanup, acknowledges the batch and
confirms the run is gone after reload. Its pass covers deletion only; it does not
replace the run-results or full functional profiles.
