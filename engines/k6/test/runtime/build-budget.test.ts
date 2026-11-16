import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildRuntimeScript } from '../../build/index.js';
import { writePlanData } from '../../build/serialize.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from './fixtures.js';

it('bounds plan serialization before opening the file under a caller-reserved byte ceiling', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-build-budget-'));
  try {
    const path = join(directory, 'plan.json');
    await expect(writePlanData(path, { text: 'a'.repeat(100) }, 100)).rejects.toThrow('script_limit');
    expect(await readdir(directory)).toEqual([]);
    await expect(writePlanData(path, {}, 0)).rejects.toThrow('script_limit');
    expect(await writePlanData(path, { text: 'a'.repeat(100) }, 111)).toBe(111);
    expect((await stat(path)).size).toBe(111);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('charges simultaneous scratch bytes, accepts the exact build peak and rejects one byte less', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-build-budget-'));
  const suite = compiled(configFor());
  const attempt = { mode: 'standalone' as const, timeoutMs: 1000 };
  try {
    const baseline = await buildRuntimeScript({ suite, attempt, outputDirectory: join(directory, 'baseline') });
    expect(baseline.peakBytes).toBeGreaterThan(baseline.bytes);
    const exact = await buildRuntimeScript({ suite, attempt, outputDirectory: join(directory, 'exact'),
      maximumBuildBytes: baseline.peakBytes });
    expect(exact.peakBytes).toBe(baseline.peakBytes);
    expect(exact.bytes).toBe(baseline.bytes);
    expect((await stat(exact.scriptPath)).mode & 0o777).toBe(0o600);
    const short = join(directory, 'short');
    await expect(buildRuntimeScript({ suite, attempt, outputDirectory: short,
      maximumBuildBytes: baseline.peakBytes - 1 })).rejects.toThrow('script_build_failed');
    expect(await readdir(short)).toEqual([]);
    expect(await readdir(join(directory, 'exact'))).toEqual(['suite.js']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('preserves an existing script instead of overwriting uncharged output', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-build-budget-'));
  try {
    await writeFile(join(directory, 'suite.js'), 'preserve');
    await expect(buildRuntimeScript({ suite: compiled(configFor()), outputDirectory: directory,
      attempt: { mode: 'standalone', timeoutMs: 1000 } })).rejects.toThrow('script_exists');
    expect(await readdir(directory)).toEqual(['suite.js']);
    expect(await readFile(join(directory, 'suite.js'), 'utf8')).toBe('preserve');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid build allowance %s before writes', async maximumBuildBytes => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-build-budget-'));
  try {
    await expect(buildRuntimeScript({ suite: compiled(configFor()), outputDirectory: directory,
      attempt: { mode: 'standalone', timeoutMs: 1000 }, maximumBuildBytes })).rejects.toThrow('script_limit');
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
