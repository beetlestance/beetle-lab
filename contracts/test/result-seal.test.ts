import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { engineResultSealPreimage, sealEngineResult, verifyEngineResultSeal } from '../src/index.js';
import { validate } from '../src/validate.js';
import type { EngineResult } from '../src/generated/types.js';
const root = new URL('../fixtures/seal-v1/', import.meta.url);
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
async function fixture(): Promise<EngineResult> { return JSON.parse(await readFile(new URL('passed-result.json', root), 'utf8')) as EngineResult; }
it('matches the independently generated canonical preimage and SHA256 vector', async () => {
  const value = await fixture(); const original = structuredClone(value);
  const expected = await readFile(new URL('passed-result.preimage.txt', root), 'utf8');
  expect(engineResultSealPreimage(value)).toEqual({ ok: true, value: expected });
  expect(sha256(expected)).toBe((await readFile(new URL('passed-result.sha256', root), 'utf8')).trim());
  expect(verifyEngineResultSeal(value, sha256)).toEqual({ ok: true, value });
  const { seal, ...body } = value;
  expect(sealEngineResult(body, seal.sealedAt, sha256)).toEqual({ ok: true, value });
  expect(value).toEqual(original);
});
it('ignores object insertion order while binding sealedAt, scope, observations and artifact identities', async () => {
  const value = await fixture();
  const reversed = Object.fromEntries(Object.entries(value).reverse());
  expect(verifyEngineResultSeal(reversed, sha256).ok).toBe(true);
  const mutate = [
    (copy: EngineResult) => { copy.seal.sealedAt = '2026-01-01T00:00:01Z'; },
    (copy: EngineResult) => { copy.generation++; },
    (copy: EngineResult) => { copy.artifacts[0]!.bytes++; },
    (copy: EngineResult) => { copy.requiredAssertions.passed++; },
  ];
  for (const change of mutate) {
    const copy = structuredClone(value); change(copy); expect(validate('EngineResult', copy).ok).toBe(true);
    expect(verifyEngineResultSeal(copy, sha256)).toEqual({ ok: false, code: 'seal_mismatch' });
  }
});
it('preserves array order and supplies a frozen snapshot without caller aliases', async () => {
  const value = await fixture(); const { seal, ...body } = value;
  body.artifacts.push({ ...body.artifacts[0]!, artifactId: '00000000-0000-4000-8000-000000000099' });
  const result = sealEngineResult(body, seal.sealedAt, sha256);
  expect(result.ok).toBe(true); if (!result.ok) throw new Error('Sealing failed');
  body.artifacts[0]!.bytes++;
  expect(result.value.artifacts[0]!.bytes).toBe(32);
  expect(Object.isFrozen(result.value.artifacts[0])).toBe(true);
  const reordered = structuredClone(result.value); reordered.artifacts.reverse();
  expect(verifyEngineResultSeal(reordered, sha256)).toEqual({ ok: false, code: 'seal_mismatch' });
});
it('rejects non-JSON or oversized bodies and digest failures without invoking accessors or leaking errors', async () => {
  const value = await fixture(); const { seal, ...body } = value; const getter = vi.fn(() => 'PRIVATE_CANARY');
  const accessor = { ...body }; Object.defineProperty(accessor, 'engineId', { enumerable: true, get: getter });
  expect(sealEngineResult(accessor, seal.sealedAt, sha256)).toEqual({ ok: false, code: 'invalid_result' });
  expect(getter).not.toHaveBeenCalled();
  expect(sealEngineResult({ ...body, huge: 'x'.repeat(1_048_577) }, seal.sealedAt, sha256).ok).toBe(false);
  expect(sealEngineResult(value, seal.sealedAt, sha256)).toEqual({ ok: false, code: 'invalid_result' });
  for (const provider of [() => 'bad', () => { throw new Error('PRIVATE_CANARY'); }]) {
    expect(sealEngineResult(body, seal.sealedAt, provider)).toEqual({ ok: false, code: 'digest_failed' });
  }
});
