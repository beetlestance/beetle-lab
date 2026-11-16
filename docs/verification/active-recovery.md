# Packaged active restart and cancellation

Q02a: local ARM64 active-phase recovery/cancellation with the unmodified public
candidate `72243a87`. This is separate from full lifecycle/resource qualification.
[The harness](../../tools/qualification/resources/lifecycle/CONTEXT.md) uses six
immutable root/platform/config identities, default Compose services and UID1000.

## Accepted observations

One VU performs forty finite requests,500ms apart, with a30s maximum. The fixture
observes eight requests before the fault, checks unfinished work after SIGKILL
acknowledgement and again at recovered-service readiness, then requires the same
original attempt/generation/container and exactly forty requests. Readiness polling
uses the healthy backend peer rather than spawning processes inside the agent.

| Case | Result |
| --- | --- |
| Backend SIGKILL/restart | Same service container explicitly restarted; ten requests at kill acknowledgement, sixteen at readiness, forty total; original run passed. Five actual resource summaries. |
| Agent SIGKILL/restart | Eleven requests at kill acknowledgement, twenty-seven at readiness, forty total; same original run passed. Three resource summaries, including explicit restarted provenance. |
| Public cancellation | Fresh installation, eleven requests, original engine stopped/non-OOM, cancelled/inconclusive run and no sealed result. Two actual resource summaries. |

Observed restart fixture elapsed times were3546ms and8543ms. They include Docker
calls and probing overhead; they are not clean startup benchmarks. The tool
explicitly starts the same stopped service after Docker kill; this does not prove
automatic restart-policy behavior. Session identity was preserved across restart.

Actual emitted Docker-stats summaries retained raw cumulative CPU, sampled memory/
PID peaks, source and sample provenance. The recovered agent's final summary had
reason restarted and eight post-restart samples; it did not invent earlier peaks.
Output usage remained null. Runtime inspection matched1CPU/512MiB/PID128
attempt controls; sampled memory/PID peaks stayed below their ceilings. No telemetry
accuracy tolerance or overhead percentage is established.
The actual frontend/backend/agent reserve matched1350CPU-millis,603,979,776bytes
and160PIDs. Service limits and128MiB output pool were unchanged.

Cold point reads verified both crash executions and cancellation released their
execution reservations, with event backlog zero and admission released/settled.
Each original output allocation was67,174,400bytes. This immutable field survives
refunds and does not prove current retained debt. Original native reports used the
misleading outputChargedBytes label; the harness now says
originalAllocationChargedBytes. Readers used the same backend image, UID1000, read-only SQL, bounded runtime/output and unchanged main-file hashes.
A separate cold inspection used finalization/absence refunds and cleanup controls,
matching the production history reader's debt calculation. Current backend logical
amounts were269,214bytes,267,949bytes and137,137bytes respectively. Agent Journal
disk holds independently remained64MiB per run; the crash fixture's retained-output
counter was exactly128MiB. Both backend and agent main-file hashes stayed unchanged.
The two accounting scopes must not be conflated.

All serving peers were stopped before that counter inspection. The harness's
point reader stops its backend before inspection, preserving its exclusive SQLite
lease. Directory writes were permitted only for SQLite sidecars.

## Evidence boundaries and failures

The cancellation profile passed in30.580s, including setup, checks and cleanup.
The crash observations reuse two passing partial rows from a116.564s attempt
whose third run remained pending. That overall attempt remains failed. Original
dirty-input hashes, exact rows and cleanup evidence are retained; separate cold
point reads verified those two rows. This reuse received independent approval.

The following offer remained pending although both execution reservations were
released. The stock128MiB pool and original64MiB allocations were unchanged;
the separate agent counter confirmed two retained64MiB holds. This is distinct
from refunded backend logical debt. The harness uses separate crashes and cancel
profiles with fresh projects; it
does not enlarge the pool or erase history to fit a third execution.

Earlier harness failures are preserved: invalid scenario identifier before effects;
incorrect automatic-restart expectation; a forbidden live database reader; a short
workload without confirmed active post-restart observation; and readiness probing
inside the recovering agent. They are not retroactively successful runs or proven
product defects. Every recorded fixture teardown verified owned cleanup.

Host orchestration used Node26.7.0/Darwin ARM64; actual services/engine/readers ran
native Linux containers from the published images. The final task base was
`68d9f989` with dirty file/lock hashes. Eleven focused harness cases, existing
relevant fixture checks, Node types, changed lint and architecture/docs checks
were recorded. No product runtime, schema, dependency or image build changed.

## Remaining qualification

Clean candidate `23bb8c82` passed both profiles on native Linux AMD64 and ARM64
in CI43756923411. Each backend/agent crash retained the original attempt and40
work requests. Cancel stopped after11 AMD64/10 ARM64 requests. All four reports
verify cleanup and positive CPU/memory/PID samples with zero missed samples;
agent restart summaries retain `restarted` provenance. This independently reviewed
proof qualifies the immutable request binding for Docker stats whose response ID
is omitted, and the tested active paths. It is source-built qualification, not a
new publication or telemetry accuracy/overhead claim. Earlier failed native runs
43751148704/43753698469 remain failed; their diagnostics identified the omitted ID.

Other lifecycle phases, shared/isolated admission, native OOM attribution, flooding,
telemetry overhead/soak and full disk remain open. Default-UID ARM cold recovery
has [separate scoped proof](packaged-cold-recovery.md). These observations do not
close all V03/V06/V08 groups or qualify a complete release.

## Later source candidate refusal

CI43785915920 at3df9d31c passed the AMD64 lifecycle and ARM64 backend-crash case,
but ARM64 agent recovery reached readiness only after the original completed all
40 work requests. Cleanup passed; active-recovery qualification did not. This
report does not identify a runtime cause or invalidate the older scoped23bb proof.
The qualifier now retains one closed last recovery observation on failure
(elapsed time, HTTP status and work counts), preserving the same active oracle.
Two storage-poller tests in the same run also exposed teardown ordering: pollers
now close in test-local finally blocks before the storage fixture aborts handles.
No runtime deadline, resource cap, readiness condition or pass gate was relaxed.

Prepared source CI43790786956 at4a4c6514 passed both native image/archive jobs
but one66-history integration test exceeded its generic10s case deadline. Its
fixture now prepares all66 real Journal traces in a fatal20s setup hook, closes
the worker, then reopens the durable database for the unchanged10s behavior check.
All no-follow-up/owner-cap/closure/cursor/sequence/FK assertions remain. The focused
Node24 run passed all five cases in10.28s total; the66-call behavior took724ms.
This is fixture preparation separation, not a production or global timeout change.
