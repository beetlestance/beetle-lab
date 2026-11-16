# Actual agent event custody seam

Status: independently reviewed and locally verified protocol/persistence seam.
Worker correction `554eb1d`, cleanup correction `c36b8f1`; composed source
`226dedb1fcb3729e70567355f18d6fed4302687d` includes the collector facts producer.
Local host: Darwin arm64, Node26.7.0. No Docker or engine execution is inferred.

## Connected components

The app test owns actual compiled Metadata, RunnerGateway and the event collector.
A separate agent-owned fixture process owns the actual compiled Journal and
createAgentServer. Real loopback HTTP carries event reads/ACK; bounded single-call
fixture IPC appends synthetic control records and inspects actual durable state.
Installation/engine callbacks fail if invoked. No app-to-agent implementation
imports or architecture exceptions are used.

Backend claim binds the actual persisted agent journal UUID. The ordering oracle
reads the bounded native-COMMIT observation synchronously in the agent process at
request arrival, before Fastify/body awaits. Closed-owner SQLite inspection checks
actual canonical rows, charges, cursors and real agent pruning independently of
returned success. It preserves production exclusive database custody.

## Executed cases

- Event ingestion precedes actual agent ACK; pruning removes actual agent rows,
  while backend rows, byte charges and output allocation remain unchanged.
- ACK applies in the actual Journal; the HTTP response is dropped. After real
  pruning and graceful close/reopen of both original paths, UUID and local prefix
  persist. Recovery re-ACKs without fetching the pruned prefix or another Offer.
- A genuine expired cursor yields partial coverage without invented rows, ACK,
  terminal outcome or storage refund.
- A replacement physical journal returns genuine absent/expired history under its
  own UUID, but rejects the stored old UUID. Current capacity cannot rebind the
  original or create false missing/expiry diagnostics.

`npx vitest run app/test/event-agent agent/test/controller --maxWorkers=1`:
exit0, 50 tests/5 files at composed source,23.89s. This includes five actual-agent
cases and45 controller regressions. Node TypeScript, scoped ESLint,
architecture1229/docs192 checks passed. Independent reviews closed the cross-service
harness and failure-cleanup ordering issues; reviewers did not repeat these tests.

`NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` at composed source:
exit0,4497 tests/426 files, test phase600.13s. Generation, types, lint,
architecture, documentation and frontend build passed. The existing611KiB frontend
chunk warning remains. This full result belongs to the named code source; this
report is a separately checked documentation-only followup.

## Limits

Fixture control records are synthetic; no admission, staging, runtime launch or
complete engine/backend result is exercised. Reopen is graceful, not an abrupt
process/power-loss qualification. The helper is exercised directly; automatic loop
selection has separate [delivery evidence](event-custody.md). Artifact transfer,
source receipts, terminal closure, browser/containers/native architectures and
resource/soak qualification remain required first-release work.
