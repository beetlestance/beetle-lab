import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import common from '../../engines/k6/v1/common.schema.json' with { type: 'json' };
import datasets from '../../engines/k6/v1/datasets.schema.json' with { type: 'json' };
import suiteCommon from '../../engines/k6/v1/suite-common.schema.json' with { type: 'json' };
import { encodeJson } from '../json.js';

let validators: { dataset: ValidateFunction; secret: ValidateFunction; scalar: ValidateFunction } | undefined;
function bundledValidators() {
  if (validators) return validators;
  const ajv = new Ajv2020({
    strict: true,
    allErrors: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  for (const schema of [common, suiteCommon, datasets]) ajv.addSchema(schema);
  const dataset = ajv.getSchema(datasets.$id);
  const secret = ajv.getSchema(`${suiteCommon.$id}#/$defs/secret`);
  const scalar = ajv.getSchema(`${suiteCommon.$id}#/$defs/scalar`);
  if (!dataset || !secret || !scalar) throw Error('Missing bundled k6 draft schema');
  validators = { dataset, secret, scalar };
  return validators;
}
/** Editor structural checks from the engine's language-neutral schemas. Does not qualify an installed engine or compile a suite. */
export function validateK6DraftPart(part: 'dataset' | 'secret' | 'scalar', value: unknown): boolean {
  try {
    const input: unknown = JSON.parse(encodeJson(value, 1_048_576));
    return bundledValidators()[part](input) === true;
  } catch {
    return false;
  }
}
