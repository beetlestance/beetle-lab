import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES } from '@beetle/contracts/output-source';
import { captureTaskNamespaceState, namespaceCaps } from '../../staging-namespace/index.js';
import { captureRetirementIntent, retirementTaskSnapshot, retirementDigest } from '../../retirement-values/index.js';
import { cleanupControl } from '../../cleanup-control/index.js';
function text(value: unknown, cap: number): string {
  if (typeof value !== 'string' || value.length > cap || Buffer.byteLength(value) > cap) throw new Error('Invalid retirement metadata'); return value;
}
export function registerRetirementValidation(db: DatabaseSync): void {
  db.function('retirement_intent_valid', { deterministic: true }, input => {
    try { captureRetirementIntent(JSON.parse(text(input, cleanupControl.intentBytes)) as unknown); return 1; } catch { return 0; }
  });
  db.function('retirement_absence_digest', { deterministic: true }, input => {
    try {
      const raw = text(input, OUTPUT_ABSENCE_BYTES); const proof = captureOutputAbsence(JSON.parse(raw) as unknown);
      const json = encodeCanonicalJson(proof, OUTPUT_ABSENCE_BYTES); return raw === json ? retirementDigest(json) : null;
    } catch { return null; }
  });
  db.function('retirement_task_matches', { deterministic: true }, (input, state, intent, anchor) => {
    try {
      const record = captureRetirementIntent(JSON.parse(text(input, cleanupControl.intentBytes)) as unknown);
      const task = state === null && intent === null && anchor === null ? null : { state,
        intent: JSON.parse(text(intent, namespaceCaps.task)) as unknown,
        ...(state === 'prepared' ? { anchor: JSON.parse(text(anchor, namespaceCaps.task)) as unknown } : {}) };
      const snapshot = retirementTaskSnapshot(captureTaskNamespaceState(task));
      return encodeCanonicalJson(record.task, 512) === encodeCanonicalJson(snapshot, 512) ? 1 : 0;
    } catch { return 0; }
  });
}
