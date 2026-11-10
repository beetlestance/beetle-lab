# Agent scheduling evidence

Date: 2026-11-08. Integrated source: `f43db64`.
Environment: Node26.7.0/macOS arm64, real SQLite and temporary files.

## Original component at f43db64

Private scanRunnable pages indexed charged reservations or pending queue rows,
returning only scoped generation keys. It reads no config/result/event payloads,
requires no migration and preserves charged cancellation discovery. A reviewer
independently populated10000 historical rows per lane: SQLite EXPLAIN used the
charged/pending range indexes before bounded unique identity joins. Pagination
returned only active keys without parsing intentionally invalid payload JSON.

The scheduling loop discovers charged work before queued work and retains at most64
original drive promises. It invokes each identity once concurrently, uses monotonic
operation deadlines and retains slots after timeout/abort until originals settle.
Discovery passes do not overlap. Queued page size follows available slots; charged
iteration rotates for eventual service through transient journal saturation.
The scheduler does not own capacity observations, test retries or runtime shutdown.

The existing installation/HTTP fixture now runs both manually and through the
scheduler alone. Its scheduled path uses actual catalogue/schema validation,
SQLite admission, Stager, AttemptController, control intake, output verification,
release and authenticated HTTP state/events. It asserts a single create/start.
Docker, capacity and the signed engine producer remain synthetic; this is no proof
of native execution, real socket parsing or application result finalization.

## Independent corrections

Review reproduced epoch deadlines failing the actual controller's monotonic budget
validator. The corrected default performance.now deadline passed that validator and
the scheduled composition fixture. Shutdown probes reproduced a reentrant scan
losing original ownership and abort callbacks receiving different close promises;
the corrected loop reserves/caches both owners before invoking callbacks.

Review reproduced100 pending jobs repeatedly driving only the first64 when page
advancement skipped undispatched identities. Slot-sized discovery reached all100.
Fixed charged order also repeatedly excluded a tail through a32-command port;
rotation by one serviced all64 in independent probes at capacities1,31 and32.
These probes and production regressions prove eventual service under transient
saturation, not a maximum timeout/output-guard stop latency.

## Executed checks

At the exact integrated source, `npm run verify:v2` exited0: **2294 tests/195 files**,
all three TypeScript projects, lint, generation37/23/6, architecture660, docs102 and
frontend build. The existing611.56kB/178.59kB gzip main-chunk warning remains.
Focused scheduler/composition checks passed19 tests/2 files; journal checks passed
94 tests/9 files before the read-only routing extraction, followed by its final
focused11-test rerun and the full integrated gate above.

## Remaining qualification

Real installation startup and shutdown, resource observations, guard freshness and
measured stop latency remain. Under saturation, fair polling can delay the tail
over multiple passes; an actual guard owner may need reserved service capacity.
Scheduler close drains scheduling originals only, and cannot certify stopped tests.
Bootstrap must separately handle installation/runtime cleanup and journal lifetime.
Actual Docker/Compose execution, irreversible uncertain-dispatch retirement,
application artifact transfer/finalization, native AMD64, hosted CI, scans, backup
and soak were not performed by this component slice.

## Durable delivery lane follow-up

Source `ca37048`, integrated at `dd183af9938540a0c9b8ef037c9f8c4cf5094a5e`, adds
released-source closure debt to the same64-original scheduling map. First lane
rotates charged/delivery/queued; noncharged pages cap at32 and remaining slots.
Delivery keeps a finite upper independently from queued progress. Whole scope pages
are copied before dispatch, including sparse-array refusal. No new pool or queue.

38 distinct focused passing cases: initial36 in1.62s, then only two added shutdown/
sparse-page cases in0.72s. Changed-file lint passed0.80s; whitespace check0.36s.
The bounded copy changed from map to Array.from before the final two cases to
validate holes; valid dense behavior is unchanged. No public type/interface change
or TypeScript/full-suite/Docker rerun. Coordinator source review matched all six
frozen path hashes, with no blocker (67s elapsed including handoff observation).

Synthetic scheduler ports prove fairness, finite passes amid arrivals and retained
scan/drive custody. They do not establish native producer closure or result
publication. [Journal discovery evidence](output-delivery-closure.md) is separate.
Manager closure wiring remains pending; the earlier full gate is historical evidence
for its original source, not a current full-suite claim.
