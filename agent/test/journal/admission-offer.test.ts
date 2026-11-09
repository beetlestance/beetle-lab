import { expect, it } from 'vitest';
import { encodeJson, RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import { admissionInput, configDigest, isOfferCommand } from '../../src/journal/admission-input.js';
import { offerInput } from '../../src/journal/input.js';
import { registration } from '../catalog/fixtures.js';
import { fullOffer } from '../integration/offer-envelope-fixtures.js';
import { command, original, sha256, shape } from './admission-offer-fixtures.js';

it.each(['nodes', 'depth'] as const)('captures schema-valid original at exact %s boundary without charging wrapper shape', boundary => {
  const job = original(boundary); const input = command(job);
  expect(shape(job)[boundary]).toBe(boundary === 'nodes' ? 65_536 : 64);
  expect(registration().configSchema.validate(job.config)).toBe(true);
  expect(offerInput(job).json).toBe(JSON.stringify(job));
  // This is the old whole-command path, with independently verified overhead.
  expect(shape(input).nodes - shape(job).nodes).toBe(9);
  expect(shape(input).depth - shape(job).depth).toBe(1);
  expect(() => encodeJson(input, RUNNER_MAXIMUM_OFFER_BYTES + 65_536)).toThrow('request_limit');
  const expected = JSON.stringify(input); const captured = admissionInput(input);
  expect(sha256(JSON.stringify(captured))).toBe(sha256(expected));
  expect(captured).not.toBe(input);
  job.config.target = 'https://changed.invalid'; input.validation.manifestId = 'changed'; input.now = 2;
  expect(JSON.stringify(captured)).toBe(expected);
});

it.each(['nodes', 'depth'] as const)('rejects original %s boundary plus one', boundary => {
  const job = original(boundary, boundary === 'nodes' ? 65_537 : 65);
  expect(shape(job)[boundary]).toBe(boundary === 'nodes' ? 65_537 : 65);
  expect(() => offerInput(job)).toThrow('request_limit');
  const input = { ...command(original('depth', 32)), offer: job };
  expect(() => admissionInput(input)).toThrow();
});

it('retains config, Offer byte and per-collection caps', () => {
  const base = original('depth', 32);
  const configOverflow = fullOffer(base, 1_048_577);
  expect(Buffer.byteLength(JSON.stringify(configOverflow.config))).toBe(1_048_577);
  expect(() => configDigest(configOverflow.config)).toThrow();
  expect(() => admissionInput({ ...command(base), offer: configOverflow })).toThrow();
  const offerOverflow = { ...base, padding: 'x'.repeat(RUNNER_MAXIMUM_OFFER_BYTES) };
  expect(Buffer.byteLength(JSON.stringify(offerOverflow))).toBeGreaterThan(RUNNER_MAXIMUM_OFFER_BYTES);
  expect(() => offerInput(offerOverflow)).toThrow('request_limit');
  expect(() => admissionInput({ ...command(base), offer: offerOverflow })).toThrow();
  const collection = original('depth', 32); collection.config.value = Array.from({ length: 4097 }, () => null);
  expect(() => offerInput(collection)).toThrow('request_limit');
  expect(() => admissionInput({ ...command(base), offer: collection })).toThrow();
});

it.each(['kind', 'offer', 'validation', 'now'])('rejects a caller %s accessor without invoking it', field => {
  const input = command(original('depth', 32)); let getters = 0;
  Object.defineProperty(input, field, { enumerable: true, get() { getters++; throw new Error('getter'); } });
  expect(() => admissionInput(input)).toThrow(); expect(getters).toBe(0);
  if (field === 'kind') expect(isOfferCommand(input)).toBe(false);
});

it.each(['extra', 'symbol', 'hidden', 'prototype', 'array'])('rejects unsupported carrier %s shape', kind => {
  const input = command(original('depth', 32));
  if (kind === 'extra') Object.defineProperty(input, 'extra', { enumerable: true, value: true });
  if (kind === 'symbol') Object.defineProperty(input, Symbol('extra'), { value: true });
  if (kind === 'hidden') Object.defineProperty(input, 'now', { enumerable: false });
  if (kind === 'prototype') Object.setPrototypeOf(input, { inherited: true });
  const candidate = kind === 'array' ? Object.assign([], input) : input;
  expect(() => admissionInput(candidate as never)).toThrow();
});

it('retains safe copies, null prototype carriers and validation/timestamp checks', () => {
  const input = command(original('depth', 32));
  expect(admissionInput(Object.assign(Object.create(null) as typeof input, input))).toEqual(input);
  for (const now of [-1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    expect(() => admissionInput({ ...input, now })).toThrow();
  }
  expect(() => admissionInput({ ...input, validation: { ...input.validation, configDigest: 'f'.repeat(64) } })).toThrow();
  expect(() => admissionInput({ ...input, validation: { ...input.validation, catalogVersion: 0 } })).toThrow();
  expect(admissionInput({ kind: 'reservations', limit: 1 })).toEqual({ kind: 'reservations', limit: 1 });
});
