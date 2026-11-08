import { readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { EngineResult } from '@beetle/contracts';
import { publishK6Result } from '../../wrapper/publication/index.js';
import type { PublicationOptions } from '../../wrapper/publication/index.js';
import { clean, input } from './fixtures.js';

it.each([0, -1, NaN, Infinity, 1.5, 1_048_577])('denies invalid maximumBytes %s before IO', async maximumBytes => {
  const options = await input();
  try {
    const op = publishK6Result({ ...options, maximumBytes });
    expect(await op.result).toMatchObject({ ok: false, code: 'limit' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it.each([
  { directory: 'relative' }, { directory: '/private/tmp/../tmp/elsewhere' }, { directory: '/private/tmp/\0bad' },
  { uid: -1 }, { uid: 0.5 }, { uid: process.getuid!() + 1 },
  { timeoutMs: 0 }, { timeoutMs: 60_001 }, { deadlineMs: NaN }, { deadlineMs: 0 },
])('denies invalid profile %j before IO', async patch => {
  const options = await input();
  try {
    const op = publishK6Result({ ...options, ...patch }); expect(await op.result).toMatchObject({ ok: false, code: 'profile' });
    await op.quiesced; expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('rejects a symlink directory without entering its target', async () => {
  const options = await input(); const alias = join(options.directory, 'alias');
  try {
    await symlink(options.directory, alias);
    const op = publishK6Result({ ...options, directory: alias }); expect(await op.result).toMatchObject({ ok: false, code: 'profile' });
    await op.quiesced; expect(await readdir(options.directory)).toEqual(['alias']);
  } finally { await clean(options); }
});
it.each(['wrong', 'extra', 'missing'] as const)('requires exact expected scope: %s', async variation => {
  const options = await input();
  try {
    const expectedScope = variation === 'wrong' ? { ...options.expectedScope, generation: 2 }
      : variation === 'extra' ? { ...options.expectedScope, canary: 'private' } : { generation: 1 };
    const op = publishK6Result({ ...options, expectedScope } as PublicationOptions);
    expect(await op.result).toMatchObject({ ok: false, code: 'scope' }); await op.quiesced;
    expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('rejects seal mutation and non-JSON/accessor/oversized data without invoking getters or writing files', async () => {
  const options = await input(); const getter = vi.fn(() => 'private');
  const mutated = structuredClone(options.result) as EngineResult; mutated.generation++;
  const accessor = { ...(options.result as object) }; Object.defineProperty(accessor, 'engineId', { enumerable: true, get: getter });
  try {
    for (const result of [mutated, accessor, { ...(options.result as object), huge: 'x'.repeat(1_048_577) }]) {
      const op = publishK6Result({ ...options, result }); expect(await op.result).toMatchObject({ ok: false, code: 'invalid_result' });
      await op.quiesced;
    }
    expect(getter).not.toHaveBeenCalled(); expect(await readdir(options.directory)).toEqual([]);
  } finally { await clean(options); }
});
it('captures the result, scope, profile and callback before asynchronous clocks or IO can mutate options', async () => {
  const options = await input(); const originalDirectory = options.directory;
  options.wallNow = () => { options.directory = '/not-owned'; options.uid = -1; return Date.now(); };
  const op = publishK6Result(options);
  (options.result as EngineResult).generation = 20;
  options.expectedScope = { ...options.expectedScope, generation: 30 };
  options.deadlineMs = 1; options.maximumBytes = 1; options.wallNow = () => NaN;
  try {
    const result = await op.result; await op.quiesced;
    expect(result.ok).toBe(true); if (!result.ok) throw new Error('publication failed');
    expect(result.value.generation).toBe(1);
    expect(await readdir(originalDirectory)).toEqual(['engine-result.json']);
  } finally { await clean({ ...options, directory: originalDirectory }); }
});
