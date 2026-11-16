import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { captureStandaloneExportResult } from '@beetle/contracts';
import type { AgentEvent } from '@beetle/contracts';
import { readExport } from './export-assignment.js';
import { Failure } from './sql.js';
import type { Row } from './sql.js';
/** Source labels cannot change the purpose of the original accepted execution. */
export function requireEventPurpose(db: DatabaseSync, row: Row, event: AgentEvent): void {
  if (event.source !== 'wrapper' || !['engine.result','export.result','case.result'].includes(event.kind)) return;
  if (event.kind === 'export.result') {
    if (row.execution_purpose !== 'standalone_export') throw new Failure('conflict');
    const assignment=readExport(db,{attemptId:row.attempt_id,organizationId:row.organization_id,workspaceId:row.workspace_id});
    if (!assignment || event.phase !== 'seal') throw new Failure('conflict');
    try {captureStandaloneExportResult(event.payload,assignment,text=>createHash('sha256').update(text).digest('hex'));}
    catch {throw new Failure('conflict');}
  } else if (row.execution_purpose !== 'performance') throw new Failure('conflict');
}
