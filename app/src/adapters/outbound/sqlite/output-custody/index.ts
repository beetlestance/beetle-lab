import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputAdoptRequest, OutputCustodyState } from '../../../../ports/output-custody.js';
import type { EventBinding } from '../../../../ports/events.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { original, pins, readEnvelope } from './source.js';
import { scanOutputs } from './scan.js';
import { captureOutputOperation, captureOutputReply } from './wire.js';
import type { OutputOperation, OutputValue } from './wire.js';
export { outputOperation, captureOutputOperation, captureOutputReply, outputReplyLimit } from './wire.js';
export type { OutputOperation } from './wire.js';
export class OutputCustody {
  constructor(private readonly db: DatabaseSync, private readonly installation: string) {}
  execute(input: OutputOperation): OutputValue {
    let operation: OutputOperation;
    try { operation = captureOutputOperation(input); } catch { throw new StorageError('invalid_input'); }
    const result = transaction(this.db, () => {
      switch (operation.kind) {
        case 'outputScan': return scanOutputs(this.db, this.installation, operation.query);
        case 'outputLoad': return this.load(operation.binding);
        case 'outputReadSource': return readEnvelope(this.db, operation.binding);
        case 'outputAdopt': return this.adopt(operation.request);
      }
    });
    return captureOutputReply(operation, result);
  }
  private load(binding: EventBinding): OutputCustodyState {
    const source = readEnvelope(this.db, binding, false);
    if (!source) return { kind: 'pending', binding };
    const rows = this.db.prepare(`SELECT ordinal,CASE WHEN length(CAST(slot_json AS BLOB))<=256
      THEN slot_json ELSE NULL END slot_json FROM execution_output_slots WHERE attempt_id=? ORDER BY ordinal LIMIT 129`)
      .all(binding.key.attempt.attemptId);
    if (rows.length !== source.manifest.result.artifacts.length) throw new StorageError('unavailable');
    const artifacts = rows.map((row, ordinal) => {
      if (row.ordinal !== ordinal || typeof row.slot_json !== 'string') throw new StorageError('unavailable');
      const slot = JSON.parse(row.slot_json) as {v: number; t: string; o: number; p: 'transferring'; i: null; w: null};
      const artifact = source.manifest.result.artifacts[ordinal]!;
      return { ordinal, artifactId: artifact.artifactId, bytes: artifact.bytes, sha256: artifact.sha256,
        token: slot.t, offset: slot.o, phase: slot.p, identity: slot.i, writer: slot.w, version: slot.v };
    });
    return { kind: 'adopted', binding, manifestDigest: source.manifest.manifestDigest, sourceDigest: source.sourceDigest,
      finalAgentSeq: source.closure.finalAgentSeq, version: 1, artifacts };
  }
  private adopt(request: OutputAdoptRequest): OutputCustodyState {
    const checked = captureOutputOperation({ kind: 'outputAdopt', request });
    if (checked.kind !== 'outputAdopt') throw new StorageError('invalid_input');
    const { binding } = checked.request; const envelope = checked.request.envelope;
    pins(envelope, binding, original(this.db, binding));
    const previous = readEnvelope(this.db, binding);
    if (previous) {
      if (encodeCanonicalJson(previous, 75776) !== encodeCanonicalJson(envelope, 75776)) throw new StorageError('conflict');
      return this.load(binding);
    }
    const attempt = binding.key.attempt; const text = encodeCanonicalJson(envelope.manifest, 73728);
    const old = this.db.prepare('SELECT kind FROM execution_output_payloads WHERE attempt_id=?').get(attempt.attemptId);
    if (old) this.db.prepare("UPDATE execution_output_payloads SET kind='manifest',canonical_json=? WHERE attempt_id=?").run(text, attempt.attemptId);
    else this.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(attempt.attemptId, text);
    this.db.prepare(`INSERT INTO execution_output_sources(attempt_id,run_id,organization_id,workspace_id,intent_digest,
      journal_authority,generation,version,source_digest,manifest_digest,final_agent_seq,closure_json) VALUES(?,?,?,?,?,?,1,1,?,?,?,?)`)
      .run(attempt.attemptId, binding.key.runId, attempt.organizationId, attempt.workspaceId, attempt.intentDigest,
        binding.journalAuthority, envelope.sourceDigest, envelope.manifest.manifestDigest, envelope.closure.finalAgentSeq,
        encodeCanonicalJson(envelope.closure, 2048));
    const insert = this.db.prepare('INSERT INTO execution_output_slots VALUES(?,?,?)');
    envelope.manifest.result.artifacts.forEach((_, ordinal) => insert.run(attempt.attemptId, ordinal,
      encodeCanonicalJson({ v: 1, t: randomUUID(), o: 0, p: 'transferring', i: null, w: null }, 256)));
    return this.load(binding);
  }
}
