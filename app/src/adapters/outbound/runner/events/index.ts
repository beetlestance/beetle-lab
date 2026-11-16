import { captureEventBinding, EventBatchError, prepareEventBatch } from '../../../../domain/events/index.js';
import type { EventBinding, PreparedEventBatch } from '../../../../domain/events/index.js';
import type { EventCursorState, EventCustodyStore } from '../../../../ports/events.js';
import type { RunnerAttemptClient, RunnerGateway } from '../../../../ports/runner.js';
import { ackReceipt, reply } from './replies.js';
import { ingested, invalid, progress, state } from './state.js';

export interface EventOperations {
  store: EventCustodyStore;
  attempt: RunnerGateway['attempt'];
  signal: AbortSignal;
  stopped(): boolean;
}
function capture(operations: EventOperations) {
  const { store, signal } = operations;
  return { load: store.load.bind(store), ingest: store.ingest.bind(store), confirmAck: store.confirmAck.bind(store),
    recordProblem: store.recordProblem.bind(store), attempt: operations.attempt.bind(operations),
    signal, stopped: operations.stopped.bind(operations) };
}
type Operations = ReturnType<typeof capture>;
function clientMethods(client: RunnerAttemptClient) {
  return { events: client.events.bind(client), ack: client.ack.bind(client) };
}
type Client = ReturnType<typeof clientMethods>;
async function recordProblem(operations: Operations, result: ReturnType<typeof reply>, prior: EventCursorState): Promise<void> {
  if (result.ok || !result.problem) return;
  const current = state(await operations.recordProblem(result.problem), prior.binding);
  progress(current, prior);
}
async function acknowledge(operations: Operations, client: Client, current: EventCursorState, through: number): Promise<void> {
  if (operations.stopped() || current.blockedReason !== null || through <= current.ackConfirmedThrough) return;
  const binding = current.binding;
  const { organizationId, workspaceId, attemptId, generation } = binding.key.attempt;
  const result = reply(await client.ack({ protocolVersion: '1.0', organizationId, workspaceId,
    attemptId, generation, throughSeq: through }, operations.signal), binding, current.durableThrough);
  if (!result.ok) return recordProblem(operations, result, current);
  const receipt = ackReceipt(result.value, binding, through, current.durableThrough);
  // A positive original ACK keeps confirmation custody after synchronous close.
  const confirmed = state(await operations.confirmAck({ binding, throughSeq: through, receipt }), binding);
  progress(confirmed, current);
  if (confirmed.ackConfirmedThrough < receipt.acknowledgedSeq) return invalid();
}
function prepare(binding: EventBinding, after: number, batch: unknown): PreparedEventBatch | undefined {
  try { return prepareEventBatch({ binding, after, batch }); }
  catch (error) {
    if (error instanceof EventBatchError && error.code === 'sequence_gap') return;
    throw error;
  }
}

/** One bounded original turn. Positive batch/ACK custody survives abort and stop. */
export async function collectEvents(input: EventOperations, original: EventBinding): Promise<void> {
  const operations = capture(input);
  const binding = captureEventBinding(original);
  const current = state(await operations.load(binding), binding);
  if (operations.stopped() || current.blockedReason !== null) return;
  const client = clientMethods(operations.attempt({ ...binding.key.attempt, journalAuthority: binding.journalAuthority }));
  if (current.ackConfirmedThrough < current.durableThrough) {
    return acknowledge(operations, client, current, current.durableThrough);
  }
  if (operations.stopped()) return;
  const result = reply(await client.events(current.durableThrough, operations.signal), binding, current.durableThrough);
  if (!result.ok) return recordProblem(operations, result, current);
  const prepared = prepare(binding, current.durableThrough, result.value);
  if (!prepared) return;
  // Do not discard received positive evidence when close races GET or ingestion.
  const committed = ingested(await operations.ingest({ binding, after: current.durableThrough, batch: result.value }), current, prepared);
  await acknowledge(operations, client, committed.state, committed.ackThrough);
}
