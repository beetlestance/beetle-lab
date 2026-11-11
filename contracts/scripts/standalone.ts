import standaloneModule from 'ajv/dist/standalone/index.js';
import type { Ajv2020 } from 'ajv/dist/2020.js';

/** Build-time only, using the same installed AJV version as the schema registries. */
export function standaloneValidators(ajv: Ajv2020, references: Record<string, string>): string {
  const compile = standaloneModule as unknown as (instance: Ajv2020, refs: Record<string, string>) => string;
  return compile(ajv, references);
}
