import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { attemptDeadline, setupDeadline, validateAttempt } from '../../runtime/attempt.js';
import { buildRuntimeScript } from '../../build/index.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from './fixtures.js';
import type { AttemptBudget } from '../../runtime/index.js';

describe('private accepted attempt budget', () => {
  it.each([undefined, {}, { mode: 'managed', timeoutMs: 1 }, { mode: 'standalone', timeoutMs: 0 },
    { mode: 'unknown', timeoutMs: 1000 }, { mode: 'standalone', timeoutMs: 172_800_001 },
    { mode: 'managed', timeoutMs: 1000, deadlineMs: '5000' }, { mode: 'standalone', timeoutMs: 1000, deadlineMs: 5000 },
    { mode: 'managed', timeoutMs: 1000, deadlineMs: Infinity }, { mode: 'standalone', timeoutMs: NaN }])('rejects invalid private options %j', value => {
    expect(() => validateAttempt(value)).toThrow('invalid_limits');
  });
  it('preserves explicit managed authority and checks safe arithmetic', () => {
    expect(attemptDeadline({ mode: 'managed', timeoutMs: 1000, deadlineMs: 1100 }, 1000)).toBe(1100);
    expect(attemptDeadline({ mode: 'managed', timeoutMs: 100, deadlineMs: 5000 }, 1000)).toBe(1100);
    expect(() => attemptDeadline({ mode: 'managed', timeoutMs: 1000, deadlineMs: 999 }, 1000)).toThrow('deadline');
    expect(() => attemptDeadline({ mode: 'standalone', timeoutMs: 1000 }, Number.MAX_SAFE_INTEGER)).toThrow('deadline');
    expect(validateAttempt({ mode: 'standalone', timeoutMs: 172_800_000 })).toEqual({ mode: 'standalone', timeoutMs: 172_800_000 });
  });
  it('keeps standalone metadata reusable and establishes a fresh shared deadline only at setup', () => {
    const metadata = { mode: 'standalone' as const, timeoutMs: 500 };
    expect(attemptDeadline(metadata, 1000)).toBe(1500);
    expect(attemptDeadline(metadata, 9000)).toBe(9500);
    expect(metadata).toEqual({ mode: 'standalone', timeoutMs: 500 });
    expect(setupDeadline({ deadlineMs: 1500 })).toBe(1500);
    for (const missing of [undefined, {}, { deadlineMs: NaN }, { deadlineMs: '1500' }]) expect(() => setupDeadline(missing)).toThrow('deadline');
  });
  it('rejects invalid managed metadata before filesystem effects', async () => {
    const directory = await mkdtemp('/private/tmp/w09-attempt-');
    try {
      await expect(buildRuntimeScript({ suite: compiled(configFor()), outputDirectory: directory,
        attempt: { mode: 'managed', timeoutMs: 1000 } as AttemptBudget })).rejects.toThrow('invalid_limits');
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
