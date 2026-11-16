import { expect, it } from 'vitest';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { allocationBinding, eventBinding, executionBinding } from './absence-bindings.js';

const proof = captureOutputAbsence({ version: 1, attemptId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002', workspaceId: '00000000-0000-4000-8000-000000000003',
  intentDigest: 'a'.repeat(64), journalAuthority: '00000000-0000-4000-8000-000000000004',
  generation: 1, finalAgentSeq: 0, admission: { state: 'rejected', reason: 'below_manifest_minimum' }, reason: 'budget_unavailable' });
const runId = '00000000-0000-4000-8000-000000000005';
const scope = { attempt_id: proof.attemptId, run_id: runId, organization_id: proof.organizationId, workspace_id: proof.workspaceId };

it('rejects independently corrupted execution ownership even with a matching embedded snapshot', () => {
  const record = { ...scope, intent_digest: proof.intentDigest, acknowledged_generation: 1, journal_authority: proof.journalAuthority,
    snapshot_json: JSON.stringify({ protocolVersion: '1.0', organizationId: proof.organizationId, workspaceId: proof.workspaceId,
      attemptId: proof.attemptId, generation: 1, intentDigest: proof.intentDigest, state: 'offered', lastSeq: 0,
      retainedStartSeq: 0, cancelRequested: false, admission: proof.admission }) };
  expect(() => executionBinding(record, proof, runId)).not.toThrow();
  for (const field of ['attempt_id', 'run_id', 'organization_id', 'workspace_id', 'intent_digest', 'journal_authority']) {
    expect(() => executionBinding({ ...record, [field]: 'wrong-owner' }, proof, runId)).toThrow(field);
  }
  for (const acknowledged_generation of [null, 0, 2]) {
    expect(() => executionBinding({ ...record, acknowledged_generation }, proof, runId)).toThrow('acknowledged_generation');
  }
});
it('retains the complete allocation and rejects scope/version/credit corruption independently', () => {
  const allocation = { ...scope, version: 1, maximum_payload_bytes: 1024, metadata_bytes: 65536, charged_bytes: 66560 };
  expect(allocationBinding(allocation, proof, runId, 1024)).toBe(allocation);
  for (const field of ['attempt_id', 'run_id', 'organization_id', 'workspace_id']) {
    expect(() => allocationBinding({ ...allocation, [field]: 'wrong-owner' }, proof, runId, 1024)).toThrow(field);
  }
  for (const field of ['version', 'maximum_payload_bytes', 'metadata_bytes', 'charged_bytes']) {
    expect(() => allocationBinding({ ...allocation, [field]: field === 'version' ? 2 : 0 },
      proof, runId, 1024)).toThrow(field);
  }
});
it('rejects event bodies belonging to a different physical attempt scope or generation', () => {
  const event = { attemptId: proof.attemptId, organizationId: proof.organizationId, workspaceId: proof.workspaceId, generation: 1 };
  expect(() => eventBinding(event, proof)).not.toThrow();
  for (const field of ['attemptId', 'organizationId', 'workspaceId']) {
    expect(() => eventBinding({ ...event, [field]: 'wrong-owner' }, proof)).toThrow(field);
  }
  expect(() => eventBinding({ ...event, generation: 2 }, proof)).toThrow('generation');
});
