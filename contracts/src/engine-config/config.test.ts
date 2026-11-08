import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ConfigSchemaError, createConfigSchema, isConfigSchema } from './index.js';
import { createK6ConfigSchema } from './k6.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const id = 'https://beetle.test/config/fixture';
const schema = () => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: id,
  type: 'object', properties: { count: { type: 'integer', minimum: 1 }, value: { type: 'string', default: 'x' } },
  required: ['count'], additionalProperties: false });
it('strictly preflights bounded copies without coercion, defaults or field removal', () => {
  const validator = createConfigSchema({ schemas: [schema()], schemaId: id, digest });
  const input = { count: 1 }; expect(validator.validate(input)).toBe(true); expect(input).toEqual({ count: 1 });
  expect(validator.validate({ count: '1' })).toBe(false); expect(validator.validate({ count: 1, unknown: true })).toBe(false);
  expect(validator.validate({})).toBe(false); expect(validator.schemaDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.isFrozen(validator)).toBe(true); expect(isConfigSchema(validator)).toBe(true);
  expect(isConfigSchema({ ...validator })).toBe(false);
});
it('pins the installed bundle independently of later caller mutation', () => {
  const source = schema(); const validator = createConfigSchema({ schemas: [source], schemaId: id, digest });
  source.properties.count.minimum = 100; expect(validator.validate({ count: 1 })).toBe(true);
  expect(createConfigSchema({ schemas: [source], schemaId: id, digest }).schemaDigest).not.toBe(validator.schemaDigest);
});
it('rejects oversized/non-JSON configs, accessors and cycles without executing getters', () => {
  const validator = createConfigSchema({ schemas: [schema()], schemaId: id, digest }); let calls = 0;
  expect(validator.validate({ get count() { calls++; return 1; } })).toBe(false); expect(calls).toBe(0);
  const cycle: { next?: unknown } = {}; cycle.next = cycle;
  for (const input of [cycle, { count: 1, value: 'x'.repeat(1_048_576) }, { count: Infinity }, new Date()]) {
    expect(validator.validate(input)).toBe(false);
  }
});
it('rejects async, remote, ambiguous, missing and oversized installed schemas', () => {
  const bad = [[], [schema(), schema()], [{ ...schema(), $async: true }],
    [{ ...schema(), properties: { count: { $ref: 'https://unknown.invalid/schema' } } }],
    [{ ...schema(), description: 'x'.repeat(262_144) }], Array.from({ length: 17 }, (_, n) => ({ ...schema(), $id: `${id}/${n}` }))];
  for (const schemas of bad) expect(() => createConfigSchema({ schemas, schemaId: id, digest })).toThrow(ConfigSchemaError);
  for (const schemaId of ['missing', 'https://json-schema.org/draft/2020-12/schema']) {
    expect(() => createConfigSchema({ schemas: [schema()], schemaId, digest })).toThrow(ConfigSchemaError);
  }
  expect(() => createConfigSchema({ schemas: [schema()], schemaId: id, digest: () => 'bad' })).toThrow(ConfigSchemaError);
});
it('preflights the shipped k6 registry without importing compiler or pretending to validate semantics', () => {
  const validator = createK6ConfigSchema(digest);
  expect(validator.schemaId).toBe('https://beetle.test/contracts/engines/k6/v1/suite');
  expect(validator.validate({})).toBe(false);
  const valid = { version: 1, target: 'https://synthetic.invalid', datasets: [], secrets: [],
    requests: [{ id: 'read', name: 'read', method: 'GET', path: '/', query: {}, headers: {}, assertions: [] }],
    loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
      startTime: '0s', gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '1s' }], slos: [] },
    selections: [{ scenarioId: 'main', entries: [{ requestId: 'read', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }] };
  expect(validator.validate(valid)).toBe(true);
  expect(validator.validate({ ...valid, target: 'not-a-URL' })).toBe(true);
});
