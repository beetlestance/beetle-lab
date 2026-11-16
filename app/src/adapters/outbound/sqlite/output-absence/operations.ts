import type { EventBinding } from '../../../../ports/events.js';
import type { OutputAbsenceAdoptRequest, OutputAbsenceFinalizeRequest } from '../../../../ports/output-absence.js';

/** Effect-free RPC identity: schema/error owners may consume it without loading storage. */
export type AbsenceOperation = { kind: 'absenceRead'; binding: EventBinding }
 | { kind: 'absenceAdopt'; request: OutputAbsenceAdoptRequest }
 | { kind: 'absenceFinalize'; request: OutputAbsenceFinalizeRequest };
