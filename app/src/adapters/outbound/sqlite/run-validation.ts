import {checkedOrganizationOverviewQuery} from '../../../application/organization-overview/index.js';
import {checkedOverviewQuery} from '../../../application/overview/index.js';
import { runListPosition, validateApi } from '@beetle/contracts/api';
import { prepareRunCommand, prepareCancelRunCommand } from '../../../application/runs/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import type { Operation } from './protocol.js';
import { sha256 } from './input-values.js';

export function checkedRunOperation(operation: Operation): boolean {
  switch (operation.kind) {
    case 'getOrganizationOverview': checkedOrganizationOverviewQuery(operation.query);return true;
    case 'getWorkspaceOverview': checkedOverviewQuery(operation.query);return true;
    case 'run':
      requireRule(prepareRunCommand(operation.command, sha256).intentDigest === operation.command.intentDigest); return true;
    case 'cancelRun':
      requireRule(prepareCancelRunCommand(operation.command, sha256).intentDigest === operation.command.intentDigest); return true;
    case 'getRun':
      requireRule(Object.keys(operation.key).every(key => ['scope', 'id'].includes(key)));
      requireRule(validateApi('WorkspaceScope', operation.key.scope).ok && validateApi('Uuid', operation.key.id).ok); return true;
    case 'listRuns': {
      const { scope, ...page } = operation.query;
      requireRule(validateApi('WorkspaceScope', scope).ok && validateApi('RunListQuery', page).ok);
      runListPosition(scope, page); return true;
    }
    default: return false;
  }
}
