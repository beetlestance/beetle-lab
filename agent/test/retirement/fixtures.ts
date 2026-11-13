import type { Journal } from '../../src/journal/index.js';
import type { Offer } from '@beetle/contracts';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../../src/retirement-values/index.js';
import { admissionFixture, scope } from '../admission/fixtures.js';
export function retirementFixture() {
  const f = admissionFixture();
  async function ready(ack = true, beforeRelease?: (journal: Journal, offer: Offer) => Promise<void>) {
    const path = f.path(); const journal = await f.configured(path); const offer = f.job(); const key = scope(offer);
    await f.enqueue(journal, offer); await f.admit(journal, offer);
    if (beforeRelease) await beforeRelease(journal, offer);
    await journal.admission({ kind: 'abortUnstarted', key });
    const proof = await journal.closeOutputAbsence(key); if (!proof) throw new Error('Missing actual closure');
    if (ack) await journal.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: proof.finalAgentSeq });
    const request: RetirementRequest = { version: 1, purpose: 'performance', ...key, generation: 1,
      intentDigest: offer.intentDigest, journalAuthority: await journal.journalAuthority(),
      runId: '00000000-0000-4000-8000-000000000201', deletionId: '00000000-0000-4000-8000-000000000202', deletionVersion: 1,
      closure: { kind: 'absence', proofDigest: retirementDigest(encodeCanonicalJson(proof, 2048)), finalAgentSeq: proof.finalAgentSeq } };
    return { path, journal, offer, key, proof, request };
  }
  return { ...f, ready };
}
