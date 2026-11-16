import type { DatabaseSync } from 'node:sqlite';
import { preflightPayloads, convertPayloads } from './output-payloads/migrate.js';
import { payloadSchema } from './output-payloads/schema.js';
import { payloadGuards, headerGuards } from './output-payloads/guards.js';
import { installEventPayloadGuard } from './output-payloads/event-guard.js';

/** Caller retains one immediate migration transaction; no historical authority guard is relaxed. */
export function migrate008(db: DatabaseSync): void {
  preflightPayloads(db);
  db.exec(payloadSchema);
  convertPayloads(db);
  db.exec(payloadGuards + headerGuards);
  installEventPayloadGuard(db);
  db.exec('PRAGMA user_version=8');
}
