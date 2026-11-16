# Resource observation evidence

Recorded: 2026-11-09. Integrated source: `9a25016`.
Gate executed 2026-11-08 on Node26.7.0/macOS arm64.

## Implemented boundary

ResourceObserver samples one original at a time through an opaque verified staging
root and read-only Docker version/info. Root identity is checked before/after bigint
statfs; available bytes use unprivileged available blocks, not total free blocks,
following the [Node filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html#statfsbavail).
The helper retains issued filesystem promises through cancellation and drain.

Docker replies are bounded/captured before observation. Existing API/kernel/control
support checks are reused, and daemon identity must match the verified installation.
CPU/RAM are daemon/VM totals; they are not idle CPU, free memory or temperature.
Aggregate PID/output/staging ceilings are explicitly configured policy, including
reserve/headroom before effective-pool subtraction. Physical aggregate PID capacity
remains unknown. No timeout/output guards or optional sensor facts are manufactured.

The observer owns one original sample and no backlog. Abort/deadline/close retain
that original until settlement; operational failure produces unknown. Beginning
timestamps prevent late reads being restamped fresh; wall rollback cannot publish
known evidence. Shared transport sockets retain their separate owner and lifetime.

Admission validates provenance on writes and stored reads. Journal reopen clears
samples/guard readiness while preserving configuration, clocks, queue and charged
ownership. New full samples revoke omitted guards. Identical timestamp replay is
ignored; conflicting equal-millisecond samples invalidate readiness, and only a
strictly newer sample may restore it. No schema migration was needed.

## Independent review

The evidence review independently exercised real SQLite/Store reset, ownership
preservation, guard revocation, invalid-sample replacement and accessor rejection.
The observer review used actual verified roots/filesystem and controlled transport
promises, plus the actual admission Store and SQLite boundary.

Review reproduced failed/foreign samples discarded on timestamp ties, preserving
fresh old guards. It also reproduced a zero-disk tied sample preserving inflated
capacity. The canonical conflict rule now covers unknown, omitted/reduced guards,
zero disk, reduced CPU, removed controls and changed idle evidence. Independent
probes verified identical replay, conflicting ties, older rejection and newer recovery.

A forged AbortSignal prototype originally passed instanceof and failed inside
composition. Native signal-brand validation now rejects before starting work.
Held-original/reentrant-close probes verified shutdown waits and no late known
result or dependent Docker request appears after cancellation.

## Executed checks and limits

`npm run verify:v2` exited0 on the exact integrated source: **2339 tests/199 files**,
all three TypeScript projects, lint, generation37/23/6, architecture669, docs104
and frontend build. The existing611.56kB/178.59kB gzip chunk warning remains.
Final focused evidence/observer checks passed26 tests/2 files; parser/root-space
checks passed19 tests/2 files before behavior-preserving lint extraction, and the
full gate covered the final source. Initial fixtures needed a statfs.frsize field
and a BigInt-safe test title; no production guard or test gate was weakened.

Tests use real local filesystem/SQLite with controlled Docker replies. Actual
Docker sampling, startup, output guards, stop latency and Linux qualification
remain. This component supplies no guard readiness and cannot admit real work alone.
The previous local engine qualification image is no longer present; a read-only
image inspection confirmed absence. No build, pull, publication, deployment,
native AMD64, hosted CI, scans, backup or soak was performed by this slice.
