# Packaged browser functional acceptance

This is functional acceptance of explicit candidate images, not the UI redesign.
Use synthetic data only. Start from the repository root with Docker available.
The fixture creates its own home, project, target and loopback port and verifies
cleanup; it never selects the normal user's installation.

Install the pinned browser tools and matching headless browser locally:

```sh
npm ci --prefix tools/qualification/browser --ignore-scripts
npm run check --prefix tools/qualification/browser
npm run test:cleanup --prefix tools/qualification/browser
PLAYWRIGHT_BROWSERS_PATH="$PWD/.agent-work/browser-binaries" \
  node tools/qualification/browser/node_modules/playwright/cli.js install chromium --only-shell
```

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
Each small run requests 8MiB output; the one-VU live case is capped at 45 seconds.
The synthetic target permits at most 128 requests per path. This does not qualify
maximum load or resource enforcement. A full passing outcome is required; separate
feature probes do not establish that this entire sequence passed.

Current evidence: candidate `5ee8d12` passed the first eleven phases in a normal
ARM64 run, but run deletion did not complete within 60 seconds. Mounted private
diagnostic builds completed the sequence; they do not establish a normal pass.
The deletion/settlement handoff remains under investigation. Do not interpret
this harness being available as complete browser qualification.
