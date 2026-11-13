import { executionArtifacts } from '@beetle/contracts';
import { expect, it, vi } from 'vitest';
import type { OutputRangeReader } from '../../src/collection/output/index.js';
import { deliveryFixture } from '../output-delivery/fixtures.js';
import { operation, reader, request, track } from './fixtures.js';
const f = deliveryFixture();
it('retains factory uncertainty and both global source credits instead of retrying unknown IO', async () => {
  const e = await f.ready(); await e.journal.closeOutputDelivery(e.receipt); const artifact = executionArtifacts(e.source.manifest.result)[0]!;
  const readRange = vi.fn<OutputRangeReader>(() => { throw new Error('unknown issued native factory'); });
  const r = reader(e.journal, { readRange, originals: [] });
  await expect(track(r.service.chunk(e.key, request(e.receipt, artifact.artifactId), operation())))
    .rejects.toMatchObject({ code: 'unavailable' });
  await expect(r.service.chunk(e.key, request(e.receipt, artifact.artifactId), operation())).rejects.toMatchObject({ code: 'unavailable' });
  expect(r.gate.status().leases).toBe(1); expect(readRange).toHaveBeenCalledTimes(1);
  const second = await f.ready(); await second.journal.closeOutputDelivery(second.receipt);
  const r2 = reader(second.journal, { readRange, originals: [] });
  await expect(track(r2.service.chunk(second.key, request(second.receipt, artifact.artifactId), operation())))
    .rejects.toMatchObject({ code: 'unavailable' });
  await expect(r.service.source(e.key, operation())).rejects.toMatchObject({ code: 'busy' });
  expect(readRange).toHaveBeenCalledTimes(2);
});
