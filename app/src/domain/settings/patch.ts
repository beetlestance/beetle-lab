import type {
  BudgetOverrides, InstallationPatch, InstallationValues, RunDefaultOverrides,
  RunDefaultOverridePatch, ScopedOverridePatch, ScopedOverrides,
} from '@beetle/contracts/api';
import { immutableSnapshot } from '../namespaces/index.js';
import { budgetKeys } from './validation.js';

function patchBudget(current: BudgetOverrides, patch: NonNullable<RunDefaultOverridePatch['budget']>): BudgetOverrides {
  const result = { ...current };
  budgetKeys.forEach(key => {
    if (patch[key] === null) delete result[key];
    else if (patch[key] !== undefined) result[key] = patch[key];
  });
  return result;
}

function patchRunDefaults(current: RunDefaultOverrides, patch: RunDefaultOverridePatch): RunDefaultOverrides {
  const result = { ...current };
  if (patch.engineProfile === null) delete result.engineProfile;
  else if (patch.engineProfile !== undefined) result.engineProfile = patch.engineProfile;
  if (patch.budget === null) delete result.budget;
  else if (patch.budget !== undefined) {
    result.budget = patchBudget(current.budget ?? {}, patch.budget);
    if (Object.keys(result.budget).length === 0) delete result.budget;
  }
  return result;
}

export function patchScopedOverrides(current: ScopedOverrides, patch: ScopedOverridePatch): ScopedOverrides {
  const result = { ...current };
  if (patch.retention === null) delete result.retention;
  else if (patch.retention !== undefined) result.retention = patch.retention;
  if (patch.runDefaults === null) delete result.runDefaults;
  else if (patch.runDefaults !== undefined) {
    result.runDefaults = patchRunDefaults(current.runDefaults ?? {}, patch.runDefaults);
    if (Object.keys(result.runDefaults).length === 0) delete result.runDefaults;
  }
  return immutableSnapshot(result);
}

/** Installation supplied groups replace whole values; the schema allows no null. */
export function patchInstallationValues(current: InstallationValues, patch: InstallationPatch): InstallationValues {
  return immutableSnapshot({ ...current, ...patch });
}
