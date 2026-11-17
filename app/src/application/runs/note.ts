import { encodeJson } from '@beetle/contracts';
import { foldRunSearchName, validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { immutableSnapshot, normalizedName, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { RunNoteStore, SetRunNoteCommand, SetRunNoteOperation } from '../../ports/runs.js';
import { checkedRun, runSnapshot } from './response.js';

/** Notes keep name text rules and a search fold the bounded trigram index can hold. */
export function normalizedRunNote(note: string | null): string | null {
  if (note === null) return null;
  const value = normalizedName(note, 1000);
  requireRule([...foldRunSearchName(value)].length <= 4096);
  return value;
}

/** Route run identity and the full request participate in the intent; no clock does. */
export function prepareRunNoteCommand(operation: SetRunNoteOperation, digest: IntentDigest): SetRunNoteCommand {
  const copy = JSON.parse(encodeJson(operation, 65536)) as SetRunNoteOperation & { intentDigest?: string };
  requireRule(Object.keys(copy).every((key) => ['kind', 'id', 'request', 'intentDigest'].includes(key)));
  requireRule(
    copy.kind === 'setRunNote' && validateApi('Uuid', copy.id).ok && validateApi('SetRunNoteRequest', copy.request).ok,
  );
  normalizedRunNote(copy.request.note);
  const { kind, id, request } = copy;
  const intentDigest = digestMutationIntent({ kind, id, request }, digest);
  requireRule(copy.intentDigest === undefined || copy.intentDigest === intentDigest);
  return immutableSnapshot({ kind, id, request, intentDigest });
}

/** A replay returns the original Run read; later lifecycle or note changes stay in reads. */
export async function setRunNote(input: {
  operation: SetRunNoteOperation;
  digest: IntentDigest;
  store: RunNoteStore;
}): Promise<Run> {
  const expected = prepareRunNoteCommand(input.operation, input.digest);
  const value = checkedRun(await input.store.setNote(runSnapshot(expected)));
  requireRule(sameScope(value.scope, expected.request.scope) && sameUuid(value.id, expected.id), 'not_found');
  if (value.noteVersion === undefined || value.noteVersion < 1) throw new Error('Invalid run note receipt');
  return value;
}
