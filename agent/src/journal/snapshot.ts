import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot } from '@beetle/contracts';
import { admissionSnapshot } from './admission-snapshot.js';
import { snapshot as sequenceSnapshot } from './sql.js';
import type { Row } from './sql.js';

export function snapshot(db: DatabaseSync, row: Row): AttemptSnapshot {
  const admission = admissionSnapshot(db, row);
  return { ...sequenceSnapshot(row), ...(admission === undefined ? {} : { admission }) };
}
