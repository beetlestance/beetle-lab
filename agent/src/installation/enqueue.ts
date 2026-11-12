import { createHash } from 'node:crypto';
import { captureStandaloneExportAssignment, RUNNER_MAXIMUM_OFFER_BYTES, encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import type { Offer, StandaloneExportAssignment } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { structuralOffer } from './offer.js';
import type { ValidationIdentity } from '../admission/index.js';
import type { InstallationOptions } from './types.js';
interface EnqueueContext { readonly options: InstallationOptions; now(): number; open(): void }
import type { OfferAcceptance } from './types.js';
import { InstallationError } from './types.js';
export async function enqueue(manager: EnqueueContext, input: unknown): Promise<OfferAcceptance> {
  manager.open();
  const checked = structuralOffer(input);
  const replay = await acceptedReplay(manager, checked); manager.open();
  if (replay) return replay;
  const preflight = manager.options.catalog.preflight(checked); manager.open();
  return persist(manager,preflight);
}
export async function enqueueExport(manager: EnqueueContext,input: unknown): Promise<OfferAcceptance> {
  manager.open();
  const assignment=captureStandaloneExportAssignment(input,text=>createHash('sha256').update(text).digest('hex'));
  const replay=await acceptedReplay(manager,assignment.offer,assignment);manager.open();if (replay) return replay;
  const preflight=manager.options.catalog.preflightExport(assignment);manager.open();
  return persist(manager,preflight,assignment);
}
async function persist(manager: EnqueueContext,preflight: ReturnType<InstallationOptions['catalog']['preflight']>,assignment?: StandaloneExportAssignment): Promise<OfferAcceptance> {
  const offer = JSON.parse(encodeJson(preflight.offer, RUNNER_MAXIMUM_OFFER_BYTES)) as Offer;
  const validation = JSON.parse(encodeJson(preflight.validation, 4096)) as ValidationIdentity;
  const now = manager.now(); manager.open();
  const value = await manager.options.journal.admission({ kind: 'offer', offer, validation, now, ...(assignment ? {assignment} : {}) });
  if ('status' in value || ('kind' in value && value.kind === 'defer' && value.reason === 'queued')) {
    return { accepted: true, snapshot: await manager.options.journal.get({ attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId }) };
  }
  if ('kind' in value && value.kind !== 'admit') return { accepted: false, decision: value };
  throw new InstallationError('journal');
}

async function acceptedReplay(manager: EnqueueContext, offer: Offer, assignment?: StandaloneExportAssignment): Promise<OfferAcceptance | null> {
  const key = { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId };
  let accepted: Offer;
  try { accepted = await manager.options.journal.readOffer(key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'not_found') return null;
    throw error;
  }
  manager.open();
  const stored=await manager.options.journal.readExportAssignment(key);manager.open();
  if (stored?.assignmentDigest !== assignment?.assignmentDigest) throw new JournalError('conflict');
  if (encodeCanonicalJson(accepted, RUNNER_MAXIMUM_OFFER_BYTES) !== encodeCanonicalJson(offer, RUNNER_MAXIMUM_OFFER_BYTES)) {
    throw new JournalError('conflict');
  }
  return { accepted: true, snapshot: await manager.options.journal.get(key) };
}
