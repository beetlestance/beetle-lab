import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { captureRunMetricSamplesCursor, runMetricSamplesPageMatches } from '@beetle/contracts/api';
import { fixture, context, rewrite, rebindPair } from './fixture.js';
it('reads exact wrapper values, reverse pages, gaps and whole-run estimates with one contiguous data job', async () => {
  const f = await fixture(); const s = f.service();
  try {
    const catalogue = await s.reader.listRunMetricSeries(f.query, context());
    expect(catalogue).toMatchObject({availability: 'ready', windows: 3, totalSeries: 1, coverage: {complete: true}});
    expect(catalogue.items[0]!.total).toMatchObject({kind: 'trend', count: 3, mean: 3});
    const q = {...f.query, seriesOrdinal: 0, limit: 2};
    const first = await s.reader.getRunMetricSamples(q, context());
    expect(first.items.map(p => p.windowOrdinal)).toEqual([2, 3]); expect(first.examined).toBe(2);
    expect(first.items.map(p => p.startTimeMs)).toEqual([1800000003000, 1800000006000]);
    expect(captureRunMetricSamplesCursor(first.nextCursor!).beforeWindow).toBe(1);
    expect(first.items[0]!.value).toMatchObject({kind: 'trend', percentiles: {p95: {estimate: 3, lower: 3, upper: 3}}});
    expect(runMetricSamplesPageMatches(first, q)).toBe(true);
    const second = await s.reader.getRunMetricSamples({...q, cursor: first.nextCursor!}, context());
    expect(second.items.map(p => p.windowOrdinal)).toEqual([1]); expect(second.nextCursor).toBeNull();
    const dataId = f.descriptors.find(a => a.kind === 'metric-windows')!.artifactId;
    expect(f.reads.filter(r => r.id === dataId && r.start > 0 && r.end - r.start > 256)).toHaveLength(2);
  } finally {await s.close();}
});
it('uses overlap boundaries, whole buckets and exhausted empty ranges without invented zero', async () => {
  const f = await fixture(); const s = f.service();
  try {
    const page = await s.reader.getRunMetricSamples({...f.query, seriesOrdinal: 0, fromTimeMs: 1800000000500, toTimeMs: 1800000003000}, context());
    expect(page.items.map(p => p.windowOrdinal)).toEqual([1]); expect(page.items[0]!.startTimeMs).toBe(1800000000000);
    const empty = await s.reader.getRunMetricSamples({...f.query, seriesOrdinal: 0, fromTimeMs: 1800000001000, toTimeMs: 1800000003000}, context());
    expect(empty.items).toEqual([]); expect(empty.examined).toBe(0); expect(empty.nextCursor).toBeNull();
    await expect(s.reader.getRunMetricSamples({...f.query, seriesOrdinal: 1}, context())).rejects.toMatchObject({code: 'not_found'});
  } finally {await s.close();}
});
it('rejects SHA, scope, pair, footer, row and sequence evidence', async () => {
  const cases: [string, (s: string) => string, boolean?][] = [
    ['numeric-final', s => s.replace('"sum":9', '"sum":8'), false],
    ['numeric-final', s => s.replace('"generation":1', '"generation":2')],
    ['metric-index', s => s.replace('"sequence":2', '"sequence":3')],
    ['metric-index', s => s.replace('"offset":', '"extra":0,"offset":')],
    ['metric-index', s => s.replace('"windows":3', '"windows":2')],
    ['metric-windows', s => s.replace('"sequence":2', '"sequence":3')],
  ];
  for (const [kind, change, hash] of cases) {
    const f = await fixture(); rewrite(f, kind, change, hash);
    if (kind === 'metric-windows' || kind === 'metric-index') rebindPair(f);
    const s = f.service();
    try {await expect(s.reader.getRunMetricSamples({...f.query, seriesOrdinal: 0}, context())).rejects.toThrow();}
    finally {await s.close();}
  }
  const f = await fixture(); f.descriptors.splice(f.descriptors.findIndex(a => a.kind === 'metric-index'), 1); const s = f.service();
  try {await expect(s.reader.listRunMetricSeries(f.query, context())).rejects.toThrow();} finally {await s.close();}
});
it('reports unsupported private version and not-recorded pair absence explicitly', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', s => s.replace('"version":3', '"version":9')); let s = f.service();
  expect(await s.reader.listRunMetricSeries(f.query, context())).toMatchObject({availability: 'unavailable', reason: 'unsupported_format', items: []}); await s.close();
  f.descriptors.splice(0, f.descriptors.length); s = f.service();
  expect(await s.reader.listRunMetricSeries(f.query, context())).toMatchObject({availability: 'unavailable', reason: 'not_recorded'}); await s.close();
});
it('distinguishes future formats with extra fields from missing malformed discriminators', async () => {
  for (const kind of ['numeric-final', 'metric-windows']) {
    const f = await fixture(); rewrite(f, kind, s => s.replace(/"version":(1|3)/, '"version":9,"future":true'));
    if (kind === 'metric-windows') {
      const data = f.descriptors.find(a => a.kind === 'metric-windows')!;
      rewrite(f, 'metric-index', text => text.split('\n').map(line => {
        if (!line) return line; const row = JSON.parse(line) as {kind?: string; dataBytes?: number; dataSha256?: string};
        if (row.kind === 'end') {row.dataBytes = data.bytes; row.dataSha256 = data.sha256;} return JSON.stringify(row);
      }).join('\n'));
      rewrite(f, 'numeric-final', text => {const v = JSON.parse(text) as {history: {bytes: number}};
        v.history.bytes = f.descriptors.filter(a => a.kind === 'metric-windows' || a.kind === 'metric-index').reduce((n, a) => n + a.bytes, 0); return JSON.stringify(v);});
    }
    const service = f.service();
    try {expect(await service.reader.listRunMetricSeries(f.query, context())).toMatchObject({availability: 'unavailable', reason: 'unsupported_format'});}
    finally {await service.close();}
  }
  const f = await fixture(); rewrite(f, 'numeric-final', s => s.replace('"version":3,', '')); const service = f.service();
  try {await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toThrow();} finally {await service.close();}
});
it('normalizes uppercase run UUIDs before binding continuation cursors', async () => {
  const f = await fixture(); f.query.id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  for (const [id, record] of f.records) f.records.set(id, {...record, binding: {...record.binding, key: {...record.binding.key, runId: f.query.id}}});
  const service = f.service(); const query = {...f.query, id: f.query.id.toUpperCase(), seriesOrdinal: 0, limit: 1};
  try {
    const first = await service.reader.getRunMetricSamples(query, context());
    const next = await service.reader.getRunMetricSamples({...query, cursor: first.nextCursor!}, context());
    expect(next.items.map(p => p.windowOrdinal)).toEqual([2]);
  } finally {await service.close();}
});
it('rejects fatal UTF8 even when the full numeric content SHA matches the published descriptor', async () => {
  const f = await fixture(); const a = f.descriptors.find(a => a.kind === 'numeric-final')!;
  const bytes = Buffer.from(f.contents.get(a.artifactId)!); bytes[0] = 255;
  f.contents.set(a.artifactId, bytes); a.sha256 = createHash('sha256').update(bytes).digest('hex');
  const record = f.records.get(a.artifactId)!; f.records.set(a.artifactId, {...record, artifact: {...record.artifact, sha256: a.sha256}});
  const service = f.service();
  try {await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toMatchObject({code: 'unavailable'});}
  finally {await service.close();}
});
it('captures closed bounded metadata before semantic matching and refuses extra publication fields', async () => {
  const f = await fixture(); const read = f.reader.listRunArtifacts.bind(f.reader);
  f.reader.listRunArtifacts = async q => ({...await read(q), privatePath: 'synthetic-forbidden'});
  const service = f.service();
  try {await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toMatchObject({code: 'unavailable'});}
  finally {await service.close();}
});
it('rejects a published descriptor kind mismatch before opening metric archive bytes', async () => {
  const f = await fixture(); const read = f.reader.getRunArtifact.bind(f.reader);
  f.reader.getRunArtifact = async key => ({...await read(key), kind: 'raw'});
  const service = f.service();
  try {
    await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toMatchObject({code: 'unavailable'});
    expect(f.reads).toEqual([]);
  } finally {await service.close();}
});
