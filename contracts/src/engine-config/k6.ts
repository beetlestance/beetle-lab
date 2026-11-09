import assertions from '../../engines/k6/v1/assertions.schema.json' with { type: 'json' };
import common from '../../engines/k6/v1/common.schema.json' with { type: 'json' };
import datasets from '../../engines/k6/v1/datasets.schema.json' with { type: 'json' };
import loadPlan from '../../engines/k6/v1/load-plan.schema.json' with { type: 'json' };
import requests from '../../engines/k6/v1/requests.schema.json' with { type: 'json' };
import scenarios from '../../engines/k6/v1/scenarios.schema.json' with { type: 'json' };
import suiteCommon from '../../engines/k6/v1/suite-common.schema.json' with { type: 'json' };
import suite from '../../engines/k6/v1/suite.schema.json' with { type: 'json' };
import { createConfigSchema } from './index.js';
import type { ConfigSchema } from './index.js';
import type { ResultDigest } from '../result-seal.js';

/** Same language-neutral sources used by engine generation; no engine implementation import. */
export function createK6ConfigSchema(digest: ResultDigest): ConfigSchema {
  return createConfigSchema({ schemas: [assertions, common, datasets, loadPlan, requests, scenarios, suiteCommon, suite],
    schemaId: suite.$id, digest });
}

export { prepareK6SecretReferences } from './k6-bindings.js';
export type { K6SecretBindings } from './k6-bindings.js';
