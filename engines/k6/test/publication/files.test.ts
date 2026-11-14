import { createHash } from 'node:crypto';
import { chmod, lstat, readFile, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { encodeJson, sealEngineResult, verifyEngineResultSeal } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { publishK6Result } from '../../wrapper/publication/index.js';
import { createPublication } from '../../wrapper/publication/operation.js';
import { clean, fileProxy, input, nodeIo, overrideFile } from './fixtures.js';
const digest = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');

it('publishes one real sealed result exclusively with exact LF-inclusive bytes and raw hash', async () => {
  const options = await input();
  try {
    options.maximumBytes = Buffer.byteLength(encodeJson(options.result, 1_048_576)) + 1;
    const operation = publishK6Result(options); const result = await operation.result; await operation.quiesced;
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('publication failed');
    const bytes = await readFile(join(options.directory, result.relativePath));
    expect(bytes.at(-1)).toBe(10); expect(bytes.length).toBe(options.maximumBytes);
    expect(result.rawSha256).toBe(digest(bytes)); expect(result.bytes).toBe(bytes.length);
    expect(verifyEngineResultSeal(JSON.parse(bytes.toString()), digest)).toEqual({ ok: true, value: options.result });
    expect(Object.isFrozen(result.value.seal)).toBe(true);
    const stat = await lstat(join(options.directory, result.relativePath));
    expect(stat.nlink).toBe(1); expect(stat.uid).toBe(options.uid); expect(stat.mode & 0o777).toBe(0o600);
    expect(await readdir(options.directory)).toEqual(['engine-result.json']);
  } finally { await clean(options); }
});
it('rejects a one-byte-short allowance before any output file is opened', async () => {
  const options = await input();
  try {
    options.maximumBytes = Buffer.byteLength(encodeJson(options.result, 1_048_576));
    const op = publishK6Result(options); expect(await op.result).toMatchObject({ ok: false, code: 'limit' });
    await op.quiesced; expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it.each(['file', 'symlink'] as const)('never replaces an existing target %s', async kind => {
  const options = await input(); const path = join(options.directory, 'engine-result.json');
  try {
    const preserved = join(options.directory, 'preserved'); await writeFile(preserved, 'preserve');
    if (kind === 'file') await writeFile(path, 'original'); else await symlink(preserved, path);
    const op = publishK6Result(options); expect(await op.result).toMatchObject({ ok: false, code: 'exists', publication: 'unconfirmed' });
    await op.quiesced;
    expect(await readFile(path, 'utf8')).toBe(kind === 'file' ? 'original' : 'preserve');
    if (kind === 'symlink') expect(await readlink(path)).toBe(preserved);
    expect((await readdir(options.directory)).filter(name => name.startsWith('.engine-result.json.pending-'))).toHaveLength(1);
  } finally { await clean(options); }
});
it('completes short writes without exceeding its bounded per-call window', async () => {
  const options = await input(); const writes: number[] = [];
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: async (buffer, offset, length, position) => { writes.push(length); return file.write(buffer, offset, Math.min(length, 32), position); },
  }));
  try {
    const op = createPublication(options, io); expect((await op.result).ok).toBe(true); await op.quiesced;
    expect(writes.length).toBeGreaterThan(1); expect(Math.max(...writes)).toBeLessThanOrEqual(65_536);
  } finally { await clean(options); }
});
it('streams a valid result larger than64KiB through serialized bounded writes', async () => {
  const options = await input(); const { seal, ...body } = options.result as EngineResult;
  body.thresholds = Array.from({ length: 256 }, (_, index) => ({ id: `${index}.` + 'x'.repeat(120), purpose: 'slo', passed: true }));
  body.artifacts = Array.from({ length: 64 }, (_, index) => ({ ...body.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, relativePath: 'a'.repeat(500) + String(index) }));
  const sealed = sealEngineResult(body, seal.sealedAt, digest); expect(sealed.ok).toBe(true);
  if (!sealed.ok) throw new Error('fixture seal failed'); options.result = sealed.value;
  const lengths: number[] = []; let active = 0;
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: async (...args) => {
      expect(++active).toBe(1); lengths.push(args[2]);
      try { return await file.write(...args); } finally { active--; }
    },
  }));
  try {
    const op = createPublication(options, io); const result = await op.result; await op.quiesced;
    expect(result.ok).toBe(true); expect(lengths.length).toBeGreaterThan(1);
    expect(lengths[0]).toBe(65_536); expect(Math.max(...lengths)).toBe(65_536);
    expect(lengths.reduce((sum, value) => sum + value, 0)).toBe((await readFile(join(options.directory, 'engine-result.json'))).length);
  } finally { await clean(options); }
});
it.each([0, -1, 0.5, 1_048_577])('rejects impossible write progress %s without publication', async bytesWritten => {
  const options = await input();
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, { write: async () => ({ bytesWritten }) }));
  try {
    const op = createPublication(options, io); expect(await op.result).toMatchObject({ ok: false, code: 'filesystem' });
    await op.quiesced; expect(await readdir(options.directory)).not.toContain('engine-result.json');
  } finally { await clean(options); }
});
it('caps syscall work at128 short writes and preserves the bounded incomplete inode', async () => {
  const options = await input(); let writes = 0;
  const io = overrideFile(nodeIo, (file, directory) => directory ? file : fileProxy(file, {
    write: (buffer, offset, _length, position) => { writes++; return file.write(buffer, offset, 1, position); },
  }));
  try {
    const op = createPublication(options, io); expect(await op.result).toMatchObject({ ok: false, code: 'limit' }); await op.quiesced;
    expect(writes).toBe(128); const paths = await readdir(options.directory); expect(paths).toHaveLength(1);
    expect((await lstat(join(options.directory, paths[0]!))).size).toBe(128);
  } finally { await clean(options); }
});
it('denies a writable or symlink directory before creating a pending file', async () => {
  const options = await input();
  try {
    await chmod(options.directory, 0o750);
    const op = publishK6Result(options); expect(await op.result).toMatchObject({ ok: false, code: 'profile' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it.each(['EPERM', 'ENOSYS'])('does not fall back when exclusive hardlink fails with %s', async code => {
  const options = await input(); const io = { ...nodeIo, link: async () => { throw Object.assign(new Error('private'), { code }); } };
  try {
    const op = createPublication(options, io); const result = await op.result; await op.quiesced;
    expect(result).toEqual({ ok: false, code: 'filesystem', publication: 'unconfirmed' });
    expect(await readdir(options.directory)).not.toContain('engine-result.json');
  } finally { await clean(options); }
});
