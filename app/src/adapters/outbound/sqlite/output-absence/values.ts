import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { sha256 } from '../input-values.js';
/** Native writes fail closed unless the same bounded canonical codec verifies them. */
export function registerAbsenceValidation(db: DatabaseSync): void {
  db.function('output_absence_digest', { deterministic: true }, input => {
    if (typeof input !== 'string' || Buffer.byteLength(input) > 2048) return null;
    try {
      const proof = captureOutputAbsence(JSON.parse(input) as unknown);
      const canonical = encodeCanonicalJson(proof, 2048);
      return canonical === input ? sha256(canonical) : null;
    } catch { return null; }
  });
}
