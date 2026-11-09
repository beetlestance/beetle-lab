import { validateApi } from '@beetle/contracts/api';
import { prepareRunCommand } from '../../../application/runs/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import type { Operation } from './protocol.js';
import { sha256 } from './input-values.js';

export function checkedRunOperation(operation: Operation): boolean {
  switch (operation.kind) {
    case 'run':
      requireRule(prepareRunCommand(operation.command, sha256).intentDigest === operation.command.intentDigest); return true;
    case 'getRun':
      requireRule(Object.keys(operation.key).every(key => ['scope', 'id'].includes(key)));
      requireRule(validateApi('WorkspaceScope', operation.key.scope).ok && validateApi('Uuid', operation.key.id).ok); return true;
    case 'listRuns': {
      const { scope, ...page } = operation.query;
      requireRule(validateApi('WorkspaceScope', scope).ok && validateApi('PageQuery', page).ok); return true;
    }
    default: return false;
  }
}
