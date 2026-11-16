# Installed execution runtime evidence

Date: 2026-11-09. Integrated source: `b1f999c`; initial candidate `e1de9d3`.
Environment: Node26.7.0/macOS arm64, real temporary filesystem and SQLite.
Daemon responses and engine-result production remain controlled.
Later [native agent/k6 evidence](native-agent-k6.md) covers actual container execution;
the limits on this page describe the earlier runtime-composition fixture.

## Implemented composition

`openAgentRuntime` reserves one process owner, snapshots installation policy,
verifies the agent/root/daemon binding and opens its own fresh journal. Approved
profiles come from the installed catalogue. It composes actual Stagers, DockerBackend,
Supervisor, InstallationController, output/timeout guards, ResourceObserver,
ObservationPublisher, Scheduler and private Fastify server. There is no test-backend
factory or fabricated readiness in this production composition.

Capabilities use one informational actual resource frame, clipped by policy,
reserve/headroom and per-run limits. They require live publisher readiness and do
not authorize admission. Zero/exhausted advertised budgets return 503 without
inventing positive capacity. PID/output limits remain policy, not physical sensors.
Status ownership counts describe retained actors/work, not running process metrics.

Startup abort fences run after original verification and journal-opening work.
Shutdown fences intake, starts independent execution/service drains, then closes
monitoring and finally the journal. Failed cleanup retains process/journal ownership
and rejects clean close. No deletion or application artifact ACK is granted.
Known stopped reservations may remain charged for subsequent collection/reconciliation;
clean local shutdown does not itself mean all reservations were released.

## Executed scenarios and review

The nominal fixture uses actual root verification, catalogue, staging, DockerBackend,
private HTTP and scheduling. It queues an offer, starts exactly once, ingests a sealed
synthetic result, verifies output and durably releases its reservation. The test waits
for actor retirement, then reopens the journal to verify release. Exited/result alone
or a temporary scheduler gap was insufficient. No container DELETE occurs.

Other fixtures cover unavailable capacity with no launch/reservation; invalid
credentials and partial startup cleanup; aborted held verification; delayed original
journal readiness after abort; one-owner exclusion; cached close; reopen after clean
shutdown; and listener validation failure before any connection is accepted.

Independent review verified 29 frozen reads. Its fork-isolated failure probe held
an original create, confirmed close stayed pending, then returned unknown dispatch
and unavailable inspection. Close rejected cleanup, retained an actor, kept the
journal locked and refused a second owner. There was one create and no DELETE.
The completed isolated process terminated its retained SQLite worker; no production
reset hook or false cleanup proof was added.

Review reproduced one capability error: valid zero capacity reached the positive
wire-budget schema and returned 500. The correction returns 503 before serialization.
Five regression cases cover zero configured CPU/RAM/PID/output and actual daemon
capacity exhausted by reserve/headroom. Namespace-free errors remain empty responses.

Corrected review verified 34 frozen reads and passed 16 focused tests: 12 candidate
cases plus four independent cases. A remaining CPU allowance of one is reported
as one; no minimum is fabricated. Lint passed and no blocking finding remained.
Coordinator matched 30 final source/spec/test hashes to integration.

## Integrated verification and limits

`npm run verify:v2` exited 0 on `b1f999c`: **2467 tests/214 files**, all three
TypeScript projects, lint, generation 37/23/6, architecture 715, docs 117 and frontend
build. Tests took 111.54s. The existing 611.56kB/178.59kB gzip chunk warning remains.
The earlier candidate also passed its full gate; review still exposed the zero-budget
case, so the corrected source received a new complete gate.

This does not qualify a successful network listen, executable config/credential
loader, file/environment providers, agent image, Compose, actual Docker execution,
native mount visibility, either Linux architecture, stack overhead, stop latency,
irreversible restart fencing, artifact finalization, backup or soak. Those remain
required work. No hosted CI, publication, deployment or protection change is claimed.
