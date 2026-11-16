import type { Budget, InstallationValues, PoolCapacity, RetentionPolicy, RunDefaults } from '@beetle/contracts/api';
import { immutableSnapshot, requireRule } from '../namespaces/index.js';

export const budgetKeys = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;
const poolKeys = ['cpuMillis', 'memoryBytes', 'pids', 'outputBytes', 'concurrency', 'storageBytes'] as const;
const pooledBudgetKeys = ['cpuMillis', 'memoryBytes', 'pids', 'outputBytes'] as const;

/** Caller-reported current capacity; null means unknown, never an invented host size.
 * Accounting limits do not assert hard enforcement of output/storage by a runtime.
 */
export interface RuntimeCeilings {
  pool: PoolCapacity;
  perRun: Budget;
  supportedProfiles: readonly string[];
}

export function safeInteger(value: number, minimum = 1): void {
  requireRule(Number.isSafeInteger(value) && value >= minimum);
}

export function safeSum(a: number, b: number): number {
  safeInteger(a, 0); safeInteger(b, 0);
  const result = a + b;
  safeInteger(result, 0);
  return result;
}

export function validateRetention(policy: RetentionPolicy): void {
  if (policy.mode === 'manual') return;
  const rules = [policy.ageDays, policy.completedRunCount, policy.storageBytes];
  requireRule(rules.some(value => value !== undefined));
  rules.forEach(value => { if (value !== undefined) safeInteger(value); });
  if (policy.ageDays !== undefined) requireRule(policy.ageDays <= 365000);
}

export function validateBudget(budget: Budget, ceilings: Budget): void {
  budgetKeys.forEach(key => {
    safeInteger(budget[key]); safeInteger(ceilings[key]);
    requireRule(budget[key] <= ceilings[key]);
  });
}

export function validateRunDefaults(defaults: RunDefaults, values: InstallationValues): void {
  requireRule(values.supportedProfiles.includes(defaults.engineProfile));
  validateBudget(defaults.budget, values.perRunCeilings);
}

export function validateInstallation(values: InstallationValues, runtime: RuntimeCeilings | null): void {
  requireRule(runtime != null, 'capacity_unavailable');
  requireRule(runtime.supportedProfiles.length >= 1 && runtime.supportedProfiles.length <= 32, 'capacity_unavailable');
  poolKeys.forEach(key => {
    safeInteger(values.pool[key]); safeInteger(runtime.pool[key]);
    requireRule(values.pool[key] <= runtime.pool[key], 'capacity_unavailable');
  });
  safeInteger(values.pool.freeSpaceReserveBytes, 0);
  safeInteger(runtime.pool.freeSpaceReserveBytes, 0);
  requireRule(values.pool.freeSpaceReserveBytes <= runtime.pool.freeSpaceReserveBytes, 'capacity_unavailable');
  // Allocation includes the reserve; retained output must leave that reserve free.
  requireRule(safeSum(values.pool.outputBytes, values.pool.freeSpaceReserveBytes) <= values.pool.storageBytes);
  validateBudget(values.perRunCeilings, runtime.perRun);
  pooledBudgetKeys.forEach(key => requireRule(values.perRunCeilings[key] <= values.pool[key]));
  requireRule(values.supportedProfiles.length >= 1 && values.supportedProfiles.length <= 32);
  requireRule(new Set(values.supportedProfiles).size === values.supportedProfiles.length);
  values.supportedProfiles.forEach(profile => {
    requireRule(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(profile));
    requireRule(runtime.supportedProfiles.includes(profile), 'capacity_unavailable');
  });
  validateRunDefaults(values.runDefaults, values);
  validateRetention(values.retention);
}

/** Setup chooses manual retention unless an explicit validated policy was supplied. */
export function installationDefaults(values: Omit<InstallationValues, 'retention'> &
  { retention?: RetentionPolicy }): InstallationValues {
  return immutableSnapshot({ ...values, retention: values.retention ?? { mode: 'manual' } });
}

/** Inform admission that lower aggregate limits require drain, never terminate work. */
export function poolLowered(previous: PoolCapacity, next: PoolCapacity): boolean {
  return poolKeys.some(key => next[key] < previous[key]) ||
    next.freeSpaceReserveBytes > previous.freeSpaceReserveBytes;
}
