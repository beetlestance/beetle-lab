import type { RevisionList } from '../../../ports/suites.js';
import { revisionListPosition, validateApi } from '@beetle/contracts/api';
import { prepareSuiteCommand } from '../../../application/suites/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { sha256, uuid } from './input-values.js';
import { StorageError } from './protocol.js';
import type { Operation } from './protocol.js';

function checkedRevisionList(query: RevisionList): void {
  const { scope, suiteId, ...page } = query;
  try {
    revisionListPosition(scope, suiteId, page);
  } catch {
    requireRule(false);
  }
}
function checkedSuiteList(operation: Extract<Operation, { kind: 'listSuites' | 'listRevisions' }>): void {
  const { scope, ...page } = operation.query;
  requireRule(validateApi('WorkspaceScope', scope).ok);
  requireRule(Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= 100);
  if (page.cursor !== undefined) requireRule(typeof page.cursor === 'string' && page.cursor.length <= 1024);
  if (operation.kind === 'listRevisions') checkedRevisionList(operation.query);
  else requireRule(validateApi('SuiteListQuery', page).ok);
}
export function checkedSuiteOperation(operation: Operation): void {
  switch (operation.kind) {
    case 'suite': {
      uuid(operation.command.id);
      if (operation.command.kind === 'createSuiteRevision') uuid(operation.command.suiteId);
      requireRule(prepareSuiteCommand(operation.command, sha256).intentDigest === operation.command.intentDigest);
      break;
    }
    case 'getSuite':
    case 'getRevision':
      requireRule(validateApi('WorkspaceScope', operation.key.scope).ok);
      uuid(operation.key.id);
      break;
    case 'listSuites':
    case 'listRevisions':
      checkedSuiteList(operation);
      break;
    default:
      throw new StorageError('invalid_input');
  }
}
