import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.js';
import { fixture, vectors } from './fixtures.js';

const all = await vectors();
describe('fixed JSON conformance vectors', () => {
  for (const vector of all) {
    it(`${vector.valid ? 'accepts' : 'rejects'} ${vector.path}`, async () => {
      const input = await fixture(vector.path);
      const original = structuredClone(input);
      const result = validate(vector.schema, input);
      expect(result.ok).toBe(vector.valid);
      expect(input).toEqual(original);
      if (result.ok) expect(result.value).toBe(input);
      else expect(result.issues.length).toBeGreaterThan(0);
    });
  }
});

it('V11 rejects exit zero with no complete sealed engine evidence', async () => {
  const minimal = await fixture('invalid/exit-zero-alone.json');
  expect(validate('EngineResult', minimal).ok).toBe(false);
  const discovery = await fixture('valid/discovery-expected-abort.json');
  expect(validate('EngineResult', discovery).ok).toBe(true);
  expect(validate('EngineResult', await fixture('invalid/discovery-unrelated-failure.json')).ok).toBe(false);
});

it('V12 keeps shape validation separate from generation, replay and namespace comparison', async () => {
  const input = await fixture('valid/agent-progress.json') as Record<string, unknown>;
  input.generation = 42;
  input.organizationId = '00000000-0000-4000-8000-000000000099';
  // A different, structurally valid owner is compared with stored identity by the consumer.
  expect(validate('AgentEvent', input).ok).toBe(true);
  expect(validate('AgentEvent', structuredClone(input)).ok).toBe(true);
  input.generation = 0;
  expect(validate('AgentEvent', input).ok).toBe(false);
});

it('V23 enforces draft 2020-12 unevaluatedProperties across allOf', async () => {
  const input = await fixture('valid/events.json') as Record<string, unknown>;
  expect(validate('EventBatch', input).ok).toBe(true);
  input.extra = 'synthetic-secret-canary';
  const result = validate('EventBatch', input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issues.some(issue => issue.code === 'unevaluatedProperties')).toBe(true);
});

it('returns immutable copied structural errors without values, params or messages', async () => {
  const result = validate('Offer', await fixture('invalid/environment-map.json'));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('invalid offer accepted');
  const snapshot = structuredClone(result.issues);
  expect(Object.isFrozen(result.issues)).toBe(true);
  expect(result.issues.every(Object.isFrozen)).toBe(true);
  expect(JSON.stringify(result.issues)).not.toMatch(/canary|TOKEN|environment|params|message|schemaPath/);
  validate('Offer', {});
  expect(result.issues).toEqual(snapshot);
});

it('rejects non-JSON numeric budgets without normalization', async () => {
  const input = await fixture('valid/offer.json') as { budget: { cpuMillis: unknown } };
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, null, true, '1000']) {
    input.budget.cpuMillis = value;
    expect(validate('Offer', input).ok).toBe(false);
    expect(Object.is(input.budget.cpuMillis, value)).toBe(true);
  }
});
