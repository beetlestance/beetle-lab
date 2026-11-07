import { Ajv2020 } from 'ajv/dist/2020.js';
import { expect, it } from 'vitest';
import { inferenceSchema } from './inference.js';

it('preserves sibling closure and existing allOf constraints during reference expansion', () => {
  const base = { $id: 'https://schemas.example.invalid/reference-base', type: 'object',
    properties: { count: { type: 'integer' } }, required: ['count'] };
  const source = { $ref: base.$id, type: 'object', unevaluatedProperties: false,
    allOf: [{ type: 'object', properties: { unit: { type: 'string' } } }] };
  const projection = inferenceSchema(source, new Map([[base.$id, base]]));
  const ajv = new Ajv2020({ strict: true }); ajv.addSchema(base);
  const original = ajv.compile(source);
  const expanded = ajv.compile(projection as object);
  for (const [value, accepted] of [
    [{ count: 1 }, true], [{ count: 1, unit: 'requests' }, true],
    [{ count: 1, extra: true }, false], [{ count: 1, unit: 3 }, false], [{}, false],
  ] as const) {
    expect(original(value)).toBe(accepted);
    expect(expanded(value)).toBe(accepted);
  }
});
