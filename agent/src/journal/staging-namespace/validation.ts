import type { DatabaseSync } from 'node:sqlite';
import { captureNamespaceIntent, captureNamespaceAnchor, captureTaskNamespaceIntent, captureTaskNamespaceAnchor, namespaceCaps } from '../../staging-namespace/index.js';
function parse(value: unknown, cap: number): unknown {
  if (typeof value !== 'string' || value.length > cap || Buffer.byteLength(value) > cap) throw new Error('Invalid namespace JSON');
  return JSON.parse(value) as unknown;
}
export function registerNamespaceValidation(db: DatabaseSync): void {
  db.function('staging_namespace_intent_valid', { deterministic: true }, value => {
    try { captureNamespaceIntent(parse(value, namespaceCaps.intent)); return 1; } catch { return 0; }
  });
  db.function('staging_namespace_anchor_valid', { deterministic: true }, (value, intent) => {
    try { captureNamespaceAnchor(parse(value, namespaceCaps.anchor), captureNamespaceIntent(parse(intent, namespaceCaps.intent))); return 1; } catch { return 0; }
  });
  db.function('task_namespace_intent_valid', { deterministic: true }, value => {
    try { captureTaskNamespaceIntent(parse(value, namespaceCaps.task)); return 1; } catch { return 0; }
  });
  db.function('task_namespace_anchor_valid', { deterministic: true }, (value, intent) => {
    try { captureTaskNamespaceAnchor(parse(value, namespaceCaps.task), captureTaskNamespaceIntent(parse(intent, namespaceCaps.task))); return 1; } catch { return 0; }
  });
}
