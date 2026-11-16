import { expect, it } from 'vitest';
import { MetricReadError } from '../../../ports/run-metrics.js';
import { createApiServer } from './api-errors.js';

it.each([
  ['invalid_input', 400, 'malformed_request'], ['busy', 503, 'capacity_unavailable'],
  ['closed', 503, 'storage_unavailable'], ['cancelled', 503, 'storage_unavailable'],
  ['deadline', 503, 'storage_unavailable'], ['integrity', 503, 'storage_unavailable'],
  ['unavailable', 503, 'storage_unavailable'],
] as const)('maps metric %s to fixed safe HTTP error', async (code, status, publicCode) => {
  const server = createApiServer();
  server.get('/metric-error', async () => { const error = new MetricReadError(code);
    error.message = 'SYNTHETIC_PRIVATE_METRIC'; throw error; });
  try {
    const response = await server.inject('/metric-error');
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code: publicCode, fields: [] });
    expect(response.body).not.toContain('SYNTHETIC_PRIVATE_METRIC');
  } finally { await server.close(); }
});
