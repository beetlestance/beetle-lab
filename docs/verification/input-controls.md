# Connected input controls evidence

Runtime composition: `7c981cf`; smoke-oracle correction: `550664e`.
Environment: 2026-11-09, macOS arm64, Node26.7.0. Synthetic data only.
Scope: session-owned input transfer, workspace upload/download, actual HTTP recovery.

## Implemented behavior

The paired session supplies one bounded transfer client. Session replacement waits
for the retired client's original work to drain; failed cleanup requires reload.
Reentrant abort callbacks/subscribers cannot transfer an outer action to a newer
epoch. Component departure aborts local work without closing the shared client.

Workspace Inputs composes the existing inventory/current-status/deletion authority
with one prepared upload and a verified download action. Upload keeps one <=8MiB
payload and frozen create/seal identities; <=64KiB appends resume only after explicit
status reconciliation. An interrupted operation pauses; no failed write retries
implicitly. Acceptance202 does not show publication success. Empty files work.
Downloads create a save URL only after EOF/hash verification, use a generated safe
filename and revoke the URL on record/session departure. No browser persistence.

## Scoped checks and independent review

Session checks passed34 tests across4 files; two reentrancy regressions first failed,
then passed after capturing and publishing epoch ownership before foreign cleanup.
Final focused browser-compatible lifecycle checks, web types and lint passed.
Independent re-review cleared the correction at `0f42906`.

Upload21 and download39 component/controller tests passed, with types/lint and
separate source-only reviews. Composed input/session/inventory checks passed115
across13 files in24.25s. Actual SessionApp/App workspace upload/download/expiry
composition adds one passing jsdom test; it mocks the transfer factory and JSON
server, so does not establish native browser cookies, crypto or proxy behavior.

## Actual frontend controller over HTTP

`npm run smoke:input-controls` exercises BrowserSessionGate, UploadWorkflow and the
shipped public clients against the compiled Fastify backend, WAL SQLite and native
files on a task-owned loopback port. It uses private disposable config/data, explicit
child environment, bounded requests/output and clean SIGTERM verification.
Backend build was reused only after confirming its transitive sources matched the
previous successful build; no backend source or dependency changed in this slice.

The fixture prepares65,543 bytes, independently checks SHA256, deliberately loses
create/chunk/seal responses, checks exact original create/seal replay, reads committed
chunk offset65,536 before resuming, confirms publication and verifies downloaded
bytes. A second zero-byte input publishes/downloads. Logout fences the old client.
No engine or external target starts. CI runs this smoke after its backend build.
Independent review found missing first-response success proof. A negative fixture
returned unforwarded503 for first create/seal: the old test falsely exited0. After
capturing first statuses and asserting201/200/202 outside client callbacks, that
fixture correctly exited1. The actual HTTP smoke then exited0; Node types/lint0.
No repeated backend build was needed for this frontend test-only correction.

## Evidence limits

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited0 at `7c981cf`:
3,048 tests/292 files in381.46s; generated contracts, three TypeScript projects,
lint, architecture924, docs146 and frontend build passed. The later correction
changes only the standalone smoke fixture; its scoped checks and actual smoke pass.
Independent correction re-review found no blocking findings. Existing main-chunk warning remains;
no threshold is relaxed. Browser tool execution surface is unavailable: screenshots,
keyboard audit, real browser memory/cookies and frontend proxy framing are pending.
Containers/architectures, overhead, backup/soak and complete run/results/reports
remain unqualified. This slice does not replace the released legacy application.
