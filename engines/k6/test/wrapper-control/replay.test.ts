import { chmod, link, mkdir, open, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { replayControl } from '../../wrapper/control/index.js';
import { adapter, budget, corpus, deferred, directory, draft, fileWith, line, options, scope } from './fixtures.js';

test('empty and torn snapshots expose prefix and preserve bytes', async () => {
  const path = await directory(); await corpus(path, '');
  expect(await replayControl({ ...options(path), after: 0 }, budget())).toMatchObject({ state: 'complete', events: [], nextCursor: 0 });
  const content = line(1) + line(2).slice(0, -1); await corpus(path, content);
  const batch = await replayControl({ ...options(path), after: 0 }, budget());
  expect(batch).toMatchObject({ state: 'torn_tail', nextCursor: 1, hasMore: false });
  expect(batch.events).toHaveLength(1); expect(await readFile(join(path, 'control.ndjson'), 'utf8')).toBe(content);
});

test('100 record pages scan all source records and bound next cursors', async () => {
  const path = await directory(); await corpus(path, Array.from({ length: 205 }, (_, index) => line(index + 1)).join(''));
  const first = await replayControl({ ...options(path), after: 0 }, budget());
  expect(first.events).toHaveLength(100); expect(first).toMatchObject({ nextCursor: 100, hasMore: true });
  const second = await replayControl({ ...options(path), after: 100 }, budget());
  expect(second.events).toHaveLength(100); expect(second).toMatchObject({ nextCursor: 200, hasMore: true });
  const third = await replayControl({ ...options(path), after: 200 }, budget());
  expect(third.events).toHaveLength(5); expect(third).toMatchObject({ nextCursor: 205, hasMore: false });
  await expect(replayControl({ ...options(path), after: 206 }, budget())).rejects.toMatchObject({ code: 'invalid_cursor' });
});

test('256 KiB page counts exact source frame bytes; split UTF8 decodes correctly', async () => {
  const path = await directory();
  const unicode = { ...draft(), kind: 'case.result', payload: { caseKey: '💡', outcome: 'passed', durationMs: 1, required: true, artifactIds: [] } };
  const frames = Array.from({ length: 6 }, (_, index) => {
    const json = JSON.stringify({ ...unicode, seq: index + 1 });
    return json + ' '.repeat(65_535 - Buffer.byteLength(json)) + '\n';
  }).join('');
  await corpus(path, frames);
  const io = adapter(file => fileWith(file, { read: (bytes, offset, length, position) => file.read(bytes, offset, Math.min(length, 13), position) }));
  const batch = await replayControl({ ...options(path), io, after: 0 }, budget());
  expect(batch.events).toHaveLength(4); expect(batch).toMatchObject({ nextCursor: 4, hasMore: true });
});

test.each([
  'not json\n', line(2), line(1) + line(1),
  JSON.stringify({ ...draft(), seq: 1, generation: 2 }) + '\n',
  JSON.stringify({ ...draft(), seq: 1, organizationId: scope.attemptId }) + '\n',
  JSON.stringify({ ...draft(), seq: 1, kind: 'runtime.exited' }) + '\n',
  Buffer.from([0xff, 10]), Buffer.from([0xe2, 0x82, 10]), '\n',
])('complete malformed lines reject without successful history', async content => {
  const path = await directory(); await corpus(path, content);
  await expect(replayControl({ ...options(path), after: 0 }, budget())).rejects.toMatchObject({ code: 'corruption' });
});

test('corruption outside returned page and before cursor still fails', async () => {
  const path = await directory(); const valid = Array.from({ length: 101 }, (_, index) => line(index + 1)).join('');
  await corpus(path, valid + 'bad\n');
  await expect(replayControl({ ...options(path), after: 0 }, budget())).rejects.toMatchObject({ code: 'corruption' });
  await corpus(path, 'bad\n' + valid);
  await expect(replayControl({ ...options(path), after: 100 }, budget())).rejects.toMatchObject({ code: 'corruption' });
});

test('oversize line and sparse oversize file fail with bounded reads', async () => {
  const path = await directory(); await corpus(path, ' '.repeat(65_536));
  let reads = 0;
  const io = adapter(file => fileWith(file, { async read(...args) { reads++; return file.read(...args); } }));
  await expect(replayControl({ ...options(path), io, after: 0 }, budget())).rejects.toMatchObject({ code: 'corruption' });
  expect(reads).toBe(1);
  const file = await open(join(path, 'control.ndjson'), 'r+'); await file.truncate(67_108_865); await file.close(); reads = 0;
  await expect(replayControl({ ...options(path), io, after: 0 }, budget())).rejects.toMatchObject({ code: 'quota_limit' });
  expect(reads).toBe(0);
});

test('replay rejects unsafe permissions, symlink, hardlink and nonregular files', async () => {
  const source = await directory(); await corpus(source, line());
  await chmod(join(source, 'control.ndjson'), 0o644);
  await expect(replayControl({ ...options(source), after: 0 }, budget())).rejects.toMatchObject({ code: 'unsafe_file' });
  await chmod(join(source, 'control.ndjson'), 0o600);
  for (const kind of ['symlink', 'hardlink', 'directory']) {
    const path = await directory(); const target = join(path, 'control.ndjson');
    if (kind === 'symlink') await symlink(join(source, 'control.ndjson'), target);
    if (kind === 'hardlink') await link(join(source, 'control.ndjson'), target);
    if (kind === 'directory') await mkdir(target);
    await expect(replayControl({ ...options(path), after: 0 }, budget())).rejects.toBeDefined();
  }
});

test.each(['deadline', 'cancelled'])('replay %s rejects late reads and eventually closes descriptor', async reason => {
  const path = await directory(); await corpus(path, line());
  const held = deferred(); const started = deferred(); const closed = deferred(); const controller = new AbortController();
  let reads = 0;
  const io = adapter(file => fileWith(file, {
    async read(...args) { reads++; started.resolve(); await held.promise; return file.read(...args); },
    async close() { await file.close(); closed.resolve(); },
  }));
  const pending = replayControl({ ...options(path), io, after: 0 }, { ...budget(reason === 'deadline' ? 80 : 5000), signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ code: reason });
  await started.promise; if (reason === 'cancelled') controller.abort(); await rejected;
  held.resolve(); await closed.promise; expect(reads).toBe(1);
});

test('snapshot excludes appends after stat; unexpected EOF is corruption', async () => {
  const path = await directory(); await corpus(path, line()); let first = true;
  const io = adapter(file => fileWith(file, { async read(...args) {
    if (first) { first = false; const writer = await open(join(path, 'control.ndjson'), 'a'); await writer.write(line(2)); await writer.close(); }
    return file.read(...args);
  } }));
  expect((await replayControl({ ...options(path), io, after: 0 }, budget())).events).toHaveLength(1);
  const eof = adapter(file => fileWith(file, { read: () => Promise.resolve({ bytesRead: 0 }) }));
  await expect(replayControl({ ...options(path), io: eof, after: 0 }, budget())).rejects.toMatchObject({ code: 'corruption' });
});

test('invalid cursors and cancellation are rejected before opening source', async () => {
  const path = await directory(); let opened = 0;
  const io = adapter(file => { opened++; return file; });
  for (const after of [-1, 0.1, 65_537, NaN]) {
    await expect(replayControl({ ...options(path), after, io }, budget())).rejects.toMatchObject({ code: 'invalid_cursor' });
  }
  const controller = new AbortController(); controller.abort();
  await expect(replayControl({ ...options(path), after: 0, io }, { ...budget(), signal: controller.signal }))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(opened).toBe(0);
});
