# Packaged browser acceptance

Owns an isolated Chromium context and the existing native Compose fixture.
It never opens a personal browser profile or a user's running installation.
Six explicit matching source images are mandatory; no build/pull is implicit.

`authoring.mjs` creates namespaces and immutable revisions through visible UI.
`results.mjs` submits runs and verifies terminal state, metrics and downloads.
`run-state.mjs` binds submission/reads to the selected suite, revision and origin;
its scope-guard regressions run with cleanup tests. New UI harness awaits native proof.
`inputs-settings.mjs` checks input bytes, empty folder deletion and settings.
`exports.mjs` checks offline script publication and digest-verified download.
`acceptance.mjs` owns the sequence, private failure evidence and cleanup.

Dependencies are pinned in this directory's separate development-only lockfile;
root/runtime dependencies are unchanged. One browser/Compose lane, no retries.
Explicit Refresh/Reload buttons exercise user recovery, not hidden command retry.
Raw browser failures/body text remain private; only the closed outcome is shareable.
See README.md for installation, invocation and current coverage limitations.

Optional target-runtime profile authors the sampler config through the JSON UI,
executes one40-request owned test and checks actual zero/known/null comparisons,
phase/reason rows, scope label, reload/reconnect and absence of thermal fields.
It leaves functional/interaction/reference defaults unchanged and needs explicit
private evidence output. Backend artifact/hash contract has separate native proof.
