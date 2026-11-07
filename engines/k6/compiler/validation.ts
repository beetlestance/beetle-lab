import { Ajv2020 } from 'ajv/dist/2020.js';
import { encodeJson } from '@beetle/contracts';
import { schemas } from './generated/schemas.js';
import { compileLoadPlan } from './index.js';
import { limits } from './analysis.js';
import { freezeSchema } from './schema-freeze.js';
import type { Checked, CompiledLoadPlan, LoadPlan, ValidatedLoadPlan } from './types.js';

const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false,
  useDefaults: false, removeAdditional: false, ownProperties: true });
for (const schema of schemas) ajv.addSchema(schema);
const validate = ajv.getSchema<LoadPlan>('https://beetle.test/contracts/engines/k6/v1/load-plan');
if (!validate) throw new Error('Missing shipped k6 load-plan schema');
const loadPlanValidator = validate;

/** Node/build boundary adapter. Bounded JSON snapshot rejects accessors and isolates caller mutation. */
export function validateLoadPlan(input: unknown): Checked<ValidatedLoadPlan> {
  let snapshot: unknown;
  try { snapshot = JSON.parse(encodeJson(input, limits.inputBytes)) as unknown; }
  catch { return { ok: false, issues: Object.freeze([Object.freeze({ path: '', code: 'invalid_json' as const })]) }; }
  if (!loadPlanValidator(snapshot)) return { ok: false, issues: Object.freeze(
    (loadPlanValidator.errors ?? []).slice(0, 16).map(error => Object.freeze({
      path: error.instancePath.slice(0, 256), code: 'schema' as const,
    }))) };
  return { ok: true, value: freezeSchema(snapshot) as ValidatedLoadPlan };
}

export function validateAndCompileLoadPlan(input: unknown): Checked<CompiledLoadPlan> {
  const validated = validateLoadPlan(input);
  return validated.ok ? compileLoadPlan(validated.value) : validated;
}
