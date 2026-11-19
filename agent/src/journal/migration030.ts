import { K6_WRAPPER_OUTPUT_LIMIT_EXIT } from '@beetle/contracts/k6-diagnostics';
import { absenceFacts } from './output-absence-facts.js';

const exit = (field: string) => `json_extract(COALESCE(a.exit_facts_json,a.exit_json,'{}'),'$.${field}')`;
const physicalOutputLimit = `WHEN k.cancel_reason='cancelled' AND ${exit('reason')}='output_limit'
  AND ${exit('exitCode')}=${K6_WRAPPER_OUTPUT_LIMIT_EXIT} THEN 'output_limit' `;

const projection = absenceFacts.replace(
  'CASE WHEN k.cancel_reason IN',
  `CASE ${physicalOutputLimit}WHEN k.cancel_reason IN`,
);
if (projection === absenceFacts) throw new Error('Unexpected predecessor absence projection');

/** Preserve the typed physical stop against a racing user cancellation. */
export const migration030 = `
DROP VIEW output_absence_facts;
${projection}
PRAGMA user_version=30;
`;
