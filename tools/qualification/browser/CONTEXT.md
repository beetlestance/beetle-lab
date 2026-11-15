# Packaged browser acceptance

Owns an isolated Chromium context and the existing native Compose fixture.
It never opens a personal browser profile or a user's running installation.
Six explicit matching source images are mandatory; no build/pull is implicit.

`authoring.mjs` creates namespaces and immutable revisions through visible UI.
`results.mjs` submits runs and verifies terminal state, metrics and downloads.
`inputs-settings.mjs` checks input bytes, empty folder deletion and settings.
`exports.mjs` checks offline script publication and digest-verified download.
`acceptance.mjs` owns the sequence, private failure evidence and cleanup.

Dependencies are pinned in this directory's separate development-only lockfile;
root/runtime dependencies are unchanged. One browser/Compose lane, no retries.
Explicit Refresh/Reload buttons exercise user recovery, not hidden command retry.
Raw browser failures/body text remain private; only the closed outcome is shareable.
See README.md for installation, invocation and current coverage limitations.
