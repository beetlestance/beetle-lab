import { expect, it } from 'vitest';
import { validate, encodeJson, RUNNER_MAXIMUM_CONFIG_BYTES, RUNNER_MAXIMUM_OFFER_BYTES } from '../src/index.js';
import type { Offer } from '../src/index.js';
import { fixture } from './fixtures.js';

const base = await fixture('valid/offer.json') as Offer;
function config(bytes: number): Record<string, unknown> {
  const empty = { value: '' };
  const content = bytes - Buffer.byteLength(JSON.stringify(empty));
  return { value: 'é'.repeat(Math.floor(content / 2)) + 'x'.repeat(content % 2) };
}

it('retains an exact one MiB multibyte config independently of its Offer envelope', () => {
  const input = { ...base, config: config(1_048_576) };
  expect(Buffer.byteLength(JSON.stringify(input.config))).toBe(1_048_576);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(1_048_576);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(2_097_152);
  const result = validate('Offer', input);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value).toBe(input);
  expect(JSON.parse(encodeJson(input, RUNNER_MAXIMUM_OFFER_BYTES))).toEqual(input);
});

it('rejects one extra config byte even when the complete envelope fits', () => {
  const input = { ...base, config: config(1_048_577) };
  expect(Buffer.byteLength(JSON.stringify(input.config))).toBe(1_048_577);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(2_097_152);
  expect(validate('Offer', input)).toEqual({ ok: false, issues: [{ path: '/config', code: 'limit' }] });
});

it('measures escaped JSON bytes and preserves the independent config limit', () => {
  const input = { ...base, config: { value: '\n'.repeat(524_283) } };
  expect(Buffer.byteLength(JSON.stringify(input.config))).toBeGreaterThan(RUNNER_MAXIMUM_CONFIG_BYTES);
  expect(validate('Offer', input).ok).toBe(false);
});

it('bounds cyclic or excessively deep config without leaking its content', () => {
  const cyclic: Record<string, unknown> = { canary: 'private-value' }; cyclic.self = cyclic;
  expect(validate('Offer', { ...base, config: cyclic })).toEqual({ ok: false, issues: [{ path: '/config', code: 'limit' }] });
  let deep: Record<string, unknown> = {};
  for (let depth = 0; depth < 66; depth++) deep = { nested: deep };
  expect(validate('Offer', { ...base, config: deep }).ok).toBe(false);
});
