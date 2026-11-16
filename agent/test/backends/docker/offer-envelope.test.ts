import { expect, it } from 'vitest';
import { prepareRuntime } from '../../../src/backends/docker/index.js';
import { makeInput } from './fixtures.js';
import { fullOffer } from '../../integration/offer-envelope-fixtures.js';

it('prepares a full-size Offer without putting config in Docker IO and rejects config+1', () => {
  const input = makeInput(); input.offer = fullOffer(input.offer);
  const prepared = prepareRuntime(input); expect(prepared.ok).toBe(true);
  if (prepared.ok) {
    const text = JSON.stringify(prepared.value.spec);
    expect(Buffer.byteLength(text)).toBeLessThan(65_536); expect(text).not.toContain('🪲');
  }
  input.offer = fullOffer(input.offer, 1_048_577);
  expect(prepareRuntime(input)).toEqual({ ok: false, reason: 'invalid_input' });
});
