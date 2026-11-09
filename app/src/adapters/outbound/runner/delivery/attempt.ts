import { encodeCanonicalJson, encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { AttemptSnapshot, ClientResult } from '@beetle/contracts';
import { getRun } from '../../../../application/runs/index.js';
import type { DispatchClaim, DispatchKey, DispatchStore } from '../../../../ports/dispatch.js';
import type { DeliveryRuntimeOptions } from '../../../../ports/delivery.js';
import type { RunnerAttemptClient } from '../../../../ports/runner.js';

export interface DeliveryOperations {
  store: DispatchStore;
  runs: DeliveryRuntimeOptions['runs'];
  attempt: DeliveryRuntimeOptions['gateway']['attempt'];
  signal: AbortSignal;
  stopped(): boolean;
}
function sameKey(actual: DispatchKey, expected: DispatchKey): void {
  if (encodeCanonicalJson(actual, 1024) !== encodeCanonicalJson(expected, 1024)) throw new Error('Invalid delivery identity');
}
function claimValue(input: DispatchClaim, expected: DispatchKey): DispatchClaim {
  const value = JSON.parse(encodeJson(input, 65_536)) as DispatchClaim;
  if (value.kind === 'blocked') return value;
  if (!['claimed', 'replay', 'acknowledged'].includes(value.kind)
    || typeof value.journalAuthority !== 'string' || value.journalAuthority !== value.journalAuthority.toLowerCase()
    || !validatePrimitive('uuid', value.journalAuthority).ok) throw new Error('Invalid delivery claim');
  if (value.kind !== 'acknowledged') sameKey(value.key, expected);
  return value;
}
function checked(result: ClientResult<AttemptSnapshot>): ClientResult<AttemptSnapshot> {
  if (!result.ok && result.error.kind === 'request') throw new Error('Invalid delivery request');
  return result;
}
function absent(result: ClientResult<AttemptSnapshot>, key: DispatchKey): boolean {
  if (result.ok || result.error.kind !== 'protocol' || result.error.status !== 404) return false;
  const error = validate('ProtocolError', result.error.protocol);
  if (!error.ok) return false;
  const value = error.value;
  return value.reason === 'attempt_not_found' && value.attemptId === key.attempt.attemptId
    && value.organizationId === key.attempt.organizationId && value.workspaceId === key.attempt.workspaceId;
}
async function currentRun(operations: DeliveryOperations, key: DispatchKey) {
  const run = await getRun({ id: key.runId, scope: { kind: 'workspace',
    organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId } }, operations.runs);
  if (run.activeAttemptId !== key.attempt.attemptId) throw new Error('Invalid delivery active attempt');
  return run;
}
function terminal(state: string): boolean {
  return ['finished', 'cancelled', 'errored'].includes(state);
}
function clientMethods(client: RunnerAttemptClient) {
  return { offer: client.offer.bind(client), snapshot: client.snapshot.bind(client), cancel: client.cancel.bind(client) };
}
type Client = ReturnType<typeof clientMethods>;
interface Receipt {
  operations: DeliveryOperations;
  key: DispatchKey;
  authority: string;
  client: Client;
}
async function observe(result: ClientResult<AttemptSnapshot>, receipt: Receipt): Promise<void> {
  checked(result);
  if (!result.ok) return;
  const { operations, key, authority, client } = receipt;
  // Positive originals remain in our custody even after synchronous close.
  await operations.store.observe({ key, journalAuthority: authority, snapshot: result.value });
  if (operations.stopped()) return;
  const run = await currentRun(operations, key);
  if (operations.stopped() || !(run.cancellationRequested || run.state === 'cancelled')) return;
  const attempt = key.attempt;
  const cancellation = checked(await client.cancel({ protocolVersion: '1.0', organizationId: attempt.organizationId,
    workspaceId: attempt.workspaceId, attemptId: attempt.attemptId, generation: 1 }, operations.signal));
  if (cancellation.ok) await operations.store.observe({ key, journalAuthority: authority, snapshot: cancellation.value });
}

async function reconcile(receipt: Receipt, acknowledged: boolean): Promise<boolean> {
  const { operations, client, key } = receipt;
  const snapshot = checked(await client.snapshot(operations.signal));
  if (snapshot.ok) { await observe(snapshot, receipt); return false; }
  return !operations.stopped() && !acknowledged && absent(snapshot, key);
}
async function mayStart(operations: DeliveryOperations, key: DispatchKey): Promise<boolean> {
  if (operations.stopped()) return false;
  const run = await currentRun(operations, key);
  return !operations.stopped() && !run.cancellationRequested && !terminal(run.state);
}

/** Storage alone owns claim/merge/release; this owner delivers one original. */
export async function deliver(operations: DeliveryOperations, key: DispatchKey): Promise<void> {
  const original = await operations.store.readOffer(key);
  if (operations.stopped()) return;
  sameKey(original.key, key);
  const claim = claimValue(await operations.store.claim(key), key);
  if (operations.stopped() || claim.kind === 'blocked') return;
  const client = clientMethods(operations.attempt({ ...key.attempt, journalAuthority: claim.journalAuthority }));
  const receipt: Receipt = { operations, key, authority: claim.journalAuthority, client };
  if (claim.kind !== 'claimed' && !await reconcile(receipt, claim.kind === 'acknowledged')) return;
  if (!await mayStart(operations, key)) return;
  await observe(checked(await client.offer(original.offer, operations.signal)), receipt);
}
