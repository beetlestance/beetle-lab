import { expect, it } from 'vitest';
import { fixture, metric, context } from './fixture.js';
it('refuses a peer lookup returning a different alias from the remapped logical selection', async () => {
  const f = fixture(); const config = f.config(1);
  config.requests = [{...structuredClone(config.requests[0]!), id: 'other', name: 'other', assertions: []}, ...config.requests]; f.repin(1);
  const read = f.options.metrics.lookupRunMetricSeries;
  f.options.metrics.lookupRunMetricSeries = async (query, c) => {
    const result = await read(query, c);
    if (query.id === f.request.runIds[1]) return {...result, series: {...result.series!, tags: {phase: 'execute', request: 'r0'}}};
    return result;
  };
  const service = f.service();
  try {await expect(service.compare({...f.request, metric}, context())).rejects.toMatchObject({code: 'unavailable'});}
  finally {await service.close();}
});
it('refuses pinned revision content changed during source reads even with the same declared digest', async () => {
  const f = fixture(); const original = f.options.suites.getRevision; let calls = 0;
  f.options.suites.getRevision = async key => {
    const value = await original(key); calls++;
    return calls > 2 ? {...value, config: {...value.config, target: 'http://replaced.invalid'}} : value;
  };
  const service = f.service();
  try {await expect(service.compare(f.request, context())).rejects.toMatchObject({code: 'conflict'});}
  finally {await service.close();}
});

it('refuses equal pinned digests carrying different captured configuration content', async () => {
  const f = fixture(); f.config(1).target = 'http://contradictory.invalid'; const service = f.service();
  try {await expect(service.compare(f.request, context())).rejects.toMatchObject({code: 'unavailable'});}
  finally {await service.close();}
});
type Fixture = ReturnType<typeof fixture>;
const corruptions: Record<string, (f: Fixture) => void> = {
  active: f => {f.runs.get(f.request.runIds[1]!)!.state = 'active';},
  namespace: f => {f.runs.get(f.request.runIds[1]!)!.scope.workspaceId = '00000000-0000-4000-8000-000000000999';},
  revision: f => {f.revisions.get(f.runs.get(f.request.runIds[1]!)!.revisionId)!.digest = 'f'.repeat(64);},
  suite: f => {f.revisions.get(f.runs.get(f.request.runIds[1]!)!.revisionId)!.suiteId = '00000000-0000-4000-8000-000000000999';},
  'result-scope': f => {f.results.get(f.request.runIds[1]!)!.result!.workspaceId = '00000000-0000-4000-8000-000000000999';},
  seal: f => {f.results.get(f.request.runIds[1]!)!.result!.seal.sha256 = 'f'.repeat(64);},
  generation: f => {f.results.get(f.request.runIds[1]!)!.result!.generation = 2;},
};
it.each(Object.entries(corruptions))('rejects corrupt or ineligible %s source without metric lookup', async (_kind, corrupt) => {
  const f = fixture(); corrupt(f); const service = f.service();
  try {await expect(service.compare({...f.request, metric}, context())).rejects.toThrow(); expect(f.lookups).toEqual([]);}
  finally {await service.close();}
});
it('refuses invalid selections and canonical duplicate IDs before any original read', async () => {
  const f = fixture(); const service = f.service();
  try {
    for (const runIds of [[f.request.runIds[0]!], Array<string>(5).fill(f.request.runIds[0]!), [f.request.runIds[0]!, f.request.runIds[0]!.toUpperCase()]]) {
      await expect(service.compare({...f.request, runIds}, context())).rejects.toMatchObject({code: 'invalid_input'});
    }
    expect(f.calls).toEqual([]);
    await expect(service.compare({...f.request, metric: {...metric, metric: 'unregistered_metric'}}, context())).rejects.toMatchObject({code: 'invalid_input'});
    expect(f.lookups).toEqual([]);
  } finally {await service.close();}
});
it('rejects a changed accepted budget at reconciliation even without a version increment', async () => {
  const f = fixture(); const read = f.options.runs.getRun; let count = 0;
  f.options.runs.getRun = async key => {const run = await read(key); return ++count > 2 ? {...run, budget: {...run.budget, cpuMillis: run.budget.cpuMillis + 1}} : run;};
  const service = f.service();
  try {await expect(service.compare(f.request, context())).rejects.toMatchObject({code: 'conflict'});}
  finally {await service.close();}
});
