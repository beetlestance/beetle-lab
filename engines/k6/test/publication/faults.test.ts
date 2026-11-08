import type { BigIntStats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createPublication } from '../../wrapper/publication/operation.js';
import { clean, deferred, fileProxy, input, nodeIo, overrideFile } from './fixtures.js';

it.each(['file', 'directory'] as const)('refuses success after %s fsync failure without claiming absence', async owner => {
  const options = await input(); const io = overrideFile(nodeIo, (file, directory) => directory === (owner === 'directory')
    ? fileProxy(file, { sync: async () => { throw new Error('private'); } }) : file);
  try {
    const op = createPublication(options, io); expect(await op.result).toEqual({ ok: false, code: 'filesystem', publication: 'unconfirmed' });
    await op.quiesced;
    const names = await readdir(options.directory);
    expect(names.includes('engine-result.json')).toBe(owner === 'directory');
    expect(names).toHaveLength(1);
  } finally { await clean(options); }
});
it.each(['file', 'directory', 'both'] as const)('retains original %s close failure and closes the other descriptor once', async owner => {
  const options = await input(); const counts = { file: 0, directory: 0 };
  const io = overrideFile(nodeIo, (file, directory) => fileProxy(file, { close: async () => {
    const key = directory ? 'directory' : 'file'; counts[key]++; await file.close();
    if (owner === key || owner === 'both') throw new Error('private');
  } }));
  try {
    const op = createPublication(options, io); expect(await op.result).toEqual({ ok: false, code: 'filesystem', publication: 'unconfirmed' });
    await expect(op.quiesced).rejects.toThrow('Result publication failed');
    const first = op.close(); expect(op.close()).toBe(first); await expect(first).rejects.toThrow('Result publication failed');
    expect(counts).toEqual({ file: 1, directory: 1 });
  } finally { await clean(options); }
});
it('a synchronous parent-close throw cannot detach an outstanding original file-close promise', async () => {
  const options = await input(); const fileCloseGate = deferred(); const entered = deferred();
  let parentClose = 0;
  let originalParentClose: Promise<void> | undefined;
  const io = overrideFile(nodeIo, (file, directory) => fileProxy(file, directory ? { close: () => {
    parentClose++; originalParentClose = file.close(); throw new Error('private');
  } } : {
    write: async () => { throw new Error('write'); },
    close: async () => { entered.resolve(); await fileCloseGate.promise; await file.close(); },
  }));
  const op = createPublication(options, io);
  try {
    await entered.promise; let quiet = false; void op.quiesced.then(() => { quiet = true; }, () => { quiet = true; });
    await Promise.resolve(); expect(quiet).toBe(false);
    fileCloseGate.resolve(); expect(await op.result).toMatchObject({ ok: false, code: 'filesystem' });
    await expect(op.quiesced).rejects.toThrow('Result publication failed'); expect(parentClose).toBe(1);
  } finally { fileCloseGate.resolve(); await op.close().catch(() => undefined); await originalParentClose; await clean(options); }
});
it('cancelled public result does not erase a later original close failure', async () => {
  const options = await input(); const entered = deferred(); const gate = deferred(); const controller = new AbortController();
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: async (...args) => { entered.resolve(); await gate.promise; return file.write(...args); },
    close: async () => { await file.close(); throw new Error('private'); },
  }));
  const op = createPublication({ ...options, signal: controller.signal }, io);
  try {
    await entered.promise; controller.abort(); expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
    gate.resolve(); await expect(op.quiesced).rejects.toThrow('Result publication failed');
    await expect(op.close()).rejects.toThrow('Result publication failed');
  } finally { gate.resolve(); await op.close().catch(() => undefined); await clean(options); }
});
it.each([
  ['size', (stat: BigIntStats) => { stat.size++; }], ['links', (stat: BigIntStats) => { stat.nlink++; }],
  ['owner', (stat: BigIntStats) => { stat.uid++; }], ['permissions', (stat: BigIntStats) => { stat.mode |= 0o044n; }],
  ['inode', (stat: BigIntStats) => { stat.ino++; }],
  ['changed high inode', (stat: BigIntStats) => { stat.ino = (1n << 60n) + 1n; }],
] as const)('rejects changed file %s before final linking', async (_name, change) => {
  const options = await input(); let calls = 0;
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, { stat: async () => {
    const value = await file.stat(); if (++calls === 2) change(value); return value;
  } }));
  try {
    const op = createPublication(options, io); expect(await op.result).toMatchObject({ ok: false, code: 'integrity' }); await op.quiesced;
    expect(await readdir(options.directory)).not.toContain('engine-result.json');
  } finally { await clean(options); }
});
it('returns fixed error data when directory open is denied', async () => {
  const options = await input(); const io = { ...nodeIo, open: async () => { throw Object.assign(new Error('PRIVATE_CANARY'), { code: 'EACCES' }); } };
  try {
    const op = createPublication(options, io);
    expect(await op.result).toEqual({ ok: false, code: 'filesystem', publication: 'unconfirmed' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it.each([2, 3, 4])('checks named parent identity at publication checkpoint %s', async checkpoint => {
  const options = await input(); let calls = 0;
  const io = { ...nodeIo, lstat: async (path: string) => {
    const value = await nodeIo.lstat(path); if (path === options.directory && ++calls === checkpoint) value.ino++; return value;
  } };
  try {
    const op = createPublication(options, io); expect(await op.result).toMatchObject({ ok: false, code: 'integrity', publication: 'unconfirmed' });
    await op.quiesced;
  } finally { await clean(options); }
});
it('keeps one inode and both names if cancellation follows linking, without deleting the target', async () => {
  const options = await input(); const controller = new AbortController();
  const io = { ...nodeIo, link: async (source: string, target: string) => { await nodeIo.link(source, target); controller.abort(); } };
  try {
    const op = createPublication({ ...options, signal: controller.signal }, io); expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
    await op.quiesced;
    const names = await readdir(options.directory); expect(names).toHaveLength(2);
    const stats = await Promise.all(names.map(name => lstat(join(options.directory, name))));
    expect(stats[0]!.ino).toBe(stats[1]!.ino); expect(stats[0]!.nlink).toBe(2);
  } finally { await clean(options); }
});
