import { performance } from 'node:perf_hooks';
import type { Observation, Operation } from '../backends/docker/index.js';
import { validateReleasedReservation } from './identity.js';
import { SupervisorError } from './types.js';
import type { BackendPort, JournalPort, LaunchInput } from './types.js';

/** Read-only recovery, after all actual actor lanes drain. No clock gate or event capture. */
export async function inspectReleased(input: { journal: JournalPort; backend: BackendPort;
  launch: LaunchInput; operation: Operation }): Promise<void> {
  const { journal, backend, launch, operation } = input;
  checkBudget(operation);
  const snapshot = await journal.get(launch.key);
  if (snapshot.admission?.state !== 'released' || snapshot.admission.disposition !== 'settled') {
    throw new SupervisorError('conflict');
  }
  const current = await journal.admission({ kind: 'reservation', key: launch.key });
  if (!('status' in current)) throw new SupervisorError('conflict');
  const offer = await journal.readOffer(launch.key);
  validateReleasedReservation(launch, current, offer);
  checkBudget(operation);
  const view = await inspect(backend, launch, operation);
  checkBudget(operation);
  // Missing is meaningful only with the exact validated release and fenced actor.
  if (view.state === 'missing') return;
  if (!('id' in view) || view.id !== current.runtimeId || !['created', 'exited'].includes(view.state)) {
    throw new SupervisorError('backend_unavailable');
  }
}
async function inspect(backend: BackendPort, launch: LaunchInput, operation: Operation): Promise<Observation> {
  try { return await backend.inspect(launch.plan, operation); }
  catch { throw new SupervisorError('backend_unavailable'); }
}
function checkBudget(operation: Operation): void {
  if (!Number.isFinite(operation.deadline) || performance.now() >= operation.deadline || operation.signal?.aborted) {
    throw new SupervisorError('backend_unavailable');
  }
}
