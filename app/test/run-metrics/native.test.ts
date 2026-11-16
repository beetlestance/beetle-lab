import { expect, it } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import { digest, context } from './fixture.js';
it('reads native metadata and exact sealed source gaps without changing custody facts', async () => {
  const f = await nativeFixture(); const s = createRunMetricsService({artifacts: f.reader, bytes: f.files.store, createDigest: digest});
  try {
    const before = f.facts();
    expect(await s.reader.listRunMetricSeries(f.source.query, context())).toMatchObject({availability: 'ready', windows: 3});
    const page = await s.reader.getRunMetricSamples({...f.source.query, seriesOrdinal: 0, limit: 2}, context());
    expect(page.items.map(p => p.windowOrdinal)).toEqual([2, 3]); expect(f.facts()).toEqual(before);
  } finally {await s.close(); await f.files.dispose();}
});
