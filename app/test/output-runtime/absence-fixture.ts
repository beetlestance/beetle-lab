import { createHash } from 'node:crypto';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputAbsence } from '@beetle/contracts';
import type { OutputAbsenceState } from '../../src/ports/output-absence.js';
import { OutputTransferError } from '../../src/ports/output-transfer.js';
import { snapshotFor } from '../storage/execution-foundation-fixtures.js';
import { vi } from 'vitest';
import { fixture } from './fixture.js';

export function absenceFixture(count = 1) {
  const f = fixture(count); const binding = f.bindings[0]!;
  const proof: OutputAbsence = {version: 1, ...binding.key.attempt, journalAuthority: binding.journalAuthority,
    finalAgentSeq: 2, admission: {state: 'released', disposition: 'settled'}, reason: 'artifact_incomplete'};
  const state: OutputAbsenceState = {binding, closure: proof,
    proofDigest: createHash('sha256').update(encodeCanonicalJson(proof, 2048)).digest('hex')};
  const snapshot = snapshotFor(binding.key, {state: 'exited', admission: proof.admission, lastSeq: 2});
  const absence = vi.fn(async () => ({ok: true as const, value: proof}));
  const snapshotCall = vi.fn(async () => ({ok: true as const, value: snapshot}));
  const client = {absence, source: vi.fn(), sourceChunk: vi.fn()};
  f.options.gateway.output = vi.fn(() => client);
  f.options.gateway.attempt = vi.fn(() => ({snapshot: snapshotCall}));
  f.transfers.transfer.mockImplementation(() => ({result: Promise.reject(new OutputTransferError('source_absent')), settled: Promise.resolve()}));
  f.absences.adopt.mockResolvedValue(state);
  f.observations.observe.mockImplementation(async () => {
    const run = await f.getRun({id: binding.key.runId, scope: {kind: 'workspace',
      organizationId: binding.key.attempt.organizationId, workspaceId: binding.key.attempt.workspaceId}});
    return {run, snapshot, executionCharged: false, runChanged: false};
  });
  return {...f, binding, proof, proofState: state, absence, snapshotCall, snapshot};
}
