import type { OutputAbsence, Owned } from '@beetle/contracts/output-source';
import type { Scope } from '../admission/index.js';

export const OUTPUT_ABSENCE_ROW_ALLOWANCE = 256;
/** Trusted caller first retires actual native producers. The worker derives all
 * facts and the stream end; no HTTP/wrapper route can invoke close.
 */
export interface JournalOutputAbsence {
  closeOutputAbsence(key: Scope): Promise<Owned<OutputAbsence> | null>;
  readOutputAbsence(key: Scope): Promise<Owned<OutputAbsence> | null>;
}
export type OutputAbsenceOperation =
  | { readonly kind: 'outputAbsenceClose'; readonly key: Readonly<Scope> }
  | { readonly kind: 'outputAbsenceRead'; readonly key: Readonly<Scope> };
