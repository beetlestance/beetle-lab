import type { InstallationRecord } from '../../../app/src/domain/settings/index.js';
import { validateInstallation } from '../../../app/src/domain/settings/index.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { capture, requireInput } from '../src/capture.js';

export interface MemoryChangePlan {
  readonly previousSettings: InstallationRecord;
  readonly request: ProvisionRequest;
}

/** Grow the installed per-run memory limit only. Physical capacity is not inferred. */
export function planMemoryChange(request: ProvisionRequest, settings: InstallationRecord,
  memoryBytes: number, context: ProvisionContext): MemoryChangePlan {
  const previous = capture(request, context).request;
  requireInput(Number.isSafeInteger(settings.version) && settings.version > 0 && Number.isSafeInteger(settings.version + 1));
  requireInput(Number.isSafeInteger(memoryBytes) && memoryBytes > previous.installationValues.perRunCeilings.memoryBytes);
  requireInput(memoryBytes > settings.values.perRunCeilings.memoryBytes);
  requireInput(memoryBytes <= previous.agentPolicy.pool.memoryBytes);
  requireInput(Number.isSafeInteger(previous.engine.catalogVersion + 1));
  if (previous.exportEngine) requireInput(Number.isSafeInteger(previous.exportEngine.catalogVersion + 1));
  const installationValues = structuredClone(settings.values);
  installationValues.perRunCeilings.memoryBytes = memoryBytes;
  installationValues.runDefaults.budget.memoryBytes = memoryBytes;
  const agentPolicy = structuredClone(previous.agentPolicy);
  agentPolicy.perRun.memoryBytes = memoryBytes;
  validateInstallation(installationValues, { pool: previous.installationValues.pool,
    perRun: { ...previous.installationValues.perRunCeilings, memoryBytes },
    supportedProfiles: previous.installationValues.supportedProfiles });
  const next = capture({ ...previous, installationValues, agentPolicy,
    engine: { ...previous.engine, catalogVersion: previous.engine.catalogVersion + 1 },
    ...(previous.exportEngine ? { exportEngine: { ...previous.exportEngine,
      catalogVersion: previous.exportEngine.catalogVersion + 1 } } : {}) }, context).request;
  return Object.freeze({ previousSettings: structuredClone(settings), request: next });
}
