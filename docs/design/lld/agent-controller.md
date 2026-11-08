# Local attempt controller

Status: implementation under independent review. Scope is one admitted, staged
runtime; installation scheduler, fresh admission/staging and private HTTP composition
remain separate work. This page owns the controller handoff, not another execution
state machine. The [execution protocol](execution-protocol.md) owns lifecycle and
[collection](agent-collection.md) owns filesystem verification.

## Construction and ownership

Trusted installation composition supplies one journal owner, supervisor, immutable
RuntimePlan, scoped generation and generic output collector. Staging must have
quiesced successfully before handing over the plan. Engine paths/UID come from the
approved plan; engine identity and output budget come from the immutable offer.
The public factory uses the real Node control reader. Test ports remain private.

One controller owns each journal/scoped generation, with at most64 owners per
journal. Duplicate ownership rejects. A successful close releases that local owner;
failed or outstanding cleanup retains it. The durable journal remains authoritative
across process restart. Controllers do not allocate another generation or repeat
HTTP load to recover evidence.

`launch` and `tick` share one lane; concurrent calls reject busy rather than queue.
A call snapshots its deadline/signal after reserving ownership. Its deadline is
within five minutes and each control read within30seconds. Calls await original
reader/collector quiescence; a stalled kernel operation can keep that private call
pending beyond its public budget. Transport must schedule work separately from
snapshot/cancel reads rather than await these calls in an offer handler.

## Execution and collection

Launch delegates all create/start capabilities to the existing supervisor. Tick
reconciles without dispatching execution again. A definitive launch settlement and
created/exited container permit stopped control verification; uncertain dispatches
remain provisional and charged. Wrapper batches commit atomically before reader
acknowledgement. Identical ambiguous commit can replay on a later tick.

After stopped-prefix verification, the controller closes the original reader,
checks the journaled result and invokes generic output verification. All original
collector operations and closes settle before the collection outcome is retained.
A failed original close permanently prevents release. Invalid control data requests
durable cancellation; missing/invalid outputs are failed collection, never a pass.

A later supervisor observation and quiescent collection observation are submitted
with the exact persisted launch settlement to release capacity. Observations at the
settlement millisecond wait for a later real clock sample. Release persists
collection finished/failed; it does not finalize an application outcome, authenticate
an engine result, acknowledge artifact transfer or authorize deletion.

## Cancellation, shutdown and restart

Cancel independently fences the actor synchronously and commits clocked durable
intent before signalling. Before an actor exists, the journal supervision command
records the trusted clock with that intent. The supervisor retains its original
grace origin across repeated requests. A cancelled, never-claimed launch may use
abortUnstarted only after original preparation/controller work has quiesced.

Close fences new calls, requests cancellation, independently closes reader/output
operations and waits for the original active lane. It reconciles a claimed runtime
before retirement; unresolved runtime/dispatch or cleanup rejects rather than
claiming completed shutdown. Such reservations stay charged. The installation
shutdown loop must continue supervisor reconciliation when cancellation has not
yet reached a definitive stopped state; this controller supplies no hidden timer.

On recreation, an already released reservation reports durable release state and
never launches. A charged claimed runtime reconciles through existing supervisor
idempotency. Finalization of output transfer and recovery of unclaimed staging are
installation/application responsibilities still to be implemented and qualified.
