import { expect, it } from 'vitest';
import { apiOperations } from '../../../src/api/index.js';
import { prepareInput, operationPath } from '../../../src/api/client/input.js';
import { API_MAXIMUM_JSON_BYTES } from '../../../src/api/limits.js';
import { fixture } from '../fixtures.js';

it('preserves exact metric selection and time bounds in generated operation URLs', async () => {
  const operation = apiOperations.find(value => value.name === 'getRunMetricSamples')!;
  const params = await fixture('valid/run-attempt-params.json');
  const query = { seriesOrdinal: 0, limit: 100, fromTimeMs: 0, toTimeMs: 8640000000000000, cursor: 'safe_A-1' };
  const prepared = prepareInput(operation, { params, query }, API_MAXIMUM_JSON_BYTES);
  expect(prepared).toBeDefined();
  const url = new URL(operationPath(operation, prepared!), 'https://api.invalid');
  expect(Object.fromEntries(url.searchParams)).toEqual({ seriesOrdinal: '0', limit: '100',
    fromTimeMs: '0', toTimeMs: '8640000000000000', cursor: 'safe_A-1' });
  expect(query.seriesOrdinal).toBe(0);
  expect(prepareInput(operation, { params, query: { ...query, seriesOrdinal: '0' } }, API_MAXIMUM_JSON_BYTES)).toBeUndefined();
});
it('retains ordinary page query URLs without adding metric fields', async () => {
  const operation = apiOperations.find(value => value.name === 'listRunArtifacts')!;
  const prepared = prepareInput(operation, { params: await fixture('valid/run-attempt-params.json'), query: { limit: 1 } }, API_MAXIMUM_JSON_BYTES);
  expect(operationPath(operation, prepared!)).toMatch(/\?limit=1$/);
});
