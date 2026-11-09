import { executionSchema } from './execution-schema.js';
import { executionGuards } from './execution-guards.js';
import { outputGuards } from './output-guards.js';

/** Storage foundation only: no legacy adoption, delivery loop or artifact settlement. */
export const migration005 = `${executionSchema}\n${executionGuards}\n${outputGuards}\nPRAGMA user_version=5;`;
