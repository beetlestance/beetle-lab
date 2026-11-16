import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { AnySchema, AnySchemaObject } from 'ajv';
import type { FastifyInstance } from 'fastify';

export interface SchemaCompilerOptions {
  /** Shipped catalogue only. Never accept schemas from an HTTP request. */
  schemas: readonly AnySchemaObject[];
  /** Must reject non-JSON/accessors and bound allocation before returning. */
  encodeJson: (input: unknown, maximumBytes: number) => string;
  maximumResponseBytes?: number;
}

export class ResponseContractError extends Error {
  readonly code = 'RESPONSE_CONTRACT_INVALID';
  constructor() {
    super('Response does not satisfy its contract');
    this.name = 'ResponseContractError';
  }
}

function responseLimit(requested = 1_048_576): number {
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > 16_777_216) {
    throw new RangeError('Response limit must be between 1 and 16777216 bytes');
  }
  return requested;
}

function responseText(input: unknown, encodeJson: SchemaCompilerOptions['encodeJson'], limit: number): string {
  try {
    const text = encodeJson(input, limit);
    if (Buffer.byteLength(text, 'utf8') > limit) throw new ResponseContractError();
    return text;
  } catch { throw new ResponseContractError(); }
}

/** Configure before routes. Validates replies when Fastify invokes its JSON serializer. */
export function configureSchemaCompilers(server: FastifyInstance, options: SchemaCompilerOptions): void {
  const maximum = responseLimit(options.maximumResponseBytes);
  const encodeJson = options.encodeJson;
  const ajv = new Ajv2020({ strict: true, allErrors: false, validateFormats: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false });
  const addFormats = addFormatsModule as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  for (const schema of options.schemas) ajv.addSchema(schema);
  server.setValidatorCompiler<AnySchema>(({ schema }) => ajv.compile(schema));
  server.setSerializerCompiler<AnySchema>(({ schema }) => {
    const validate = ajv.compile(schema);
    return (input: unknown): string => {
      const text = responseText(input, encodeJson, maximum);
      let json: unknown;
      try { json = JSON.parse(text) as unknown; }
      catch { throw new ResponseContractError(); }
      if (!validate(json)) throw new ResponseContractError();
      return text;
    };
  });
}
