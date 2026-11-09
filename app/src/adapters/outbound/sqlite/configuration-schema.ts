import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { sha256 } from './input-values.js';

/** One trusted schema instance serves authoring and execution-intent validation. */
export const k6ConfigSchema = createK6ConfigSchema(sha256);
