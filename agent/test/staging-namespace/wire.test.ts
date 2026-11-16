import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { journalFixture } from '../journal/fixtures.js';
import { rootFacts } from './model-fixtures.js';
const f = journalFixture();
it('rejects malformed raw worker namespace commands independently of the client without changing state', async () => {
  const worker = new Worker(f.workerUrl(), { workerData: { path: f.path(), spoolQuotaBytes: 67_108_864 } });
  try {
    expect((await once(worker, 'message'))[0]).toEqual({ kind: 'ready' }); let id = 0;
    const request = async (body: Record<string, unknown>) => {
      const reply = once(worker, 'message'); const identity = ++id; worker.postMessage({ ...body, id: identity });
      const value = (await reply)[0] as { id: number; ok: boolean; code?: string; value?: unknown };
      expect(value.id).toBe(identity); return value;
    };
    for (const body of [{ kind: 'namespaceBegin', json: '{' }, { kind: 'namespaceRead', extra: true }, { kind: 'namespaceRead', none: true },
      { kind: 'namespaceBegin', json: JSON.stringify({ ...rootFacts, native: { ...rootFacts.native, ino: 9007199254740992 } }) },
      { kind: 'namespaceBegin', json: JSON.stringify({ ...rootFacts, refund: true }) },
      { kind: 'namespaceBegin', json: 'x'.repeat(65_537) },
      { kind: 'taskNamespaceRead', key: { attemptId: 'bad', organizationId: 'bad', workspaceId: 'bad', generation: 1 } }]) {
      expect(await request(body)).toMatchObject({ ok: false, code: 'invalid_input' });
      expect(await request({ kind: 'namespaceRead' })).toMatchObject({ ok: true, value: null });
    }
    expect(await request({ kind: 'namespaceBegin', json: JSON.stringify(rootFacts) })).toMatchObject({ ok: true, value: { root: rootFacts } });
    const closed = once(worker, 'exit'); worker.postMessage({ kind: 'close', id: ++id }); expect((await closed)[0]).toBe(0);
  } finally { await worker.terminate(); }
});
