import { join } from 'node:path';
import type { Offer, StandaloneExportAssignment } from '@beetle/contracts';
import type { Reservation } from '../admission/index.js';
import type { Catalog } from '../catalog/index.js';
import { prepareRuntime, runtimeName } from '../backends/docker/index.js';
import type { RuntimePlan } from '../backends/docker/index.js';
import type { Journal } from '../journal/index.js';
import { JournalError } from '../journal/index.js';
import type { Scope } from '../admission/index.js';
import { InstallationError } from './types.js';
export async function allocation(journal: Journal, key: Scope): Promise<Reservation | null> {
  try {
    const value = await journal.admission({ kind: 'reservation', key });
    if (!('status' in value)) throw new InstallationError('journal');
    return value;
  } catch (error) {
    if (error instanceof JournalError && error.code === 'not_found') return null;
    throw error;
  }
}
export function recover(catalog: Catalog, offer: Offer, current: Reservation, assignment?: StandaloneExportAssignment | null): RuntimePlan {
  const engine = catalog.resolve(offer, current.validation,assignment);
  const name = runtimeName({ ...current, installationId: engine.profile.installationId });
  const root = join(engine.profile.stagingRoot, name);
  const plan = prepareRuntime({ offer, manifest: engine.manifest, profile: engine.profile,
    generation: current.generation, ...(assignment ? {assignment:{purpose:'standalone_export',assignmentDigest:assignment.assignmentDigest}} : {}), staged: { input: join(root, 'input'), output: join(root, 'output'), secrets: join(root, 'secrets') } });
  if (!plan.ok || plan.value.specDigest !== current.specDigest) throw new InstallationError('catalog');
  return plan.value;
}
