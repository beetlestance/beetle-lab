import { executionArtifacts } from '@beetle/contracts';
import { expect, it } from 'vitest';
import { OutputTransferError } from '../../src/output-transfer/index.js';
import { deliveryFixture } from '../output-delivery/fixtures.js';
import { operation, ranges, reader, request, track, turns, until } from './fixtures.js';
const f = deliveryFixture();
async function ready() {
  const e = await f.ready(); await e.journal.closeOutputDelivery(e.receipt);
  return { ...e, artifact: executionArtifacts(e.source.manifest.result)[0]! };
}
it.each(['result', 'quiet', 'close'] as const)('sanitizes rejected native %s while retaining every other cleanup original', async rejected => {
  const e = await ready(); const r = reader(e.journal, ranges(false));
  const pending = track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), operation())); await until(() => r.originals.length === 1);
  const work = r.originals[0]!; const error = new Error('/private/synthetic-root/native failure');
  if (rejected === 'result') work.result.reject(error); else work.result.resolve({ ok: true, value: new Uint8Array(32) });
  await until(() => work.close.mock.calls.length === 1);
  if (rejected === 'quiet') work.quiet.reject(error); else work.quiet.resolve();
  let settled = false; void pending.catch(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  if (rejected === 'close') work.closed.reject(error); else work.closed.resolve();
  await expect(pending).rejects.toBeInstanceOf(OutputTransferError);
  await expect(pending).rejects.toMatchObject({ code: 'unavailable', message: 'Output transfer unavailable' });
  expect(r.gate.status().leases).toBe(rejected === 'result' ? 0 : 1);
  if (rejected === 'close') await expect(r.service.source(e.key, operation())).rejects.toMatchObject({ code: 'busy' });
});

