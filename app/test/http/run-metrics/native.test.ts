import { expect, it } from 'vitest';
import { unlink } from 'node:fs/promises';
import { createRunMetricsService } from '../../../src/application/run-metrics/index.js';
import { nativeFixture } from '../../run-metrics/native-fixture.js';
import { digest } from '../../run-metrics/fixture.js';
import { httpFixture } from './fixture.js';
it('serves exact wrapper history through native publication, actual metadata, auth TCP and generated client without mutating charges/events', async () => {
  const f = await nativeFixture();
  const service = createRunMetricsService({artifacts: f.reader, bytes: f.files.store, createDigest: digest});
  let http: Awaited<ReturnType<typeof httpFixture>> | undefined;
  const params = {organizationId: f.key.attempt.organizationId, workspaceId: f.key.attempt.workspaceId, runId: f.key.runId, attemptId: f.key.attempt.attemptId};
  try {
    http = await httpFixture(service);
    const before = f.facts();
    const catalogue = await http.client.listRunMetricSeries({params, query: {limit: 100}});
    expect(catalogue.ok).toBe(true); if (!catalogue.ok) throw new Error('Catalogue failed');
    expect(catalogue.value).toMatchObject({windows: 3, totalSeries: 1, availability: 'ready'});
    expect(catalogue.value.items[0]!.total).toMatchObject({kind: 'trend', count: 3, mean: 3});
    const newest = await http.client.getRunMetricSamples({params, query: {seriesOrdinal: 0, limit: 2}});
    expect(newest.ok, JSON.stringify(newest)).toBe(true); if (!newest.ok) throw new Error('Sample read failed');
    expect(newest.value.items.map(p => p.windowOrdinal)).toEqual([2, 3]);
    const older = await http.client.getRunMetricSamples({params, query: {seriesOrdinal: 0, limit: 2, cursor: newest.value.nextCursor!}});
    expect(older.ok && older.value.items.map(p => p.windowOrdinal)).toEqual([1]);
    const range = await http.client.getRunMetricSamples({params, query: {seriesOrdinal: 0, limit: 100, fromTimeMs: 1800000001000, toTimeMs: 1800000006000}});
    expect(range.ok && range.value.items.map(p => p.windowOrdinal)).toEqual([2]);
    expect(f.facts()).toEqual(before);
    const url = `${http.origin}/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/metrics`;
    expect((await fetch(url + '?limit=100')).status).toBe(401);
    const foreign = await http.client.listRunMetricSeries({params: {...params, organizationId: '00000000-0000-4000-8000-000000000999'}, query: {limit: 100}});
    expect(foreign).toMatchObject({ok: false, error: {kind: 'protocol', status: 404}});
    const data = f.source.descriptors.find(a => a.kind === 'metric-windows')!;
    const record = await f.reader.getRunArtifact({id: f.source.query.id, scope: f.source.query.scope, attemptId: f.source.query.attemptId, artifactId: data.artifactId}); await unlink(f.files.path(record, true));
    const missing = await http.client.getRunMetricSamples({params, query: {seriesOrdinal: 0, limit: 100}});
    expect(missing).toMatchObject({ok: false, error: {kind: 'protocol', status: 503}});
    expect(f.facts()).toEqual(before);
  } finally {
    try {await http?.close();}
    finally {try {await service.close();} finally {await f.files.dispose();}}
  }
});
