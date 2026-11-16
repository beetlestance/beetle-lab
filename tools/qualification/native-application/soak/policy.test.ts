import {expect, it} from 'vitest';
import {record} from '../../resources/values.js';
import {starterPolicy} from '../../../install/starter/policy.js';
import {longConfiguration, longPolicy, wallMs} from './policy.js';
it('changes only declared wall budgets and leaves the factory policy untouched', () => {
 const before = starterPolicy(); const after = longPolicy();
 expect(wallMs).toBe(1920000);
 expect(after.installationValues.perRunCeilings.timeoutMs).toBe(wallMs);
 expect(after.installationValues.runDefaults.budget.timeoutMs).toBe(wallMs);
 expect(after.agentPolicy.maxTimeoutMs).toBe(wallMs);
 expect(after.engine.manifest.defaultBudget.timeoutMs).toBe(wallMs);
 expect(after.engine.manifest.phases.find(phase => phase.phase === 'execute')!.timeoutMs).toBe(wallMs);
 const restored = structuredClone(after);
 restored.installationValues.perRunCeilings.timeoutMs = 300000;
 restored.installationValues.runDefaults.budget.timeoutMs = 300000;
 restored.agentPolicy.maxTimeoutMs = 300000; restored.engine.manifest.defaultBudget.timeoutMs = 300000;
 restored.engine.manifest.phases.find(phase => phase.phase === 'execute')!.timeoutMs = 300000;
 expect(restored).toEqual(before); expect(starterPolicy()).toEqual(before);
});
it('validates one finite1830-iteration stream with one-second useful work cadence', async () => {
 const config = await longConfiguration();
 expect(record(config.loadPlan).scenarios).toEqual([{id: 'main', name: 'Long_original', executor: 'per-vu-iterations', vus: 1,
  iterations: 1830, maxDuration: '31m', startTime: '0s', gracefulStop: '0s'}]);
 expect(config.selections).toEqual([{scenarioId: 'main', entries: [{requestId: 'get', weight: 1, wait: {durationMs: 1000, jitterMs: 0}}]}]);
});
