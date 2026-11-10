# Durable cancellation

Status: independently reviewed, integrated and locally verified.
Runtime source: c4c0ccb77a8aae53645df5223aedb13b885c7b53.

## Connected behavior

Public scoped cancellation records one receipt-first SQLite intent under the same
write serialization as dispatch claims. A strictly proven never-delivered original
may close locally as cancelled/inconclusive with pending validation. Possible or
acknowledged work retains original ownership, execution and output custody. Missing
outbox or display state never proves that an attempt was unsent.

The private cancel-original operation carries the exact Offer and immutable journal
UUID. It shares Offer ingress and gateway credits, structural bounds and original
settlement. One journal transaction persists canonical original, first-cause stop
and a fresh-only refusal marker, validating the snapshot before commit. Existing
unknown receipts cannot acquire that marker. Schema10 preserves authority/quarantine;
older schema9 binaries reject it. No catalogue/staging/result facts are fabricated.

Delivery reconciles cancelled unacknowledged originals through a matched missing
receipt before refusal. Acknowledged absence stays unknown; no normal PUT fallback.
Installation signals existing runtime only after durable commit and retains originals
through shutdown. Actual release requires matched journal evidence.

UI distinguishes accepted intent from confirmed status, retains the same request
across lost replies and detail-read errors, fences retired sessions/scopes and
refreshes current reads instead of seeding detail from an old receipt.

## Evidence

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0 on the runtime
source above: 4,216 tests / 401 files; test phase 570.01 seconds. Generation of
43 runner/35 API/6 k6 outputs, all configured types/lint, architecture (1,171 sources),
docs (183 files) and frontend build passed. Host: macOS arm64, Node26.7;
Node24/Linux and native architecture qualification remain separate.
Earlier composed source passed 141 installation/transport/public/bootstrap seam
tests across 23 files and Node TypeScript. Corrected UI cancellation tests passed 5;
real public HTTP/compiled SQLite/restart test passed 1. Component reports distinguish
final journal 136 tests from its earlier 256-test run, and storage 51 distinct scoped tests.

Real-worker interception suppresses successful replies only after Store.execute
returns from COMMIT, proving pending cancellation originals retain both credits.
Abort/reopen/replay retains one marker, first cause/time and no execution facts.
A separate real HTTP test loses a committed public cancellation response, reopens
SQLite and verifies replay/current Run plus independent table/foreign-key assertions.
This establishes graceful reopen and worker termination, not host power-loss safety.

Independent review found an absent committed-reply oracle and a UI owner below a
read-error boundary. The added oracle covers the first; the UI regression failed
before lifting ownership and passed unchanged afterward. Follow-up reviews closed
both findings. No gates or assertions were lowered.

## Limits and next work

Synthetic installation engines and local TCP/SQLite tests do not establish browser,
real k6 cancellation timing or native Docker amd64/arm64 qualification. Existing
UI build chunk-size notice remains. No public push, image or deployment occurred.
Events/cursor custody, artifact transfer/result finalization, live metrics/reports/
export, provisioning/Compose, backup/soak/scans and platform qualification remain.
Legacy application is preserved; full first-release completion is not claimed.
