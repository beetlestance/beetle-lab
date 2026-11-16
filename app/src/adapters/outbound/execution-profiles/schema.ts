import { createHash } from 'node:crypto';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
/** One trusted schema instance serves authoring and execution profile validation. */
export const k6ConfigSchema = createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex'));
