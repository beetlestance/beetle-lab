import type { DatabaseSync } from 'node:sqlite';
import { outputSourceTables, outputParentGuards } from './output-source-schema.js';
import { outputSourceGuards } from './output-source-guards.js';

/** Add empty source accounting without adopting historical filesystem authority. */
export function migration012(db: DatabaseSync): void {
  db.exec(outputSourceTables); db.exec(outputParentGuards); db.exec(outputSourceGuards);
  db.exec('PRAGMA user_version=12');
}
