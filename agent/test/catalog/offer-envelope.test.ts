import { expect, it } from 'vitest';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { offer, registration } from './fixtures.js';
import { fullOffer, hash, jsonBytes } from '../integration/offer-envelope-fixtures.js';

it('snapshots a full1MiB config in its larger Offer and rejects config+1', () => {
  const catalog = createEngineCatalog([registration()]); const job = fullOffer(offer());
  const expected = hash(JSON.stringify(job.config));
  expect(jsonBytes(job.config)).toBe(1_048_576); expect(jsonBytes(job)).toBeGreaterThan(1_048_576);
  const accepted = catalog.preflight(job);
  expect(hash(JSON.stringify(accepted.offer.config))).toBe(expected);
  expect(Object.isFrozen(accepted.offer.config)).toBe(true);
  expect(() => catalog.preflight(fullOffer(job, 1_048_577))).toThrow('invalid_offer');
});
