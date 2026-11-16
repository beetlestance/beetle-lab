import type { ValidateFunction } from 'ajv';
import { schemaValidator } from './schema-validator.js';
import { messageSchemas, schemas } from './generated/schemas.js';
import { schema as common } from './generated/common.js';
import type { Uuid, Cursor, ProtocolTypes, SecretReference, Artifact } from './generated/types.js';
export interface PrimitiveTypes { uuid: Uuid; cursor: Cursor; secretReference: SecretReference; artifact: Artifact }

/** Native runtime factory; web compilation substitutes static validators before bundling. */
export function createRunnerRegistry(source = false) {
  const ajv = schemaValidator(source);
  for (const schema of schemas) ajv.addSchema(schema);
  const references: Record<string, string> = Object.fromEntries(Object.entries(messageSchemas).map(([name, schema]) => [name, schema.$id]));
  const validators = Object.fromEntries(Object.entries(references).map(([name, reference]) => {
    const validator = ajv.getSchema(reference);
    if (!validator) throw new Error(`Missing shipped schema: ${name}`);
    return [name, validator];
  })) as Record<keyof ProtocolTypes, ValidateFunction>;
  const primitives = Object.fromEntries(['uuid', 'cursor', 'secretReference', 'artifact'].map(name => {
    const reference = `${common.$id}#/$defs/${name}`;
    const validator = ajv.getSchema(reference);
    if (!validator) throw new Error(`Missing shipped primitive: ${name}`);
    references[`primitive_${name}`] = reference;
    return [name, validator];
  })) as Record<keyof PrimitiveTypes, ValidateFunction>;
  return { ajv, references, validators, primitives };
}
