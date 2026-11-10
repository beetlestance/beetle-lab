import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { captureRunArtifactCursor, encodeRunArtifactCursor } from '@beetle/contracts/api';
import type { Run, RunArtifactPage } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { EventBinding } from '../../../../ports/events.js';
import { captureEventBinding } from '../../../../domain/events/index.js';
import { readEnvelope, loadOutput } from '../output-custody/index.js';
import { OutputAbsences } from '../output-absence/index.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { captureArtifactReadOperation, captureArtifactReadReply } from './wire.js';
import type { ArtifactReadOperation } from './wire.js';
export { artifactReadOperation, captureArtifactReadOperation, captureArtifactReadReply } from './wire.js';
export type { ArtifactReadOperation } from './wire.js';
type Row = Record<string, SQLOutputValue>;
function requireEvidence(condition: unknown): asserts condition { if (!condition) throw new StorageError('unavailable'); }
function matches(row: Row, binding: EventBinding): void {
  const a = binding.key.attempt;
  requireEvidence(row.attempt_id === a.attemptId && row.run_id === binding.key.runId && row.organization_id === a.organizationId
    && row.workspace_id === a.workspaceId && row.intent_digest === a.intentDigest && row.generation === 1 && row.journal_authority === binding.journalAuthority);
}
/** Read-only publication evidence. Uses bounded shared source/slot readers, never a writer or native file probe. */
export class RunArtifacts {
  constructor(private readonly db: DatabaseSync, private readonly runs: {get(key: RunKey): Run}) {}
  execute(input: ArtifactReadOperation): RunArtifactPage | OutputFileRecord {
    const operation = captureArtifactReadOperation(input);
    return transaction(this.db, () => captureArtifactReadReply(operation, this.read(operation)));
  }
  private read(operation: ArtifactReadOperation): unknown {
    const key = operation.kind === 'listRunArtifacts' ? operation.query : operation.key;
    const run = this.runs.get(key); const binding = this.binding(run, key.attemptId);
    const page: RunArtifactPage = {id: run.id, scope: run.scope, attemptId: key.attemptId, generation: 1,
      availability: 'pending', manifestDigest: null, items: [], nextCursor: null};
    const final = this.db.prepare('SELECT * FROM execution_output_finalizations WHERE attempt_id=?').get(key.attemptId);
    const absent = this.db.prepare('SELECT * FROM execution_output_absence_finalizations WHERE attempt_id=?').get(key.attemptId);
    requireEvidence(!(final && absent));
    if (!binding) { requireEvidence(!final && !absent); return this.unready(operation, page); }
    const source = readEnvelope(this.db, binding);
    if (absent) {
      matches(absent, binding); requireEvidence(source === null);
      const proof = new OutputAbsences(this.db).read(binding);
      requireEvidence(proof && 'proofDigest' in proof && proof.proofDigest === absent.proof_digest
        && proof.closure.finalAgentSeq === absent.final_agent_seq);
      return this.unready(operation, {...page, availability: 'absent'});
    }
    if (!final) {
      this.pendingSource(operation, binding, source);
      return this.unready(operation, page);
    }
    return this.published(operation, page, binding, final, source);
  }
  private pendingSource(operation: ArtifactReadOperation, binding: EventBinding, source: ReturnType<typeof readEnvelope>): void {
    if (!source) return;
    // Validate bounded persisted slot structure even before publication is complete.
    requireEvidence(loadOutput(this.db, binding).kind === 'adopted');
    if (operation.kind === 'getRunArtifact' && !source.manifest.result.artifacts.some(a => a.artifactId === operation.key.artifactId)) {
      throw new StorageError('not_found');
    }
  }
  private published(operation: ArtifactReadOperation, page: RunArtifactPage, binding: EventBinding,
    final: Row, source: ReturnType<typeof readEnvelope>): unknown {
    matches(final, binding);
    requireEvidence(source && final.source_digest === source.sourceDigest && final.manifest_digest === source.manifest.manifestDigest
      && final.final_agent_seq === source.closure.finalAgentSeq);
    const state = loadOutput(this.db, binding);
    requireEvidence(state.kind === 'adopted' && state.artifacts.every(a => a.phase === 'published' && a.offset === a.bytes && a.identity !== null && a.writer === null));
    if (operation.kind === 'getRunArtifact') {
      const artifact = state.artifacts.find(a => a.artifactId === operation.key.artifactId);
      if (!artifact) throw new StorageError('not_found');
      return {binding, artifact};
    }
    return this.page(operation, {...page, availability: 'ready', manifestDigest: source.manifest.manifestDigest}, source.manifest.result.artifacts);
  }
  private unready(operation: ArtifactReadOperation, page: RunArtifactPage): RunArtifactPage {
    if (operation.kind === 'getRunArtifact') throw new StorageError(page.availability === 'pending' ? 'conflict' : 'not_found');
    if (operation.query.cursor !== undefined) throw new StorageError('invalid_input');
    return page;
  }
  private page(operation: Extract<ArtifactReadOperation, {kind: 'listRunArtifacts'}>, page: RunArtifactPage, artifacts: Readonly<RunArtifactPage['items']>): RunArtifactPage {
    const query = operation.query; const start = query.cursor === undefined ? null : captureRunArtifactCursor(query.cursor);
    const ordinal = start?.ordinal ?? 0;
    if (start) checkPosition(start, page, artifacts.length);
    const items = artifacts.slice(ordinal, ordinal + query.limit); const next = ordinal + items.length;
    return {...page, items, nextCursor: next < artifacts.length ? encodeRunArtifactCursor({lane: 'artifacts',
      organizationId: page.scope.organizationId, workspaceId: page.scope.workspaceId, runId: page.id, attemptId: page.attemptId,
      generation: 1, manifestDigest: page.manifestDigest!, ordinal: next}) : null};
  }
  private binding(run: Run, attemptId: string): EventBinding | null {
    const row = this.db.prepare(`SELECT t.intent_digest,t.generation,e.acknowledged_generation,e.journal_authority,
      e.run_id,e.organization_id,e.workspace_id,e.intent_digest retained_digest,
      EXISTS(SELECT 1 FROM execution_output_sources s WHERE s.attempt_id=t.id) has_source
      FROM attempts t LEFT JOIN execution_records e ON e.attempt_id=t.id
      WHERE t.id=? AND t.run_id=? AND t.organization_id=? AND t.workspace_id=?`)
      .get(attemptId, run.id, run.scope.organizationId, run.scope.workspaceId);
    if (!row) throw new StorageError('not_found');
    requireEvidence(row.run_id === null || (row.run_id === run.id && row.organization_id === run.scope.organizationId
      && row.workspace_id === run.scope.workspaceId && row.retained_digest === row.intent_digest));
    if (row.acknowledged_generation === null) { requireEvidence(row.has_source === 0 && row.generation === null); return null; }
    requireEvidence(row.acknowledged_generation === 1 && row.generation === 1);
    return captureEventBinding({key: {runId: run.id, attempt: {organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId, attemptId, intentDigest: row.intent_digest, generation: 1}}, journalAuthority: row.journal_authority});
  }
}

function checkPosition(start: ReturnType<typeof captureRunArtifactCursor>, page: RunArtifactPage, length: number): void {
  if (start.runId !== page.id || start.attemptId !== page.attemptId || start.organizationId !== page.scope.organizationId
    || start.workspaceId !== page.scope.workspaceId || start.manifestDigest !== page.manifestDigest || start.ordinal >= length) {
    throw new StorageError('invalid_input');
  }
}
