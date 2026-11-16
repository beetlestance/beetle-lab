import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import type { Reservation } from '../../src/admission/index.js';
import { fixture, budget } from './fixtures.js';
import { controlled, reserved } from '../supervisor/fixtures.js';

const f = fixture();
async function pending(e: Awaited<ReturnType<typeof f.setupController>>) {
  await e.controller.launch(budget()); e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'busy' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_collection', reason: 'busy' });
  const intent = await e.journal.readOutputCollection(e.key); expect(intent).not.toBeNull(); return intent!;
}
it('releases a stored source before Offer reads, intent reads, supervisor access or collector work', async () => {
  const e = await f.setupController(); await e.controller.launch(budget()); e.time.advance(1);
  e.backend.observation = e.backend.known('exited').value; await e.controller.tick(budget());
  const source = await e.journal.readOutputSource(e.key); expect(source).not.toBeNull(); await e.controller.close();
  const actor = vi.spyOn(e.manager, 'actor').mockImplementation(() => { throw new Error('stored source must not supervise'); });
  const read = vi.spyOn(e.journal, 'readOffer').mockRejectedValue(new Error('stored source must not read catalogue authority'));
  const intent = vi.spyOn(e.journal, 'readOutputCollection'); const collector = vi.fn((): never => { throw new Error('stored source must not recollect'); });
  const next = e.recreate({ collectOutputs: collector });
  try {
    e.time.advance(2000); expect(await next.launch(budget())).toEqual({ kind: 'released', collection: 'finished' });
    expect(read).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(actor).not.toHaveBeenCalled(); expect(collector).not.toHaveBeenCalled();
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).releaseEvidence).toEqual(source!.release);
  } finally { await next.close(); actor.mockRestore(); read.mockRestore(); intent.mockRestore(); }
});
it('same-Journal controller recreation cannot fail-release an earlier successful collection awaiting source commit', async () => {
  const e = await f.setupController(); await e.controller.launch(budget()); e.time.advance(1);
  e.backend.observation = e.backend.known('exited').value;
  const commit = vi.spyOn(e.journal, 'commitOutputSource').mockRejectedValueOnce(new JournalError('quota_exceeded'));
  await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' }); commit.mockRestore();
  const intent = await e.journal.readOutputCollection(e.key); await e.controller.close();
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'integrity' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  const failure = vi.spyOn(e.journal, 'failOutputCollection'); const admission = vi.spyOn(e.journal, 'admission');
  const next = e.recreate(); e.time.advance(2000);
  try {
    await expect(next.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    await expect(next.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(failure).not.toHaveBeenCalled(); expect(admission.mock.calls.some(([input]) => input.kind === 'release')).toBe(false);
    expect(await e.journal.readOutputCollection(e.key)).toEqual(intent); expect(await e.journal.readOutputSource(e.key)).toBeNull();
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
    expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1); expect(e.collections).toHaveLength(2);
  } finally { await next.close(); failure.mockRestore(); admission.mockRestore(); }
});
it('reopened pending custody uses a fresh bounded budget after execution expiry and preserves original evidence', async () => {
  const e = await f.setupController(); const intent = await pending(e); await e.controller.close(); await f.close(e.journal);
  const reopened = await f.open(e.journalPath); e.time.advance(2000); e.setOutput(undefined);
  const owner = controlled(reopened, e.time, e.backend);
  const next = e.recreate({ journal: reopened, supervisor: owner.manager });
  try {
    const call = budget(); const started = performance.now();
    expect(await next.launch(call)).toEqual({ kind: 'awaiting_release', collection: 'finished' });
    const source = await reopened.readOutputSource(e.key); expect(source).not.toBeNull();
    expect(source!.root).toEqual(intent.root); expect(source!.checkpoint).toEqual(intent.checkpoint);
    expect(source!.release.runtime).toEqual(intent.runtime); expect(source!.release.collection.evidenceId).toBe(intent.collectionId);
    expect(e.collections.at(-1)!.deadline).toBeGreaterThan(started);
    expect(e.collections.at(-1)!.deadline).toBeLessThanOrEqual(call.deadline);
    expect(await next.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
    expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
  } finally { await next.close(); }
});
it('a failed recovered collector after Journal reopen retains pending intent and all charge', async () => {
  const e = await f.setupController(); const intent = await pending(e); await e.controller.close(); await f.close(e.journal);
  const reopened = await f.open(e.journalPath); e.time.advance(2000);
  const owner = controlled(reopened, e.time, e.backend);
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'deadline' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  const failure = vi.spyOn(reopened, 'failOutputCollection'); const next = e.recreate({ journal: reopened, supervisor: owner.manager });
  try {
    await expect(next.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(failure).not.toHaveBeenCalled(); expect(await reopened.readOutputCollection(e.key)).toEqual(intent);
    expect(await reopened.readOutputSource(e.key)).toBeNull();
    expect(reserved(await reopened.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  } finally { await next.close(); failure.mockRestore(); }
});
it('replays the same failed-collection observation after an applied failure release loses its acknowledgement', async () => {
  const e = await f.setupController(); await e.controller.launch(budget()); e.time.advance(1);
  e.backend.observation = e.backend.known('exited').value;
  e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'integrity' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
  expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'failed' });
  const fail = e.journal.failOutputCollection.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'failOutputCollection').mockImplementationOnce(async input => { await fail(input); throw new JournalError('unavailable'); });
  try {
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' }); e.time.advance(100);
    expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'failed' });
    expect(spy.mock.calls[1]![0]).toBe(spy.mock.calls[0]![0]); expect(await e.journal.readOutputSource(e.key)).toBeNull();
  } finally { spy.mockRestore(); }
});
for (const collection of ['finished', 'failed'] as const) {
  it.each(['charged', 'scope', 'evidence'] as const)(`rejects a ${collection} %s release reply and retains the exact original request`, async fault => {
    const e = await f.setupController(); await e.controller.launch(budget()); e.time.advance(1);
    e.backend.observation = e.backend.known('exited').value;
    if (collection === 'failed') e.setOutput(() => ({ result: Promise.resolve({ ok: false, reason: 'integrity' }), quiesced: Promise.resolve(), close: () => Promise.resolve() }));
    expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection });
    const corrupt = (original: Reservation): Reservation => {
      const value = structuredClone(original);
      if (fault === 'scope') value.workspaceId = value.attemptId;
      if (fault === 'evidence') value.releaseEvidence!.collection.evidenceId = '00000000-0000-4000-8000-000000000099';
      return value;
    };
    const current = () => e.journal.admission({ kind: 'reservation', key: e.key }).then(reserved);
    const release = e.journal.releaseOutputSource.bind(e.journal); const fail = e.journal.failOutputCollection.bind(e.journal);
    const spy = collection === 'finished'
      ? vi.spyOn(e.journal, 'releaseOutputSource').mockImplementationOnce(async input => fault === 'charged' ? current() : corrupt(await release(input)))
      : vi.spyOn(e.journal, 'failOutputCollection').mockImplementationOnce(async input => fault === 'charged' ? current() : corrupt(await fail(input)));
    try {
      await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
      expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection });
      expect(spy.mock.calls[1]![0]).toBe(spy.mock.calls[0]![0]); expect(e.backend.starts).toBe(1);
    } finally { spy.mockRestore(); }
  });
}
