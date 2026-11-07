const annotations = new Set(['$schema', '$id', '$defs', '$comment', 'title']);
const maps = new Set(['properties', 'patternProperties', 'dependentSchemas']);
const lists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const children = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']);
type Catalogue = ReadonlyMap<string, unknown>;

function resolveReference(reference: string, catalogue: Catalogue): unknown {
  const [id, pointer = ''] = reference.split('#');
  let target = catalogue.get(id ?? '');
  for (const part of pointer.split('/').slice(1)) {
    if (target === null || typeof target !== 'object') throw new Error(`Missing schema reference: ${reference}`);
    target = (target as Record<string, unknown>)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (target === undefined) throw new Error(`Missing schema reference: ${reference}`);
  return target;
}
function child(key: string, value: unknown, catalogue: Catalogue, references: string[]): unknown {
  if (maps.has(key)) return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([name, schema]) => [name, expand(schema, catalogue, references)]));
  if (lists.has(key)) return (value as unknown[]).map(schema => expand(schema, catalogue, references));
  if (children.has(key)) return expand(value, catalogue, references);
  return value;
}
function expand(input: unknown, catalogue: Catalogue, references: string[]): unknown {
  if (typeof input === 'boolean') return input;
  const schema = input as Record<string, unknown>;
  const siblings = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref' && !annotations.has(key))
    .map(([key, value]) => [key, child(key, value, catalogue, references)]));
  if (typeof schema.$ref !== 'string') return siblings;
  if (references.includes(schema.$ref)) throw new Error(`Recursive inference schema: ${schema.$ref}`);
  const resolved = expand(resolveReference(schema.$ref, catalogue), catalogue, [...references, schema.$ref]);
  return Object.keys(siblings).length ? { allOf: [resolved, siblings] } : resolved;
}

/** Exact reference expansion reduces inference depth; wire sources remain authoritative. */
export function inferenceSchema(schema: unknown, catalogue: Catalogue): unknown {
  return expand(schema, catalogue, []);
}
