import { expect, test } from 'vitest';
import { createControlWriter } from '../../wrapper/control/index.js';
import type { ControlEvent } from '@beetle/contracts';
import type { JournalFile } from '../../wrapper/control/index.js';
import { adapter, budget, deferred, directory, draft, fileWith, options } from './fixtures.js';

test('uncertain actual write cannot admit another append in the two-microtask rejection gap', async () => {
  const path = await directory(); const attempted = deferred(); let writes = 0;
  let second!: Promise<ControlEvent>;
  const io = adapter(file => fileWith(file, { write(...args) {
    if (++writes > 1) return file.write(...args);
    return new Promise((_resolve, reject) => {
      void file.write(...args).then(() => {
        reject(new Error('uncertain after actual write'));
        queueMicrotask(() => queueMicrotask(() => {
          second = writer.append(draft(), budget());
          void second.catch(() => undefined); attempted.resolve();
        }));
      }, reject);
    });
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const firstRejected = expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'io_failure' });
  await attempted.promise;
  const outcome = await second.then(event => ({ seq: event.seq }), error => ({ code: (error as { code: string }).code }));
  await firstRejected; await writer.close();
  expect(writes).toBe(1); expect(outcome).toEqual({ code: 'poisoned' });
});

test('close queued after actual fsync suppresses append at the public handoff', async () => {
  const path = await directory(); const closingStarted = deferred(); let syncs = 0;
  let closing!: Promise<void>;
  const io = adapter((file, name) => fileWith(file, { sync() {
    const actual = file.sync();
    if (!name.endsWith('control.ndjson') || ++syncs === 1) return actual;
    return actual.then(() => {
      queueMicrotask(() => queueMicrotask(() => { closing = writer.close(); closingStarted.resolve(); }));
    });
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const outcome = await writer.append(draft(), budget())
    .then(event => ({ seq: event.seq }), error => ({ code: (error as { code: string }).code }));
  await closingStarted.promise; await closing;
  expect(outcome).toEqual({ code: 'closed' });
});

test('admission remains busy after actual fsync until the public success decision', async () => {
  const path = await directory(); const attempted = deferred(); let syncs = 0;
  let second!: Promise<ControlEvent>;
  const io = adapter((file, name) => fileWith(file, { sync() {
    const actual = file.sync();
    if (!name.endsWith('control.ndjson') || ++syncs !== 2) return actual;
    return actual.then(() => {
      queueMicrotask(() => queueMicrotask(() => {
        second = writer.append(draft(), budget());
        void second.catch(() => undefined); attempted.resolve();
      }));
    });
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const first = writer.append(draft(), budget());
  await attempted.promise;
  await expect(second).rejects.toMatchObject({ code: 'busy' });
  expect((await first).seq).toBe(1);
  expect((await writer.append(draft(), budget())).seq).toBe(2); await writer.close();
});

test('admission is already held when the first filesystem write is invoked', async () => {
  const path = await directory(); let writes = 0; let second!: Promise<ControlEvent>;
  const io = adapter(file => fileWith(file, { write(...args) {
    if (++writes === 1) {
      second = writer.append(draft(), budget()); void second.catch(() => undefined);
    }
    return file.write(...args);
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const first = writer.append(draft(), budget());
  await expect(second).rejects.toMatchObject({ code: 'busy' });
  expect((await first).seq).toBe(1); expect(writes).toBe(1); await writer.close();
});

test.each([false, true])('paired parent sync and close failures still attempt journal close (journal failure: %s)', async journalFailure => {
  const path = await directory(); const closes: string[] = []; let journal!: JournalFile;
  const io = adapter((file, name) => {
    const parent = !name.endsWith('control.ndjson');
    if (!parent) journal = file;
    return fileWith(file, {
      async sync() { if (parent) throw new Error('parent sync failed'); await file.sync(); },
      async close() {
        closes.push(parent ? 'parent' : 'journal'); await file.close();
        if (parent) throw new Error('parent close failed');
        if (journalFailure) throw new Error('journal close failed');
      },
    });
  });
  try {
    await expect(createControlWriter(options(path, { io }), budget())).rejects.toMatchObject({ code: 'io_failure' });
    expect(closes).toEqual(['parent', 'journal']);
    await expect(journal.stat()).rejects.toMatchObject({ code: 'EBADF' });
  } finally { await journal.close().catch(() => undefined); }
  await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'already_exists' });
});
