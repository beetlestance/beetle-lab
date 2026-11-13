import { retirementTables, retirementFences } from './retirement/schema.js';
/** Immutable intent and fences only: no native proof, deletion, ACK or charge release. */
export const migration017 = retirementTables + retirementFences + '\nPRAGMA user_version=17;';
