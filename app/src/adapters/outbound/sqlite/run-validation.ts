import { checkedOrganizationOverviewQuery } from '../../../application/organization-overview/index.js';
import { checkedOverviewQuery } from '../../../application/overview/index.js';
import { runListPosition, validateApi } from '@beetle/contracts/api';
import {
  prepareRunCommand,
  prepareCancelRunCommand,
  prepareRunNoteCommand,
  prepareRunPinCommand,
} from '../../../application/runs/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import type { Operation } from './protocol.js';
import { sha256 } from './input-values.js';
import { statusOperation, checkStatusOperation } from './installation-status/wire.js';

type RunCommandOperation = Extract<Operation, { kind: 'run' | 'cancelRun' | 'runNote' | 'runPin' }>;
/** Recomputes the intent digest the application layer bound to each run command. */
const RUN_COMMAND_KINDS: readonly string[] = ['run', 'cancelRun', 'runNote', 'runPin'];
function runCommandOperation(operation: Operation): operation is RunCommandOperation {
  return RUN_COMMAND_KINDS.includes(operation.kind);
}
function commandDigest(operation: RunCommandOperation): string {
  if (operation.kind === 'run') return prepareRunCommand(operation.command, sha256).intentDigest;
  if (operation.kind === 'cancelRun') return prepareCancelRunCommand(operation.command, sha256).intentDigest;
  if (operation.kind === 'runNote') return prepareRunNoteCommand(operation.command, sha256).intentDigest;
  return prepareRunPinCommand(operation.command, sha256).intentDigest;
}
export function checkedRunOperation(operation: Operation): boolean {
  if (statusOperation(operation)) {
    checkStatusOperation(operation);
    return true;
  }
  if (runCommandOperation(operation)) {
    requireRule(commandDigest(operation) === operation.command.intentDigest);
    return true;
  }
  switch (operation.kind) {
    case 'getOrganizationOverview':
      checkedOrganizationOverviewQuery(operation.query);
      return true;
    case 'getWorkspaceOverview':
      checkedOverviewQuery(operation.query);
      return true;
    case 'getRun':
      requireRule(Object.keys(operation.key).every((key) => ['scope', 'id'].includes(key)));
      requireRule(validateApi('WorkspaceScope', operation.key.scope).ok && validateApi('Uuid', operation.key.id).ok);
      return true;
    case 'listRuns': {
      const { scope, ...page } = operation.query;
      requireRule(validateApi('WorkspaceScope', scope).ok && validateApi('RunListQuery', page).ok);
      runListPosition(scope, page);
      return true;
    }
    default:
      return false;
  }
}
