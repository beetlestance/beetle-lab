# Agent snapshot evidence

Date: 2026-11-08. Reviewed correction and full-gate source: `b519bc6`.
Environment: Node26.7.0/macOS arm64 with real temporary SQLite files.

Agent event append now commits lifecycle state, current wrapper phase, first exit
witness, immutable reported result, cursor and spool charges together. Known
exit refinements have a private durable frontier; the first public observation
remains unchanged. Wrapper results do not establish runtime exit, authenticated
seals, artifact custody, application finalization or reservation release.

## Executed checks

The focused journal run passed 72 tests in six files, including result duplicate
and conflict cases. Independent SQLite probes verified phase monotonicity,
supervisor/wrapper precedence, durable cancellation before its event, unchanged
cancellation clocks and contradictory exit rejection without cursor growth.

Review reproduced a correction-worthy case in `894c42c`: an initially unknown
exit allowed one known confirmation and then a contradiction. The correction
remembers confirmed fields across unknown observations, pruning and restart.
Independent probes reproduced the original sequence for exit code, OOM and reason;
all three contradictions now fail atomically while matching confirmations succeed.

Storage probes verified exact projection charging, replacement without cumulative
charges, quota-boundary rejection, SQL combined bounds and late-trigger rollback.
Pruning refunds event rows while retaining first-witness, known-facts and result
charges. Recovery listing reads lightweight metadata and includes terminal rows;
scoped get returns full reported results. Unpublished pre-v5 journal rows preserve
original events/cursors/accounting, with optional projections left UNKNOWN. No
startup history backfill or complete pruned-history reconstruction is claimed.

At clean `b519bc6`, `npm run verify:v2` exited 0: 2,031 tests/167 files, all three
TypeScript projects, lint, generation37/23/6, architecture572 and docs82. Frontend
build passed with its existing 611.56 kB/178.59 kB gzip main-chunk warning.

## Remaining work

This is journal evidence, not complete agent orchestration. Generic control/output
collection, durable application finalization acknowledgements, collection/release
composition, private agent HTTP, telemetry and Linux/container qualification remain.
No Docker image was built or published for this change. Node24 runtime, native
amd64/arm64, power-loss durability and full application recovery are not proven.
