import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { encodeJson } from '../json.js';
import type { ResultDigest } from '../result-seal.js';

declare const installed: unique symbol;
export interface ConfigSchema {
  readonly [installed]: true;
  readonly schemaId: string;
  readonly schemaDigest: string;
  /** Structural preflight; compilation and dataset parsing remain admitted engine work. */
  validate(input: unknown): boolean;
}
export class ConfigSchemaError extends Error {
  constructor() { super('Invalid installed configuration schema'); }
}
const installedSchemas = new WeakSet<object>();
export function isConfigSchema(value: unknown): value is ConfigSchema {
  return typeof value === 'object' && value !== null && installedSchemas.has(value);
}
function schemaId(schema: unknown): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new ConfigSchemaError();
  const value = schema as Record<string, unknown>;
  if (typeof value.$id !== 'string' || value.$id.length < 1 || value.$id.length > 512
    || value.$async === true) throw new ConfigSchemaError();
  return value.$id;
}
function bundle(input: readonly unknown[]): { schemas: Record<string, unknown>[]; json: string } {
  const json = encodeJson(input, 262_144); const schemas = JSON.parse(json) as unknown;
  if (!Array.isArray(schemas) || schemas.length < 1 || schemas.length > 16) throw new ConfigSchemaError();
  const ids = new Set<string>();
  for (const schema of schemas) {
    const id = schemaId(schema); if (ids.has(id)) throw new ConfigSchemaError(); ids.add(id);
  }
  return { schemas, json };
}
function fingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
/** Trusted installation schemas only; no network resolution, custom keywords or async validation. */
export function createConfigSchema(input: { schemas: readonly unknown[]; schemaId: string; digest: ResultDigest }): ConfigSchema {
  try {
    const id = input.schemaId; const digest = input.digest; const { schemas, json } = bundle(input.schemas);
    if (typeof id !== 'string' || id.length > 512 || !schemas.some(schema => schema.$id === id)) throw new ConfigSchemaError();
    const ajv = new Ajv2020({ strict: true, allErrors: false, validateFormats: true,
      coerceTypes: false, useDefaults: false, removeAdditional: false });
    const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
    addFormats(ajv); for (const schema of schemas) ajv.addSchema(schema);
    const validator = ajv.getSchema(id);
    if (!validator || ('$async' in validator && validator.$async)) throw new ConfigSchemaError();
    const schemaDigest = digest(`beetle-lab.config-schema.v1\n${id}\n${json}`);
    if (!fingerprint(schemaDigest)) throw new ConfigSchemaError();
    const result = Object.freeze({ schemaId: id, schemaDigest, validate: (raw: unknown) => {
      try { return validator(JSON.parse(encodeJson(raw, 1_048_576))) === true; }
      catch { return false; }
    } }) as ConfigSchema;
    installedSchemas.add(result); return result;
  } catch { throw new ConfigSchemaError(); }
}
