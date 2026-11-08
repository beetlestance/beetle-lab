import { describe, expect, it } from 'vitest';
import { admissionFixture, scope } from '../admission/fixtures.js';
import type { RunnableRequest } from '../../src/journal/index.js';

const f = admissionFixture();

describe('private runnable discovery', () => {
  it('pages lane identities independently, survives restart and excludes retired history', async () => {
    const path = f.path(); let journal = await f.configured(path);
    const jobs = [f.job(1), f.job(2), f.job(3), f.job(4)];
    // Accepted IDs differ from lane IDs: compatibility offers have no queue row.
    await journal.immutableOffer(f.job(99));
    for (const index of [1, 3, 0, 2]) await f.enqueue(journal, jobs[index]!);
    expect(await f.admit(journal, jobs[1]!)).toMatchObject({ status: 'charged' });
    expect(await f.admit(journal, jobs[3]!)).toMatchObject({ status: 'charged' });
    const charged = await journal.scanRunnable({ lane: 'charged', limit: 1 });
    expect(charged).toEqual({ attempts: [scope(jobs[1]!)], cursor: 1 });
    expect(await journal.scanRunnable({ lane: 'charged', limit: 1, cursor: charged.cursor! }))
      .toEqual({ attempts: [scope(jobs[3]!)] });
    const queued = await journal.scanRunnable({ lane: 'queued', limit: 1 });
    expect(queued).toEqual({ attempts: [scope(jobs[0]!)], cursor: 3 });
    expect(await journal.scanRunnable({ lane: 'queued', limit: 1, cursor: queued.cursor! }))
      .toEqual({ attempts: [scope(jobs[2]!)] });
    await journal.durableCancel(scope(jobs[0]!));
    // Cancellation alone never hides a charged runtime from recovery.
    await journal.durableCancel(scope(jobs[1]!));
    expect((await journal.scanRunnable({ lane: 'charged', limit: 100 })).attempts)
      .toEqual([scope(jobs[1]!), scope(jobs[3]!)]);
    await journal.admission({ kind: 'abortUnstarted', key: scope(jobs[1]!) });
    await f.close(journal); journal = await f.open(path);
    expect(await journal.scanRunnable({ lane: 'charged', limit: 100 })).toEqual({ attempts: [scope(jobs[3]!)] });
    expect(await journal.scanRunnable({ lane: 'queued', limit: 100 })).toEqual({ attempts: [scope(jobs[2]!)] });
    expect(await journal.scanRunnable({ lane: 'queued', limit: 1, cursor: Number.MAX_SAFE_INTEGER }))
      .toEqual({ attempts: [] });
  });

  it('restarts discovery from zero to see new work after an exhausted pass', async () => {
    const journal = await f.configured(); const first = f.job(1); const second = f.job(2);
    await f.enqueue(journal, first);
    expect(await journal.scanRunnable({ lane: 'queued', limit: 1 })).toEqual({ attempts: [scope(first)] });
    await journal.durableCancel(scope(first)); await f.enqueue(journal, second);
    expect(await journal.scanRunnable({ lane: 'queued', limit: 1 })).toEqual({ attempts: [scope(second)] });
    expect(await journal.scanRunnable({ lane: 'charged', limit: 100 })).toEqual({ attempts: [] });
  });

  it.each([
    { lane: 'history', limit: 1 }, { lane: 'queued', limit: 0 }, { lane: 'charged', limit: 101 },
    { lane: 'queued', limit: 1, cursor: -1 }, { lane: 'queued', limit: 1, cursor: 0.5 },
    { lane: 'charged', limit: 1, cursor: Number.MAX_SAFE_INTEGER + 1 },
    { lane: 'queued', limit: 1, extra: true }, null,
  ])('rejects malformed bounded discovery input %j', async input => {
    const journal = await f.configured();
    await expect(journal.scanRunnable(input as RunnableRequest)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await journal.scanRunnable({ lane: 'queued', limit: 100 })).toEqual({ attempts: [] });
  });

  it('captures input without invoking accessors', async () => {
    const journal = await f.configured(); let calls = 0;
    await expect(journal.scanRunnable({ get lane() { calls++; return 'queued' as const; }, limit: 1 }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toBe(0);
  });
});
