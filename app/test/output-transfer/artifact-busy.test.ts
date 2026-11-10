import { expect, it } from 'vitest';
import { fixture as transferFixture } from './controlled-fixture.js';
import { fixture, populated, advance, finish, context, deferred } from '../files/output-bytes/fixture.js';
import { OutputByteError } from '../../src/ports/output-bytes.js';
import { safeError } from '../../src/application/output-transfer/errors.js';
it('native pre-I/O busy defers transfer and reuses the retained logical writer on retry', async () => {
  const files = await fixture(); const release = deferred(); const entered = [deferred(), deferred()];
  const held = [];
  try {
    for (const [index, token] of [70, 71].entries()) {
      const value = await populated(files, Buffer.from('synthetic held read'), token);
      const published = advance(value, await finish(files.store.publish({...value, artifact: {...value.artifact, phase: 'publishing'}}, context())), 'published');
      held.push(files.store.read({record: published, start: 0, endExclusive: published.artifact.bytes,
        sink: {write: async () => {entered[index]!.resolve(); await release.promise;}}}, context()));
      await entered[index]!.promise;
    }
    const f = transferFixture(); const original = f.files.prepare.getMockImplementation()!;
    f.files.prepare.mockImplementationOnce(record => files.store.prepare(record, context()));
    const transfers = f.create();
    try {
      const first = transfers.transfer(f.binding);
      await expect(first.result).rejects.toMatchObject({code: 'busy'}); await first.settled;
      expect(f.state.kind === 'adopted' && f.state.artifacts[0]!.writer).toBe('00000000-0000-4000-8000-000000000800');
      release.resolve(); await Promise.all(held.map(finish));
      f.files.prepare.mockImplementation(original);
      const retry = transfers.transfer(f.binding); await expect(retry.result).resolves.toMatchObject({kind: 'published'}); await retry.settled;
      expect(f.options.newWriterId).toHaveBeenCalledTimes(1);
    } finally {await transfers.close();}
  } finally {release.resolve(); await Promise.all(held.map(finish)); await files.dispose();}
});
it('preserves cleanup, integrity and storage failures instead of laundering them as busy', () => {
  for (const [code, expected] of [['cleanup', 'cleanup'], ['integrity', 'integrity'], ['io', 'storage'], ['capacity_unavailable', 'storage']] as const) {
    expect(safeError(new OutputByteError(code)).code).toBe(expected);
  }
});
