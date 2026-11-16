import { checkedSuiteValue, suiteSnapshot } from './query.js';
export { getSuite, getRevision, listSuites, listRevisions } from './query.js';
import { encodeJson } from '@beetle/contracts';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import { immutableSnapshot, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import type { SuiteCommand, SuiteOperation, SuiteStore } from '../../ports/suites.js';

/** Bound before traversing or hashing; CREATE allocation IDs are not logical intent. */
export function prepareSuiteCommand(operation: SuiteOperation, digest: IntentDigest): SuiteCommand {
  const copy = JSON.parse(encodeJson(operation, 2097152)) as SuiteOperation;
  if (copy.kind !== 'createSuiteRevision') encodeJson(copy, 65536);
  const names = { createSuite: 'CreateSuiteRequest', patchSuite: 'PatchSuiteRequest',
    createSuiteRevision: 'CreateSuiteRevisionRequest' } as const;
  requireRule(validateApi(names[copy.kind], copy.request).ok);
  const route = copy.kind === 'patchSuite' ? { id: copy.id } :
    copy.kind === 'createSuiteRevision' ? { suiteId: copy.suiteId } : {};
  return immutableSnapshot({ ...copy, intentDigest: digestMutationIntent({ kind: copy.kind, ...route, request: copy.request }, digest) });
}
export async function mutateSuite<O extends SuiteOperation>(input: { operation: O; digest: IntentDigest; store: SuiteStore }): Promise<O extends { kind: 'createSuiteRevision' } ? SuiteRevision : Suite> {
  const command = prepareSuiteCommand(input.operation, input.digest);
  const raw = await input.store.execute(suiteSnapshot(command));
  const value = command.kind === 'createSuiteRevision' ? checkedSuiteValue('SuiteRevision', raw) : checkedSuiteValue('Suite', raw);
  requireRule(sameScope(value.scope, command.request.scope), 'not_found');
  if (command.kind === 'patchSuite') requireRule(sameUuid(value.id, command.id), 'not_found');
  if (command.kind === 'createSuiteRevision') requireRule('suiteId' in value && sameUuid(value.suiteId, command.suiteId), 'not_found');
  return value as O extends { kind: 'createSuiteRevision' } ? SuiteRevision : Suite;
}
