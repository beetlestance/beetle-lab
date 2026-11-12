import { RUNNER_MAXIMUM_OFFER_BYTES } from '../limits.js';
export const EXPORT_ASSIGNMENT_BYTES = RUNNER_MAXIMUM_OFFER_BYTES + 8192;
export const EXPORT_RESULT_BYTES = 8192;
export const EXPORT_CONTROL_BYTES = 65536;
export type ExportContractCode = 'invalid_assignment' | 'unsupported_secrets' | 'budget_exceeded' | 'digest_failed' | 'digest_mismatch' | 'invalid_result' | 'binding_mismatch';
export class ExportContractError extends Error {
  constructor(readonly code: ExportContractCode) {super('Standalone export contract rejected');}
}
