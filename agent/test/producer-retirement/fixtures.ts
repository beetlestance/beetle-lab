import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputAbsence } from '@beetle/contracts/output-source';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../../src/retirement-values/index.js';
export function requestFor(proof: OutputAbsence) {
  return captureOutputRetirementRequest({ version: 1, purpose: 'performance', organizationId: proof.organizationId,
    workspaceId: proof.workspaceId, attemptId: proof.attemptId, generation: proof.generation, intentDigest: proof.intentDigest,
    journalAuthority: proof.journalAuthority, runId: '00000000-0000-4000-8000-000000000201',
    deletionId: '00000000-0000-4000-8000-000000000202', deletionVersion: 1,
    closure: { kind: 'absence', proofDigest: retirementDigest(encodeCanonicalJson(proof, 2048)), finalAgentSeq: proof.finalAgentSeq } });
}
