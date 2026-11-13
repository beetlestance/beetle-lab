import { encodeCanonicalJson } from '@beetle/contracts';
import type { Reservation } from '../admission/index.js';
import type { Operation } from '../backends/docker/index.js';
import { captureRetirementIntent } from '../retirement-values/index.js';
import type { RetirementIntent } from '../retirement-values/index.js';
import type { Entry } from './entry.js';
import type { InstallationOptions } from './types.js';
import { InstallationError } from './types.js';
import { allocation, recover } from './recovery.js';
import { retireNative } from './retirement.js';
import { checkBudget } from './budget.js';
function keyFor(intent: RetirementIntent) {
  const { organizationId, workspaceId, attemptId, generation } = intent.request;
  return { organizationId, workspaceId, attemptId, generation };
}
function neverStarted(current: Reservation): void {
  const fields = [current.createToken, current.startToken, current.runtimeId, current.specDigest, current.startClaimedAt,
    current.launchSettlement, current.releaseEvidence];
  if (!current.aborted || !current.launchClosed || current.launchEpoch !== 0 || fields.some(value => value !== null)) {
    throw new InstallationError('cleanup');
  }
}
async function releasedOwnership(options: InstallationOptions, key: ReturnType<typeof keyFor>, operation: Operation) {
  const snapshot = await options.journal.get(key); checkBudget(operation);
  const current = await allocation(options.journal, key); checkBudget(operation);
  if (snapshot.admission?.state !== 'released' || current?.status !== 'released') throw new InstallationError('cleanup');
  return { admission: snapshot.admission, current };
}
/** Exact stored intent authorizes fencing only; actual owned objects and stopped inspection establish drain. */
export async function retireOutputOwners(input: { options: InstallationOptions; intent: RetirementIntent;
  operation: Operation; existing(): Entry | undefined }): Promise<void> {
  const { options, operation } = input; const intent = captureRetirementIntent(input.intent); const key = keyFor(intent);
  checkBudget(operation);
  const durable = await options.journal.retirements.read(key); checkBudget(operation);
  if (intent.namespaceIdentity !== options.gate.namespaceIdentity
    || encodeCanonicalJson(durable, 4096) !== encodeCanonicalJson(intent, 4096)) throw new InstallationError('cleanup');
  const entry = input.existing();
  if (entry) {
    entry.retiring = true; entry.cancelled = true; entry.abort.abort();
    await retireNative(entry); checkBudget(operation);
  }
  const { admission, current } = await releasedOwnership(options, key, operation); checkBudget(operation);
  if (admission.disposition === 'never_started') {
    neverStarted(current); options.supervisor.assertNoActor(key); return;
  }
  const offer = await options.journal.readOffer(key); checkBudget(operation);
  const plan = entry?.plan ?? recover(options.catalog, offer, current); checkBudget(operation);
  await options.supervisor.retireReleased({ key, plan }, operation); checkBudget(operation);
}
