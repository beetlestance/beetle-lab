import { createHash } from 'node:crypto';
import { exportExpectation, validatePrimitive } from '@beetle/contracts';
import type { ExportResultExpectation, Offer, AttemptSnapshot, ExecutionResult } from '@beetle/contracts';
import { copyControlScope } from '../control-protocol/index.js';
import type { ControlScope } from '../control-protocol/index.js';
import { JournalError } from '../journal/index.js';
import type { SourceBinding, SourceScope } from '../output-source/index.js';
import { CollectionReadBusy } from './launch-contention.js';
import { ControllerError } from './types.js';
import type { OutputCollectionOptions } from '../collection/output/index.js';
import type { ControllerJournal } from './types.js';

/** Collection needs no config, secret references, or other Offer payload. */
export interface CollectionAuthority {
  readonly expectedExport?: ExportResultExpectation;
  readonly engineId: Offer['engine']['id'];
  readonly outputBytes: number;
  readonly binding: SourceBinding;
}
type AuthorityJournal = Pick<ControllerJournal, 'readOffer' | 'readExportAssignment' | 'journalAuthority'>;
interface OriginalAuthority {
  readonly expectedExport?: ExportResultExpectation;
  readonly binding: Omit<SourceBinding, 'journalAuthority' | 'specDigest'>;
  readonly outputBytes: number;
}
/** The validated, bounded Journal Offer stays within this read/copy operation. */
async function originalAuthority(journal: AuthorityJournal, key: SourceScope): Promise<OriginalAuthority> {
  let offer: Offer;
  try { offer = await journal.readOffer(key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw new CollectionReadBusy();
    throw error;
  }
  if (!(['organizationId', 'workspaceId', 'attemptId'] as const)
    .every(field => offer[field] === key[field])) throw new ControllerError('journal');
  const installed = offer.installedIdentity;
  const binding = Object.freeze({ organizationId: offer.organizationId, workspaceId: offer.workspaceId,
    attemptId: offer.attemptId, generation: 1 as const, intentDigest: offer.intentDigest,
    engine: Object.freeze({ id: offer.engine.id, imageDigest: offer.engine.imageDigest, configVersion: offer.engine.configVersion }),
    installedIdentity: Object.freeze({ manifestId: installed.manifestId, profileId: installed.profileId,
      catalogVersion: installed.catalogVersion, manifestDigest: installed.manifestDigest,
      profileDigest: installed.profileDigest, schemaDigest: installed.schemaDigest }) });
  const outputBytes=offer.budget.outputBytes;
  let assignment;
  try {assignment=await journal.readExportAssignment(key);} catch(error) {
    if (error instanceof JournalError && error.code==='queue_full') throw new CollectionReadBusy();throw error;
  }
  const expectedExport=assignment ? exportExpectation(assignment,text=>createHash('sha256').update(text).digest('hex')) : undefined;
  return Object.freeze({ binding, outputBytes, ...(expectedExport ? {expectedExport} : {}) });
}
export async function collectionAuthority(journal: AuthorityJournal,
  key: Readonly<ControlScope>, specDigest: string): Promise<CollectionAuthority> {
  if (typeof specDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(specDigest)) throw new ControllerError('invalid_input');
  const captured = copyControlScope(key);
  if (captured.generation !== 1) throw new ControllerError('invalid_input');
  const original = await originalAuthority(journal, Object.freeze({ ...captured, generation: captured.generation }));
  let journalAuthority: string;
  try { journalAuthority = await journal.journalAuthority(); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'queue_full') throw new CollectionReadBusy();
    throw error;
  }
  if (!validatePrimitive('uuid', journalAuthority).ok || journalAuthority !== journalAuthority.toLowerCase()) throw new ControllerError('journal');
  const binding: SourceBinding = Object.freeze({ ...original.binding, journalAuthority, specDigest });
  return Object.freeze({ engineId: binding.engine.id, outputBytes: original.outputBytes, binding, ...(original.expectedExport ? {expectedExport:original.expectedExport} : {}) });
}

/** Purpose comes from the original Journal, never a received result's tag. */
export function reportedResult(authority:CollectionAuthority,snapshot:AttemptSnapshot):ExecutionResult | undefined {
  if (authority.expectedExport) {
    if (snapshot.result) throw new ControllerError('journal');return snapshot.exportResult;
  }
  if (snapshot.exportResult) throw new ControllerError('journal');return snapshot.result;
}
export function collectionOptions(authority:CollectionAuthority,input:Omit<OutputCollectionOptions,'engineId'|'outputBytes'|'expectedExport'>):OutputCollectionOptions {
  return {...input,engineId:authority.engineId,outputBytes:authority.outputBytes,
    ...(authority.expectedExport ? {expectedExport:authority.expectedExport} : {})};
}
