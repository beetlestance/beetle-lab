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

The functional sequence covers authoring, result and warning reads, content hashes,
comparison, inputs, settings, export, live reconnect, cancellation and deletion.
Runs request 8 MiB output, with a 45 s live case and 128 target requests per path.

The UI-adapted `run-results` profile passed all seven phases locally on ARM64
with six matching `322d2851` images and harness `dde0dee7` in 88.36 seconds.
Installation and browser cleanup were verified. This is not the twelve-phase
functional profile, configured-target comparison, visual acceptance or AMD64 proof.
Source checks cover scope/state binding and cleanup separately. Run
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

The `memory-pressure` profile serves up to 32 synthetic 32 MiB responses after
a small workload. It verifies Docker OOM at the 512 MiB engine limit, the
public result, and which report or chart evidence remained available.

The `output-pressure` profile exercises a bounded workload capped at 4,000
synthetic requests and 4 MiB of output. It binds the observed wrapper failure
to the submitted attempt and checks the terminal result and any retained history.

The `early-cancel` profile keeps the synthetic readiness endpoint unavailable.
It cancels after the engine makes a readiness request and verifies no workload
requests, no recovered checkpoint, and a cancelled result after the UI hand-off.

The `live-reconnect` profile runs only authoring and the bounded live lifecycle.
It pauses and resumes the feed, interrupts only the active metrics read, and
checks that the last figures stay visible until Retry now restores a real read.
It captures both states before reconnecting after reload and cancelling the run.

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

Axe reads only the current computed style, so app mode also hovers up to 24 visible
controls in `main` per page and checks their contrast. CI runs only the site scan; the
app scan needs a running installation and is run by hand.

Set `BEETLE_BROWSER_CHANNEL=chrome` to use an installed Chrome when Playwright's bundled
Chromium is not installed. Any violation exits 1.

`BEETLE_BROWSER_PROFILE=run-results` requires an explicit evidence directory and
covers authoring, a real run, report/metric verification and downloads, history
comparison, durable-result reconnect, active-metric reconnect/cancellation and
run deletion. It reports its own profile and seven completed phases. It does not
cover input/directory imports, folder deletion, settings or standalone exports;
a pass is never a full functional-profile pass. The default twelve-phase profile
continues to require those flows and preserves its own failures.

`BEETLE_BROWSER_PROFILE=network` qualifies private-network access (decision 032).
It requires an explicit evidence directory, `openssl` on the host, the local
`mcr.microsoft.com/playwright:v1.65.1-noble` image and the pinned driver installed
here; it ignores `BEETLE_BROWSER_WS_ENDPOINT`. The fixture sets `BEETLE_ACCESS=network`
and `BEETLE_ORIGIN=https://beetle.test:PORT`, moves the frontend to another loopback
port and adds two owned services: an nginx TLS proxy from the candidate frontend
image, aliased `beetle.test` on the ingress network with a throwaway self-signed
certificate, and a Playwright `run-server` on the same network. The browser uses
that origin with certificate errors ignored, and the run checks that it is still a
secure context with Web Crypto. Phases: authoring, secure context, a real run,
report/metric verification with content-hashed downloads, an input upload roundtrip,
active-metric (SSE) reconnect and cancellation, then raw requests through the proxy:
the exact origin opens a session, while a wrong `Host`, a wrong `Origin`, a missing
CSRF header and the loopback frontend port are each `403`. It does not cover a
browser-trusted certificate, another host's network path or more than one user.

`BEETLE_BROWSER_PROFILE=run-deletion` is a three-phase author/run/delete check with
explicit evidence. It checks the real scoped preview contains exactly that run
before applying, then waits for authoritative cleanup, acknowledges the batch and
confirms the run is gone after reload. Its pass covers deletion only; it does not
replace the run-results or full functional profiles.

`BEETLE_BROWSER_PROFILE=target-comparison` requires its own evidence directory.
It authors a declared-unit sampler revision, executes two 40-request runs and
opens their history comparison. Both target curves must retain heap zeroes as
MB and event-loop p99 as milliseconds; absent CPU/activity metrics stay unplotted.
The same assertions run after explicit Refresh comparison. Target counts must
stay at two readiness requests, 80 work requests and 12–64 sampler observations,
with no unexpected requests. This is six-phase functional coverage, not full
visual acceptance, variable-value/hover proof or target failure qualification.

Local ARM64 target evidence at six matching `322d2851` images:

| Profile | Harness | Completed | Duration | Cleanup |
| --- | --- | --- | --- | --- |
| `target-runtime` | `91c7f853` | 4 phases | 44.47 s | Installation and browser verified |
| `target-comparison` | `f94e79ae` | 6 phases | 67.51 s | Installation and browser verified |

These are private synthetic-fixture observations, not hosted evidence. They do
not qualify visual matching, target-failure comparison or another architecture.
