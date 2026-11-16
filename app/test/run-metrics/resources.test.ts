import { expect, it } from 'vitest';
import { resourceFixture } from './resource-fixture.js';
import { context } from './fixture.js';
it('streams an index larger than64KiB and advances absent-series windows without filling a page', async () => {
  const f = await resourceFixture(2000, 1, true); const service = f.service();
  try {
    expect(f.descriptors.find(a => a.kind === 'metric-index')!.bytes).toBeGreaterThan(65536);
    const page = await service.reader.getRunMetricSamples({...f.query, seriesOrdinal: 0, limit: 100}, context());
    expect(page.examined).toBe(100); expect(page.items).toHaveLength(50); expect(page.firstWindow).toBe(1901);
    expect(page.items.map(p => p.windowOrdinal)).toEqual(Array.from({length: 50}, (_, i) => 1902 + i * 2));
  } finally {await service.close();}
});
it('keeps newest contiguous suffix under8MiB and uses one selected native data range', async () => {
  const f = await resourceFixture(100, 512); const service = f.service(); const data = f.descriptors.find(a => a.kind === 'metric-windows')!;
  try {
    expect(data.bytes).toBeGreaterThan(8388608);
    const page = await service.reader.getRunMetricSamples({...f.query, seriesOrdinal: 0, limit: 100}, context());
    expect(page.examined).toBeLessThan(100); expect(page.items.at(-1)!.windowOrdinal).toBe(100); expect(page.nextCursor).not.toBeNull();
    const selected = f.reads.filter(r => r.id === data.artifactId && r.start > 1024 && r.end - r.start > 256);
    expect(selected).toHaveLength(1); expect(selected[0]!.end - selected[0]!.start).toBeLessThanOrEqual(8388608);
  } finally {await service.close();}
});
