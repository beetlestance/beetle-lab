# Composed cleanup recovery evidence

Status: C4h2A locally accepted; hard agent-crash and full Linux backend remain pending.
Baseb2aa5f6. [Driver](../design/lld/output-deletion-runtime.md),
[association](../design/lld/runtime-association.md),
[manual harness](../../tools/qualification/native-application/retirement/README.md).

## Observed behavior

One public application run executed real k6 against a task-owned target. The harness
then reopened the actual compiled backend metadata worker, committed a private deletion
intent and used the existing production runtime/gateway to perform cleanup. Actual
committed intent, file-plan, absence and ACK replies were withheld, followed by worker
termination and reopen. File receipts and the immutable ACK recovered without replaying
execution or refunding charges.

A real bounded TCP peer dropped the first valid cleaned runner reply after the actual
agent cleanup completed. The retry produced the identical canonical digest, which
matched the backend stored ACK. Observed2retirement calls/2cleaned replies,0proxy
failures/active forwards,1readiness/1work/0unexpected target requests. Actual published
files, engine container and mailbox volume were absent before fixture cleanup; only
the installation staging marker remained. Installation charge stayed169823 bytes.
Whole task container/network/volume cleanup was verified.

Accepted run23.48s (application evidence20.79s). Agent and engine were Linux arm64;
backend ran native Darwin/Node26.7. The new agent qualification overlay used freshly
compiled accepted b2aa5f6 payloads over the unchanged retained Node24 runtime image.
The engine Docker COPY inputs were unchanged from0f0afbb93db3 and its image was reused.
Source and both compiled-worker hashes remained unchanged during the accepted run.
This does not qualify the production image build recipe, Linux backend or amd64.

## Check and review boundary

Four focused proxy cases passed.96s: progressing-stream absolute timeout, held upstream
close, final-body cancellation and elapsed deadline before any upstream dispatch.
Forwarding plus inbound/outbound socket-close originals are joined. Fixed8forward/
16socket and byte/deadline limits remain; no event-handler limit throw bypasses cleanup.
Exact retirement-only composition imports are reviewed; sibling/deep/reverse imports
remain denied. The shared physical accounting assertion now includes the independently
reserved backend cleanup-control cell rather than comparing only output allocation.

Types16.52s, lint7.59s and architecture5.67s passed before native acceptance. Final source gates also passed: types, lint, architecture and documentation;
compiled API/Journal bundles were unchanged and reused. Independent
review accepted the scoped native result and proxy correction. Private evidence lives
under .agent-work/cleanup-composed-c4h2a after integration. Failed attempts are retained:
immutable Fastify listen options, asynchronous failure-notification ordering and an
inventory assertion targeting the parent directory were corrected in the harness.
The initial proxy regression exposed server-close/socket-close ordering; actual closes
are now awaited. Production cleanup gates were not relaxed.

No public retention/delete, agent/backend settlement, tombstone or release claim follows.
C4h2B must qualify hard agent crash between runtime and mailbox removal, native unlink
recovery and remaining actor-reopen paths before complete C4 acceptance.
