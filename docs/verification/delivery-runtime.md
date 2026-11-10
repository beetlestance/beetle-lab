# Automatic delivery and restart reconciliation

Status: independently reviewed, integrated and locally verified.
Source: `a6dd31ee6085054cb83adef34a4290fc514f85ed`.
This establishes backend delivery/recovery against a synthetic private agent,
not completed test results or native engine/release qualification.

## Connected behavior

The backend starts one delivery loop alongside capacity publication. Both share
one gateway and its original-call credits. Each turn holds at most one original
Offer, scans at most 32 compact candidates and alternates bounded queued/reconcile
continuations. Selected-item cursors preserve unread items and finite passes.

First possible delivery is persisted before PUT. Replays always GET first, including
queued-lane discoveries. Only a scoped `attempt_not_found` under the stored journal
UUID permits the same unacknowledged original. Generic 404, authority conflict,
transport uncertainty and acknowledged 404 never manufacture delivery/release proof.
Run scope/current attempt, cancellation intent and terminal state fence new PUTs.
Positive snapshots use the existing matched storage transaction; no second lifecycle
mapper, event ACK, artifact settlement or terminal result is fabricated.

Delivery failure fences new positive capacity writes, drains the original publisher
and attempts null revocation. A common synchronous poller failure notification also
stops delivery for source, publication and bounded-capture errors. Callback/revoke
failures stay retained. Both loops stop and drain before gateway closure; API metadata
remains available through those originals. Abort does not prove physical completion.

## Actual checks

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0 on the source above:
4,079 tests / 383 files; test phase 532.65 seconds. Contract generation, all configured
TypeScript/lint/architecture/documentation checks and frontend build passed.
Architecture checked 1,142 sources; documentation checked 181 files. Existing frontend
chunk-size notice remains. Host: macOS arm64, Node 26.7; target Node 24/Linux qualification
is separate. No relevant exact-source hosted CI evidence was substituted or claimed.

Earlier scoped checks: loop: 80 tests / 5 files; combined bootstrap/runner/delivery/API
scope: 342 tests / 30 files before the last correction; corrected poller/owners/TCP scope
33 tests / 3 files. The full gate above includes all corrections.

Real TCP cases use the actual gateway, capacity source and compiled SQLite worker.
One closes/reopens a pre-PUT claim, requires the fake peer to emit scoped 404 before
accepting PUT, then checks one original acceptance and durable snapshot acknowledgement/outbox retirement.
Another loses the response after fake-peer acceptance, restarts the backend worker
with changed profile pins and observes the retained receipt without another PUT.
The fake receipt remains alive across the backend restart; this does not establish
an actual agent-journal crash or real k6 target-load stream.

Independent source/oracle reviews found a final helper-await close gap, UUID URN
validation drift and a poller-local capture failure notification gap. Native adapters
already fenced the first two. Added cases failed against the original sources and
passed unchanged after correction. Reviews closed the findings; their source opinions
are separate from producer test executions. No assertions or gates were lowered.

## Remaining first-release work

Missing cancelled receipts remain charged. Durable fresh-receipt refusal, scoped
public cancellation and UI controls remain required; a Run read cannot serialize
a later user cancellation with an already-issued request. Events/cursor custody,
artifact transfer and result finalization, metrics/reports/export, first-install
provisioning, packaged executable/Compose/browser checks, backup/soak/scans and the
native amd64/arm64 matrix remain required. The legacy application is preserved.
