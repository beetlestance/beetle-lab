import type { ValidateFunction } from 'ajv';
import { schemaValidator } from '../schema-validator.js';
import { apiMessageSchemas, apiSchemas } from './generated/schemas.js';
import type { ApiTypes } from './generated/types.js';

/** Browser builds replace this factory with the same schemas' standalone functions. */
export function createApiRegistry(source = false) {
  const ajv = schemaValidator(source);
  for (const schema of apiSchemas) ajv.addSchema(schema);
  const references = Object.fromEntries(Object.entries(apiMessageSchemas).map(([name, schema]) => [name, schema.$ref]));
  const validators = Object.fromEntries(Object.entries(references).map(([name, reference]) => {
    const validator = ajv.getSchema(reference);
    if (!validator) throw new Error(`Missing shipped API schema: ${name}`);
    return [name, validator];
  })) as Record<keyof ApiTypes, ValidateFunction>;
  return { ajv, references, validators };
}
