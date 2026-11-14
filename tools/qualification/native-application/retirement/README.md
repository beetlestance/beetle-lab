# Manual cleanup recovery check

Run explicitly with current local images and matching compiled API/Journal workers:

```sh
node --import tsx tools/qualification/native-application/retirement/smoke.ts AGENT_IMAGE ENGINE_IMAGE 200 LOCAL_CONTEXT
```

Uses the existing task-owned public application fixture and one real k6 execution.
After closing the public application, reopens the same compiled metadata worker and
commits a private deletion intent. The existing production runtime performs cleanup.
No product DELETE endpoint, registry or user installation is involved.

Actual committed intent, file plan, absence and ACK replies are withheld; each worker
terminates and reopens. A real TCP peer drops the first valid cleaned reply and binds
the retry digest to the stored ACK. The proxy drains actual request/response/socket
originals, bounds buffers/slots and fences cancellation/deadline before dispatch.

Acceptance requires all retained charges unchanged, published files absent, actual
engine/container volume absent, only the installed staging marker retained, one
readiness/work request and verified task cleanup. Logs/evidence remain in the reported
private temporary directory. Failures retain their evidence; never infer rollback
from a missing reply or refund from a timeout.

Source/image/worker identity must be recorded by the coordinator. A qualification
agent overlay and unchanged reused engine can qualify behavior without proving a new
production image build. Host backend and Linux agent platforms are reported separately.
Hard agent crashes, full Linux backend, amd64 and release qualification need separate
accepted evidence. Focused proxy lifetime tests require ephemeral loopback permission.

The separate `agent-crash.ts` command uses the same four arguments. It requires the
coordinator-built private `.agent-work/docker-proxy.mjs` bundle. This task-only Linux
proxy uses the existing config bind and the actual local Docker socket; only the
captured observed runtime and mailbox may be deleted. One settled container DELETE
reply is withheld to place a real hard agent crash before mailbox removal.

An offline, original-scoped fault trigger then aborts the first file-step progress
UPDATE after native unlink. It is removed before retry; production guards and rows
remain unchanged. This qualifies that failed update and subsequent restart, rather
than claiming a separately observed COMMIT-loss event. The command requires exact
stored next-file absence with old progress, unchanged charges, final automatic ACK
and complete proxy/task cleanup.

## Settlement recovery

`settlement-smoke.ts` accepts the same four arguments with source-matched settlement
agent/engine images and both compiled workers. It runs one real bounded k6 test,
then normal Root cleanup and settlement. The peer drops the actual committed agent
reply and blocks further settlement dispatch while unchanged backend debt is inspected.
After agent restart, exact settlement/retirement replay is required. A backend commit
reply is then withheld; actual worker abort/reopen must recover the same credit once.

Offline inspections require a stopped agent or closed metadata owner. They verify
original purge,4096/2560 replay floors, zero agent holds and FK consistency. Target
counts, empty backend publication, installed marker only and no engine/mailbox resources
are required. Failed close remains a failure. The peer's paused-retry exclusion has
its own focused TCP test; native recovery need not happen to race that path.

Local evidence and platform/branch limits: `docs/verification/native-settlement.md`.

## Never-started recovery

`no-task-smoke.ts rejected AGENT_IMAGE ENGINE_IMAGE 200 LOCAL_CONTEXT` and the same
command with `admitted` qualify originals without native task creation. The admitted
image must contain the bundled `no-task-seed.ts` setup helper. Setup captures the actual
Offer, creates genuine policy admission/abort using Linux native guards, then restores
the normal entrypoint. It grants no cleanup receipt or refund. Both modes require
production absence finalization, cleanup, lost settlement replies and permanent replay.
Exact branch funding is inspected in the bounded canonical durable tombstone.
See [evidence](../../../../docs/verification/rejected-cleanup-funding.md) for limits.


## Protected retention recovery

`retention-smoke.ts` takes the same four arguments. It adds authenticated public
manual preview and compiled-worker Apply to the actual settlement recovery flow.
Its independent inspectors require the exact paid snapshot/epoch rows; no assumed
metadata slack is subtracted. Completion, Apply replay, explicit acknowledgement
and refusal after removal leave2560 backend replay bytes plus the permanent512-byte
epoch; agent replay remains4096. Public workspace Apply HTTP is qualified separately.
See [native retention evidence](../../../../docs/verification/native-retention.md)
for current payload images, platform limits and actual accounting.
