import { validatePrimitive } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { copyControlScope } from '../control-protocol/index.js';
import type { ControlScope } from '../control-protocol/index.js';
import { JournalError } from '../journal/index.js';
import type { SourceBinding, SourceScope } from '../output-source/index.js';
import { CollectionReadBusy } from './launch-contention.js';
import { ControllerError } from './types.js';
import type { ControllerJournal } from './types.js';

/** Collection needs no config, secret references, or other Offer payload. */
export interface CollectionAuthority {
  readonly engineId: Offer['engine']['id'];
  readonly outputBytes: number;
  readonly binding: SourceBinding;
}
type AuthorityJournal = Pick<ControllerJournal, 'readOffer' | 'journalAuthority'>;
interface OriginalAuthority {
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
  return Object.freeze({ binding, outputBytes: offer.budget.outputBytes });
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
  return Object.freeze({ engineId: binding.engine.id, outputBytes: original.outputBytes, binding });
}
