import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { publishK6Result } from '../../wrapper/publication/index.js';
import type { ResultPublication } from '../../wrapper/publication/index.js';
import { createPublication } from '../../wrapper/publication/operation.js';
import { clean, deferred, fileProxy, input, nodeIo, overrideFile } from './fixtures.js';

it('close before launch fences every filesystem effect and returns one cached close outcome', async () => {
  const options = await input();
  try {
    const op = publishK6Result(options); const first = op.close(); expect(op.close()).toBe(first);
    expect(await op.result).toMatchObject({ ok: false, code: 'closed' }); await first;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('rejects already-cancelled work before filesystem admission', async () => {
  const options = await input(); const controller = new AbortController(); controller.abort();
  try {
    const op = publishK6Result({ ...options, signal: controller.signal });
    expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('a blocked original write outlives cancelled result and keeps close/quiescence outstanding', async () => {
  const options = await input(); const entered = deferred(); const gate = deferred(); const controller = new AbortController();
  let closed = 0; let quiet = false;
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: async (...args) => { const value = await file.write(...args); entered.resolve(); await gate.promise; return value; },
    close: async () => { closed++; await file.close(); },
  }));
  const op = createPublication({ ...options, signal: controller.signal }, io);
  try {
    await entered.promise; controller.abort(); expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
    void op.quiesced.then(() => { quiet = true; }); const closing = op.close();
    await Promise.resolve(); expect(quiet).toBe(false); expect(closed).toBe(0);
    gate.resolve(); await closing; expect(quiet).toBe(true); expect(closed).toBe(1);
    expect(await readdir(options.directory)).not.toContain('engine-result.json');
  } finally { gate.resolve(); await op.close(); await clean(options); }
});
it('a late descriptor from blocked open remains owned and is closed before quiescence', async () => {
  const options = await input(); const gate = deferred(); const entered = deferred(); const controller = new AbortController();
  let closeCalls = 0;
  const io = { ...nodeIo, open: async (...args: Parameters<typeof nodeIo.open>) => {
    const file = await nodeIo.open(...args); entered.resolve(); await gate.promise;
    return fileProxy(file, { close: async () => { closeCalls++; await file.close(); } });
  } };
  const op = createPublication({ ...options, signal: controller.signal }, io);
  try {
    await entered.promise; controller.abort(); expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
    expect(closeCalls).toBe(0); gate.resolve(); await op.quiesced; expect(closeCalls).toBe(1);
    expect(await readdir(options.directory)).toEqual([]);
  } finally { gate.resolve(); await op.close(); await clean(options); }
});
it('the monotonic timeout cannot manufacture quiescence for a stalled write', async () => {
  const options = await input(); const entered = deferred(); const gate = deferred();
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: async (...args) => { entered.resolve(); await gate.promise; return file.write(...args); },
  }));
  const op = createPublication({ ...options, wallNow: () => 1000, deadlineMs: 60_000, timeoutMs: 50 }, io);
  try {
    await entered.promise; const result = await op.result; expect(result).toMatchObject({ ok: false, code: 'deadline' });
    let quiet = false; void op.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    gate.resolve(); await op.quiesced;
    expect(await readdir(options.directory)).not.toContain('engine-result.json');
  } finally { gate.resolve(); await op.close(); await clean(options); }
});
it.each(['rollback', 'invalid', 'throw'] as const)('sticky clock fence rejects %s during asynchronous IO', async kind => {
  const options = await input(); let bad = false;
  const io = { ...nodeIo, realpath: async (path: string) => { const result = await nodeIo.realpath(path); bad = true; return result; } };
  const wallNow = () => { if (!bad) return 1000; if (kind === 'throw') throw new Error('private'); return kind === 'rollback' ? 999 : NaN; };
  try {
    const op = createPublication({ ...options, wallNow, deadlineMs: 2000 }, io);
    expect(await op.result).toEqual({ ok: false, code: 'clock', publication: 'unconfirmed' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('reentrant close inside the first external clock cannot issue IO', async () => {
  const options = await input(); let op: ResultPublication | undefined;
  const wallNow = () => { void op?.close(); return Date.now(); };
  try {
    op = publishK6Result({ ...options, wallNow });
    expect(await op.result).toMatchObject({ ok: false, code: 'closed' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await op?.close(); await clean(options); }
});
it('quiesced-observer close fences success at the final Promise.race publication handoff', async () => {
  const options = await input();
  try {
    const op = publishK6Result(options); void op.quiesced.then(() => op.close());
    expect(await op.result).toMatchObject({ ok: false, code: 'closed', publication: 'unconfirmed' });
    expect(await readdir(options.directory)).toEqual(['engine-result.json']);
  } finally { await clean(options); }
});
it.each(['link', 'unlink'] as const)('late cancellation after %s preserves final output with unconfirmed publication', async step => {
  const options = await input(); const controller = new AbortController();
  const io = { ...nodeIo,
    link: async (source: string, target: string) => { await nodeIo.link(source, target); if (step === 'link') controller.abort(); },
    unlink: async (path: string) => { await nodeIo.unlink(path); if (step === 'unlink') controller.abort(); },
  };
  try {
    const op = createPublication({ ...options, signal: controller.signal }, io);
    expect(await op.result).toMatchObject({ ok: false, code: 'cancelled', publication: 'unconfirmed' }); await op.quiesced;
    expect(JSON.parse(await readFile(join(options.directory, 'engine-result.json'), 'utf8'))).toEqual(options.result);
  } finally { await clean(options); }
});
