import type { InstallationRecord } from '../../../app/src/domain/settings/index.js';
import { validateInstallation } from '../../../app/src/domain/settings/index.js';
import type { ProvisionContext, ProvisionRequest } from '../types.js';
import { capture, requireInput } from '../src/capture.js';

export interface CapacityChangePlan {
  readonly previousSettings: InstallationRecord;
  readonly request: ProvisionRequest;
}

/** Grow the installed per-run memory limit only. Physical capacity is not inferred. */
export function planMemoryChange(
  request: ProvisionRequest,
  settings: InstallationRecord,
  memoryBytes: number,
  context: ProvisionContext,
): CapacityChangePlan {
  const previous = capture(request, context).request;
  requireInput(
    Number.isSafeInteger(memoryBytes) && memoryBytes > previous.installationValues.perRunCeilings.memoryBytes,
  );
  requireInput(memoryBytes > settings.values.perRunCeilings.memoryBytes);
  requireInput(memoryBytes <= previous.agentPolicy.pool.memoryBytes);
  const installationValues = structuredClone(settings.values);
  installationValues.perRunCeilings.memoryBytes = memoryBytes;
  installationValues.runDefaults.budget.memoryBytes = memoryBytes;
  const agentPolicy = structuredClone(previous.agentPolicy);
  agentPolicy.perRun.memoryBytes = memoryBytes;
  validateInstallation(installationValues, {
    pool: previous.installationValues.pool,
    perRun: { ...previous.installationValues.perRunCeilings, memoryBytes },
    supportedProfiles: previous.installationValues.supportedProfiles,
  });
  return finishPlan(previous, settings, { ...previous, installationValues, agentPolicy }, context);
}

/** Grow only the aggregate output quota; storage allocation and per-run budgets stay fixed. */
export function planOutputPoolChange(
  request: ProvisionRequest,
  settings: InstallationRecord,
  outputBytes: number,
  context: ProvisionContext,
): CapacityChangePlan {
  const previous = capture(request, context).request;
  requireInput(Number.isSafeInteger(outputBytes) && outputBytes > previous.installationValues.pool.outputBytes);
  requireInput(outputBytes > previous.agentPolicy.pool.outputBytes && outputBytes > settings.values.pool.outputBytes);
  const installationValues = structuredClone(settings.values);
  installationValues.pool.outputBytes = outputBytes;
  const agentPolicy = structuredClone(previous.agentPolicy);
  agentPolicy.pool.outputBytes = outputBytes;
  validateInstallation(installationValues, {
    pool: { ...previous.installationValues.pool, outputBytes },
    perRun: previous.installationValues.perRunCeilings,
    supportedProfiles: previous.installationValues.supportedProfiles,
  });
  return finishPlan(previous, settings, { ...previous, installationValues, agentPolicy }, context);
}

function finishPlan(
  previous: ProvisionRequest,
  settings: InstallationRecord,
  request: ProvisionRequest,
  context: ProvisionContext,
): CapacityChangePlan {
  requireInput(
    Number.isSafeInteger(settings.version) && settings.version > 0 && Number.isSafeInteger(settings.version + 1),
  );
  requireInput(Number.isSafeInteger(previous.engine.catalogVersion + 1));
  if (previous.exportEngine) requireInput(Number.isSafeInteger(previous.exportEngine.catalogVersion + 1));
  const next = capture(
    {
      ...request,
      engine: { ...previous.engine, catalogVersion: previous.engine.catalogVersion + 1 },
      ...(previous.exportEngine
        ? { exportEngine: { ...previous.exportEngine, catalogVersion: previous.exportEngine.catalogVersion + 1 } }
        : {}),
    },
    context,
  ).request;
  return Object.freeze({ previousSettings: structuredClone(settings), request: next });
}
