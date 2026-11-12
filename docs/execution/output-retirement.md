# Producer cleanup: next implementation packets

Status: proposed dependency plan, not implemented cleanup or release acceptance.
Base8da81ed. Root owns integration, contracts/migrations and dependency files.
Contract: [retirement/cleanup acknowledgement](../design/lld/output-retirement.md).

## Why this is next

Backend file deletion already has actual persisted plans and absence receipts.
The missing physical owner is agent staging/output, including stopped producer
and source-reader originals. Failed native output closes now retain admission and
strong custody. Preserve that prerequisite instead of treating rejected close as
free capacity. The remaining sequence must keep every existing charge until its
actual cross-service cleanup facts are complete.

## Dependency order and ownership

| Packet | Owns | Starts after | Concrete acceptance |
| --- | --- | --- | --- |
| C1 durable namespace/control | Journal namespace/retirement modules; staging identity projection; bootstrap pre-work gate; private contracts/codecs | Exact shape/byte budgets and conservative upgrade reviewed | Same root survives reopen; changed/empty wrong root refuses before intake; control capacity cannot be consumed by ordinary payload |
| C2 producer/read retirement | Existing installation/supervisor retirement and source-read lease owners; narrow bootstrap wiring | C1 durable gate | Held original stays owned; late read/drive cannot cross fence; rejected close stays charged; no new target load |
| C3 native task cleanup | One staging/output cleanup owner using existing native custody/credits; durable preparation/progress | C1 identity and C2 drain | Actual inventory/plan committed before unlink; same plan resumes; root/link/mount/close/flood negatives; exact owned absence |
| C4 runner/backend ACK | Exact private runner route/gateway; Journal receipt; existing backend deletion driver progress | C1–C3 composed | Real native roots + authenticated transport + both compiled workers survive lost intent/plan/unlink/ACK replies; all charges unchanged |
| C5 final settlement | Agent disk-hold owner and backend allocation/purge owner; compact replay tombstone contract | C4 positive exact receipts and replay policy reviewed | No early/double refund; exact counters; late Offer cannot rerun; crash between databases retains recoverable work |
| C6 public retention/delete | Public API/schema/UI; real settings policy selection/immutable preview/apply | C5 runnable end-to-end | Scoped bounded preview, active/pinned exclusions, stale-version conflicts, partial/error progress, actual delete and durable replay |

C1/C2/C3 have reviewed interface dependencies, not permission to independently
invent them. Reserve exact schema names, migration IDs and public entrypoints with
one root owner before assigning code. A worker gets only its packet and necessary
contract pages. Do not copy this entire dependency history into every context.

## Task granularity and parallelism

The current bounded session uses root implementation and the existing independent
reviewer only. No speculative worker pool or nested delegation. After interfaces
are frozen, pure codec/negative-vector work and native fixture work may be separate
assignments if explicitly authorised. Coordinator keeps one heavy native/Docker lane.

C1's schema/migration and bootstrap gate must be integrated together. C2's local
lease acquisition and durable gate check are one responsibility; splitting them
creates a check/use race. C3 inventory/prepare is distinct from destructive replay,
but neither is accepted without its composed persisted-plan fixture. C4 is the first
physical cleanup vertical slice; do not advertise C1 codecs as cleanup support.
C5's agent and backend transactions need their own acceptance plus cross-service
recovery, rather than one large generic cleanup manager.

Keep each production module <=400 lines, functions <=80/complexity10, feature
contexts <=40 lines. Introduce modules by ownership: namespace binding, retirement
intent, native preparation, native removal, receipt capture, settlement. Do not
create parallel compiler/engine logic or spread one state transition across helpers
whose sole purpose is bypassing size checks. Root dependency/contract files stay
reserved; no push, deployment, real credentials or user-service restart.

## Packet contents before coding

Each packet states base/branch/worktree, exact owned paths, public input/output and
byte limits, durable versus native authority, cancellation/deadline/close behavior,
actual failure fixtures, scoped check command and what remains unimplemented.
No optional default-zero accounting or in-memory recovery receipt. Existing data
and Git metadata survive; use synthetic task-owned roots/ports/containers.

C1 freezes native plan bounds and the complete future control reservation together;
C3 qualification cannot silently change either or admit originals against a stale
reservation. If qualification needs larger bounds, revise/review the contract and
admission/migration as one versioned change before enabling it.

C1 must explicitly settle the persistent root anchor for existing admitted history.
The current process-local VerifiedRoot and source-only output-root receipt do not
prove old task/input/secret namespace ownership. Require an independently validated
existing anchor or keep that original in recovery-required state. Test startup before
scheduler, publisher, preparation and intake, not merely before HTTP listen.

C3 must finalize the exact per-original control reservation and native plan codec
before its migration. Proposed512 entries/128KiB plan are guardrails to qualify,
not proof that every supported engine layout fits. Cover the largest supported
input/secret/artifact layout; over-bound cleanup stays pending/charged with an
explicit reason and cannot silently relax the ceiling.

C5 preserves the positive unsent-cancellation branch: revalidate the existing durable
non-delivery witness and require no agent cleanup ACK for an original that never
existed there. Unknown delivery and generic404 never enter that branch.

C5 must define quota/retention for replay tombstones before removing admission or
Offer identity. Keeping full historical payload forever and dropping all replay
identity are both incomplete reclamation designs. A bounded tombstone/fence policy
must continue rejecting late old originals, including after a lost final ACK.
No event ACK, source digest or normal agent404 supplies that anti-replay contract.

## Verification and stop conditions

Run scoped cases while implementing. At freeze, reuse relevant source-bound greens
and check only affected integrated boundaries once. Keep initial failures, command
exits, elapsed times and full logs privately; expose concise redacted evidence.
One real composed fixture covers the native filesystem/Journal/transport/backend
chain. Synthetic metadata-only success cannot close that acceptance.

| Boundary | Required adversarial case |
| --- | --- |
| Namespace | Same spelling/different inode, wrong mount, ancestor swap, missing persisted anchor |
| Retirement | Read begins before/after commit, held ignored abort, stale authority, recovered empty owner |
| Native removal | Complete bounded inventory, unknown entry/link/mount, fsync/unlink/close reply loss, changed prepared plan |
| Control quota | Payload exactly fills ordinary allowance; future cleanup reservation remains available |
| Settlement | One side commits/reply lost, retry exact original, no early/double credit, stale tombstone/reoffer |
| Public apply | Scope/settings/run-version mismatch, pinned/active data, partial plan, actual durable progress |

If a packet reaches its work-session deadline, preserve the worktree/source and
failing evidence. Mark the partial state honestly; never lower a gate or grant
cleanup/refund authority to obtain a passing milestone. UI redesign, additional
engines and hosted IAM remain outside this sequence.
