# Durable event transport

Status: reviewed and locally verified transport custody; result handling and release
qualification remain pending. Integration `1c2fa1263a9ffb72fcf7478eb5df91907ef47813`
has the same tree as tested/reviewed `552a1c46e2a3508e1888453d8acd3932ffe64ac6`.

## Implemented boundary

Strict domain validation separates physical binding, contiguous event durability,
snapshot sequence and remote ACK confirmation. Indexed discovery retains released
and unbound originals. Atomic SQLite ingestion validates replay and quota before
writes; events consume the original output allocation without a second charge or
an ACK refund. RPC replies must cover the issued batch and safe ACK prefix.

The existing delivery timer rotates queued/reconcile/events, selecting at most one
candidate per turn with independent continuations. ACK follows durable ingestion.
A stored unconfirmed prefix is re-ACKed after restart without requesting pruned
remote events. Close retains positive batch/ACK custody and original operations;
existing owners close the shared gateway and metadata after their drains.

## Source-bound evidence

Local host: Darwin arm64, Node26.7.0. This is not native Linux/container evidence.

Full source `ff0696bec319fc02f84640164ea3fdb9f0a3bcd1`:

- `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2`: exit0;
  4479 tests/423 files, one file worker; test phase599.09s. Generation, typecheck,
  lint, architecture, docs and frontend build passed. The existing611KiB frontend
  chunk warning remains; it is not a failure or a performance measurement.
- Focused domain/helper/runtime/Metadata suites: 338 tests/26 files, exit0.

Final source `552a1c46e2a3508e1888453d8acd3932ffe64ac6` changes four test-only files
from that full source; production/contracts/frontend sources are identical:

- `npx vitest run app/test/bootstrap/delivery-http.test.ts app/test/bootstrap/event-http-peer.test.ts --maxWorkers=1`: exit0, 12 tests.
- Node TypeScript and scoped ESLint: exit0; architecture1219/docs188 passed.
- The TCP test records SQL cursor/count/charged bytes after native COMMIT returns,
  then reads that bounded observation synchronously at ACK arrival before body
  reads. It preserves the production exclusive database lock and imports the
  compiled production worker. Losing ACK response and pruning the synthetic peer
  prefix, then reopening Metadata, confirms re-ACK without another GET, duplicate
  events/charge, another PUT or an invented terminal outcome.

The full suite was not rerun on the test-only correction. The earlier queued-read
oracle and the failed independent-reader attempt are superseded; the latter fails
under exclusive SQLite custody. Neither supplies the corrected ordering evidence.
Independent reviews closed binding, schema, RPC reply and ordering/routing gaps.
The final oracle received a fresh independent review; source review did not repeat
producer tests and is recorded separately from execution evidence.

## Limits

The TCP peer is synthetic. Actual agent HTTP/Journal pruning and physical authority
still need a connected seam test. No complete engine/backend run, power-loss,
artifact/seal closure, terminal outcome, Docker install, native architecture,
resource/soak or browser qualification follows from these checks. R0–R4 remain open.
