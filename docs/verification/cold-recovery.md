# Cold recovery: local implementation evidence

Candidate based on4710af0. Runtime/build-input digest:
`8105a8a2c80e14d2e3c5d2f87fefe1a3488fefe65ad9a521b721486968b1e1c2`.
[The contract](../design/lld/cold-recovery.md), [decision](../decisions/016-historical-restore.md)
and [runbook](../recovery.md) define the supported historical-only scope.
This report is local implementation evidence, not whole-R4 release acceptance.

## Implemented behavior

- Real backend/agent startup exclusion, explicit fresh control initialization and
  fail-closed incomplete states; uncertain closes stay owned and are never retried.
- Bounded cold inspection/copy, normalized SQLite snapshots, removal of copied
  browser credentials, canonical manifest and permanent completion seal.
- Fresh-only historical restore, exact-operation/native-root resume, no-overwrite
  publication and irreversible history purpose; original installation untouched.
- Separate authenticated viewer with read-only metadata, native copied-byte custody,
  mutation denial and no agent/maintenance/indexer. Independent history cookies.
- Packaged CLI, offline maintenance Compose and a separate history frontend/backend.

## Scoped failure coverage

Checks exercise actual SQLite/file resources: startup lease contention, missing or
foreign control, close-then-throw retention, read-only worker mutation refusal,
unchanged source bytes, manifest EOF/truncation/count/path checks, corruption,
symlinks, foreign entries, budgets, interrupted copy/resume and completed replay.

Additional regressions cover historical purpose before sealing, abort during final
original drainage, root/work substitution, metadata substitution before the actual
worker open, SQLite destination substitution before both native opens, globally
charged pending sibling discovery and held read backpressure/failed native close.
Independent reviews accepted the corrected boundaries; review did not replace tests.

The frozen integration plan passed all9 checks: combined Node/web/k6 types, lint,
architecture, docs, both generated contract catalogues, Compose constraints,
243 focused tests across20 files and whitespace checks. Session/contract/UI
regressions also passed; the isolated TCP test was rerun with loopback permission.

## Actual execution and history

A single-VU synthetic run made10 work requests plus1 readiness request. A graceful
backend restart occurred during actual execution while the same agent/engine
attempt continued. Terminal result, output accounting and task cleanup were checked.
The backend then closed, the task agent stopped, and real cold backup/restore ran.

The first native copy exposed missing journal SQL guard registration; the cold
preparer now registers the existing functions without migration or observation
updates. A later harness incorrectly waited for live capacity in a historical
viewer. That readiness assumption was removed instead of publishing fake capacity.
Its completed archive/restore phases were reused and linked by evidence SHA:
`8833294827a268b00420d5f97fed4c10996717bd2c64fbf57c549d482a7d6a80`.
No third k6 workload was used to repeat the unchanged execution phases.

The corrected history phase verified12 archive files/1526082 payload bytes, the
same Run/result, all7 published artifact downloads/50544 bytes and their SHA-256,
403 mutation refusal, unchanged metadata and unchanged completed resume.
Source backend/maintenance ran on macOS Node26.7.0; agent/engine used Linux arm64.

## Packaged read-only path

Linux arm64 Node24.22.2 containers ran the compiled restore CLI and a historical
backend through the actual frontend proxy. Supplied installer payload verification
covered9 bundles; the frontend index matched the current build. Authentication
survived backend restart; all7 artifact hashes, metadata immutability and completed
resume passed. The fixture used numeric user501:20 and task-owned bind mounts.
All task containers/networks were removed; private evidence directories were retained.

The initial internal-only frontend network discarded Docker port publication.
The corrected topology keeps the backend internal and connects only the frontend
to an ingress network, with its published port bound to127.0.0.1.

Recipes used cached dependency-image overlays with verified current payloads;
this does not certify an independent full Dockerfile build or registry pull.
Relevant executables are `smoke-restart.ts` and `history-container.ts` under
`tools/qualification/native-application/`. Private reports retain exact images,
commands, failures, source digests and native evidence.

## Remaining qualification

Native amd64, default-UID packaged cold backup, full source/pull recipes, SIGKILL/
lost-response phases, large archives/disk failure/soak and real-browser acceptance
remain in the [release backlog](../execution/remaining-rewrite.md). A graceful
restart is not proof of every crash phase. Mutable/in-place restore and old-root
adoption are unsupported by design; this feature never rewinds current receipts.
