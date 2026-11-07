import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createControlWriter, replayControl } from '../../wrapper/control/index.js';
import { adapter, budget, deferred, directory, draft, fileWith, options } from './fixtures.js';

test('initialization syncs file and directory before returning and retains failed evidence', async () => {
  const path = await directory(); const held = deferred(); const started = deferred(); const calls: string[] = [];
  const io = adapter((file, name) => fileWith(file, { async sync() {
    calls.push(name.endsWith('control.ndjson') ? 'file' : 'directory');
    if (!name.endsWith('control.ndjson')) { started.resolve(); await held.promise; }
    await file.sync();
  } }));
  let eligible = false;
  const pending = createControlWriter(options(path, { io }), budget()).then(writer => { eligible = true; return writer; });
  await started.promise; expect(eligible).toBe(false); expect(calls).toEqual(['file', 'directory']);
  held.resolve(); const writer = await pending; await writer.close();
  const failed = await directory();
  const badIo = adapter(file => fileWith(file, { sync: () => Promise.reject(new Error('private path')) }));
  await expect(createControlWriter(options(failed, { io: badIo }), budget())).rejects.toMatchObject({ code: 'io_failure', message: 'io_failure' });
  expect((await stat(join(failed, 'control.ndjson'))).size).toBe(0);
  await expect(createControlWriter(options(failed), budget())).rejects.toMatchObject({ code: 'already_exists' });
});

test('held append sync prevents early eligibility; busy fails without queueing', async () => {
  const path = await directory(); const held = deferred(); const started = deferred(); let syncs = 0;
  const io = adapter((file, name) => fileWith(file, { async sync() {
    if (name.endsWith('control.ndjson') && ++syncs > 1) { started.resolve(); await held.promise; }
    await file.sync();
  } }));
  const writer = await createControlWriter(options(path, { io }), budget()); let eligible = false;
  const pending = writer.append(draft(), budget()).then(event => { eligible = true; return event; });
  await started.promise; expect(eligible).toBe(false);
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'busy' });
  const observed = await replayControl({ ...options(path), after: 0 }, budget());
  expect(observed.durability).toBe('unverified'); expect(observed.events).toHaveLength(1);
  held.resolve(); expect((await pending).seq).toBe(1); expect(eligible).toBe(true); await writer.close();
});

test('short writes complete exactly one frame before sync', async () => {
  const path = await directory(); let writes = 0;
  const io = adapter(file => fileWith(file, { async write(bytes, offset, length, position) {
    writes++; return file.write(bytes, offset, Math.min(length, 7), position);
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const event = await writer.append(draft(), budget()); await writer.close();
  expect(writes).toBeGreaterThan(10);
  expect(await readFile(join(path, 'control.ndjson'), 'utf8')).toBe(JSON.stringify(event) + '\n');
});

test.each(['write', 'zero', 'sync'])('uncertain %s failure poisons without sequence reuse', async fault => {
  const path = await directory(); let syncs = 0; let writes = 0;
  const io = adapter((file, name) => fileWith(file, {
    async write(...args) {
      writes++;
      if (fault === 'write') throw new Error('secret');
      if (fault === 'zero') return { bytesWritten: 0 };
      return file.write(...args);
    },
    async sync() {
      if (name.endsWith('control.ndjson') && ++syncs > 1 && fault === 'sync') throw new Error('secret');
      await file.sync();
    },
  }));
  const writer = await createControlWriter(options(path, { io }), budget());
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'io_failure', message: 'io_failure' });
  const previous = writes;
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'poisoned' });
  expect(writes).toBe(previous); await writer.close();
});

test('close during held append quiesces and never returns a late event', async () => {
  const path = await directory(); const held = deferred(); const started = deferred(); let closed = false;
  const io = adapter((file, name) => fileWith(file, {
    async write(...args) { started.resolve(); await held.promise; return file.write(...args); },
    async close() { if (name.endsWith('control.ndjson')) closed = true; await file.close(); },
  }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const pending = writer.append(draft(), budget()); const rejected = expect(pending).rejects.toMatchObject({ code: 'closed' });
  await started.promise; const closing = writer.close(); expect(writer.close()).toBe(closing); expect(closed).toBe(false);
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'closed' });
  held.resolve(); await rejected; await closing; expect(closed).toBe(true);
});

test.each(['deadline', 'cancelled'])('%s during held sync poisons and ignores late completion', async reason => {
  const path = await directory(); const held = deferred(); const started = deferred(); const controller = new AbortController();
  let syncs = 0; let eligible = false;
  const io = adapter((file, name) => fileWith(file, { async sync() {
    if (name.endsWith('control.ndjson') && ++syncs > 1) { started.resolve(); await held.promise; }
    await file.sync();
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const pending = writer.append(draft(), { ...budget(reason === 'deadline' ? 80 : 5000), signal: controller.signal })
    .then(event => { eligible = true; return event; });
  const rejected = expect(pending).rejects.toMatchObject({ code: reason });
  await started.promise; if (reason === 'cancelled') controller.abort(); await rejected;
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'poisoned' });
  const closing = writer.close(); held.resolve(); await closing; expect(eligible).toBe(false);
});

test('late initialization open is closed after deadline and never reused', async () => {
  const path = await directory(); const held = deferred(); const started = deferred(); let closed = false;
  const io = adapter((file, name) => fileWith(file, { async close() {
    if (name.endsWith('control.ndjson')) closed = true; await file.close();
  } }));
  const delayed = { ...io, async open(...args: Parameters<typeof io.open>) {
    const file = await io.open(...args); started.resolve(); await held.promise; return file;
  } };
  const pending = createControlWriter(options(path, { io: delayed }), budget(80));
  const rejected = expect(pending).rejects.toMatchObject({ code: 'deadline' });
  await started.promise; await rejected; held.resolve();
  // Await the same bounded microtask/I/O cleanup rather than start another writer.
  for (let turn = 0; turn < 20 && !closed; turn++) await new Promise<void>(resolve => setImmediate(resolve));
  expect(closed).toBe(true);
  await expect(createControlWriter(options(path), budget())).rejects.toMatchObject({ code: 'already_exists' });
});

test('close failure is explicit, idempotent and not retried', async () => {
  const path = await directory(); let closes = 0;
  const io = adapter((file, name) => fileWith(file, { async close() {
    await file.close();
    if (name.endsWith('control.ndjson')) { closes++; throw new Error('private path'); }
  } }));
  const writer = await createControlWriter(options(path, { io }), budget());
  const close = writer.close(); expect(writer.close()).toBe(close);
  await expect(close).rejects.toMatchObject({ code: 'io_failure', message: 'io_failure' });
  expect(closes).toBe(1);
  await expect(writer.append(draft(), budget())).rejects.toMatchObject({ code: 'closed' });
});

test('pre-I/O cancellation and expired deadline leave writer usable', async () => {
  const path = await directory(); const writer = await createControlWriter(options(path), budget());
  const controller = new AbortController(); controller.abort();
  await expect(writer.append(draft(), { ...budget(), signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  await expect(writer.append(draft(), { deadline: performance.now() - 1 })).rejects.toMatchObject({ code: 'deadline' });
  expect((await writer.append(draft(), budget())).seq).toBe(1); await writer.close();
});
