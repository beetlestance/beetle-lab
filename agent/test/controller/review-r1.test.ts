import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { fixture, budget } from './fixtures.js';
import { reserved } from '../admission/fixtures.js';

const f = fixture();
for (const rejected of ['result', 'quiesced'] as const) {
  it(`keeps rejected output ${rejected} sticky, independently closes, and never releases`, async () => {
    const e = await f.setupController(); await e.controller.launch(budget()); let closes = 0;
    e.setOutput(() => ({
      result: rejected === 'result' ? Promise.reject(new Error('result original')) : Promise.resolve({ ok: false, reason: 'io' }),
      quiesced: rejected === 'quiesced' ? Promise.reject(new Error('quiesced original')) : Promise.resolve(),
      close: () => { closes++; return Promise.resolve(); },
    }));
    e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
    expect(closes).toBe(1);
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
    await expect(e.controller.close()).rejects.toMatchObject({ reason: 'cleanup' });
  });
}
it('a rejected original control quiescence independently closes and prevents all later release', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  const reader = e.readers[0]!; const original = reader.read.bind(reader);
  reader.read = input => ({ ...original(input), quiesced: Promise.reject(new Error('control quiescence')) });
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(reader.closeCalls).toBe(1);
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
});
it('clamps output verification to the nonextending remaining admitted deadline', async () => {
  const e = await f.setupController(); const started = performance.now(); await e.controller.launch(budget());
  e.time.advance(250); e.backend.observation = e.backend.known('exited').value;
  await e.controller.tick(budget());
  expect(e.collections).toHaveLength(1);
  expect(e.collections[0]!.deadline).toBeLessThanOrEqual(started + 1000 + 5);
  expect(e.collections[0]!.deadline).toBeLessThan(performance.now() + 900);
});
it('an expired attempt cannot purchase extra output time with a fresh RPC deadline', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  e.time.advance(2000); e.backend.observation = e.backend.known('exited').value;
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'failed' });
  expect(e.collections).toHaveLength(0);
  expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'failed' });
});
it('timeout before create safely aborts instead of retaining an unclaimed reservation forever', async () => {
  const e = await f.setupController(); e.time.advance(2000);
  expect(await e.controller.launch(budget())).toEqual({ kind: 'released', collection: 'failed' });
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key }))).toMatchObject({ status: 'released', aborted: true });
});
it('collector saturation defers within the same execution and later verifies without a closed-reader failure', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_collection', reason: 'busy' });
  expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  e.setOutput(undefined);
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
  expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
  expect(e.backend.starts).toBe(1);
});
for (const ambiguous of [false, true]) {
  it(`fences a ${ambiguous ? 'committed-but-unanswered' : 'rejected'} control batch and preserves safe replay`, async () => {
    const e = await f.setupController(); const commit = e.journal.commitWrapperBatch.bind(e.journal);
    const spy = vi.spyOn(e.journal, 'commitWrapperBatch').mockImplementationOnce(async request => {
      if (ambiguous) await commit(request);
      throw new JournalError(ambiguous ? 'unavailable' : 'quota_exceeded');
    });
    try {
      await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: 'journal' });
      expect((await e.journal.get(e.key)).cancelRequested).toBe(true);
      expect(e.backend.stops.length).toBeGreaterThan(0);
      expect(e.readers[0]!.pending).toBeDefined();
      e.time.advance(1);
      expect(await e.controller.tick(budget())).toEqual({ kind: 'control', events: 1 });
      expect(e.readers[0]!.pending).toBeUndefined();
      expect((await e.journal.readEvents(e.key, 0)).events.filter(event => event.source === 'wrapper')).toHaveLength(1);
      expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
    } finally { spy.mockRestore(); }
  });
}
it('a transient unknown runtime after collector deferral waits without reading the already closed control reader', async () => {
  const e = await f.setupController(); await e.controller.launch(budget());
  e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_collection', reason: 'busy' });
  const reads = e.readers[0]!.budgets.length;
  e.backend.observation = { state: 'unknown', reason: 'unavailable' };
  expect(await e.controller.tick(budget())).toMatchObject({ kind: 'runtime', state: { observation: { state: 'unknown' } } });
  expect(e.readers[0]!.budgets).toHaveLength(reads);
  e.backend.observation = e.backend.known('exited').value; e.setOutput(undefined);
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
});
