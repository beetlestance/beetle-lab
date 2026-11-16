import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { settingsFixture } from '../storage/fixture.js';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
const fixture = runFixture(10_000_000);
it('wires scoped read-only comparisons into the actual application and closes all shared owners', async () => {
  const {app} = await fixture.open();
  try {
    const {api} = await client(app); const saved = await savedSuite(api); const runIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const run = value(await api.createRun({params: saved.params, body: {scope: saved.scope, requestId: randomUUID(),
        revisionId: saved.pinned.id, engineProfile: 'standard', budget: settingsFixture().chain.installation.values.runDefaults.budget,
        executionPolicy: {mode: 'parallel', preferIdle: false}}}));
      runIds.push(run.id);
      const cancelled = value(await api.cancelRun({params: {...saved.params, runId: run.id}, body: {scope: saved.scope, requestId: randomUUID()}}));
      expect(cancelled.state).toBe('cancelled');
    }
    const comparison = value(await api.compareRuns({params: saved.params, body: {scope: saved.scope, runIds, metric: null}}));
    expect(comparison.items.map(item => item.run.id)).toEqual(runIds);
    expect(comparison.items.every(item => item.result === null && item.metric.availability === 'not_requested')).toBe(true);
    expect(comparison.items.every(item => item.warnings.includes('missing_result'))).toBe(true);
  } finally {await fixture.close(app);}
});
