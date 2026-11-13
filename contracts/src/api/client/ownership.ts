import { retentionResponseMatches,retentionRequestMatches } from './retention-ownership.js';
import {workspaceOverviewMatches} from '../overview.js';
import type {WorkspaceOverview} from '../generated/types.js';
import { exportOwnership, exportRequestMatches } from './export-ownership.js';
import { runComparisonRequestMatches, runComparisonSnapshotMatches } from './comparison.js';
import type { RunComparisonRequest, RunComparisonSnapshot } from '../generated/types.js';
import { liveMetricScopeMatches } from '../live-metrics.js';
import type { LiveMetricSnapshot } from '../generated/types.js';
import { runMetricSeriesPageMatches, runMetricSamplesPageMatches } from './run-metric-ownership.js';
import type { RunMetricSeriesPage, RunMetricSamplesPage } from '../generated/types.js';
import type { ApiOperation } from '../generated/operations.js';
import type { EffectiveSettings, SettingsScope } from '../generated/types.js';
import type { PreparedInput } from './input.js';
import { inputOwnership } from './input-ownership.js';
import { runArtifactPageMatches } from './run-artifact-ownership.js';
import type { RunArtifactPage } from '../generated/types.js';
import { runEventPageMatches } from './run-event-ownership.js';
import type { RunEventPage } from '../generated/types.js';
import { runOwnership } from './run-ownership.js';

function sameUuid(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

/** True when child is at parent or below it; settings sources use the reverse direction. */
function contains(parent: SettingsScope, child: SettingsScope): boolean {
  if (parent.kind === 'installation') return true;
  if (child.kind === 'installation' || !sameUuid(parent.organizationId, child.organizationId)) return false;
  return parent.kind === 'organization' || (child.kind === 'workspace' && sameUuid(parent.workspaceId, child.workspaceId));
}
function equal(left: SettingsScope, right: SettingsScope): boolean {
  return left.kind === right.kind && contains(left, right);
}
function routeOwner(input: PreparedInput): SettingsScope {
  const { organizationId, workspaceId } = input.params;
  if (!organizationId) return { kind: 'installation' };
  return workspaceId ? { kind: 'workspace', organizationId, workspaceId } : { kind: 'organization', organizationId };
}
function retention(operation: ApiOperation): boolean {
  return 'request' in operation && ['RetentionPreviewRequest', 'RetentionApplyRequest'].includes(operation.request);
}
/** These installation-wide session DTOs have no namespace SettingsScope.
 * Their exact local-admin scope and shapes are enforced by shipped schemas.
 */
function session(operation: ApiOperation): boolean {
  return operation.name === 'openLocalBrowserSession' || operation.name === 'pairBrowserSession' || operation.name === 'getBrowserSession'
    || operation.name === 'logoutBrowserSession';
}

export function requestOwnership(operation: ApiOperation, input: PreparedInput): boolean {
  if (session(operation) || !input.body) return true;
  return retentionRequestMatches(operation,input) && (operation.name !== 'compareRuns' || runComparisonRequestMatches(input.body as unknown as RunComparisonRequest))
    && exportRequestMatches(operation, input) && scopedBodyOwnership(operation, input);
}
function scopedBodyOwnership(operation: ApiOperation, input: PreparedInput): boolean {
  const scope = input.body!.scope as SettingsScope;
  const route = routeOwner(input);
  if (retention(operation)) return route.kind === 'installation' ? scope.kind === 'installation' : contains(route, scope);
  // Organisations themselves are installation-owned; their UUID lives in the route.
  if (operation.path === '/api/v2/organizations/{organizationId}') return scope.kind === 'installation';
  if ('request' in operation && ['PatchWorkspaceRequest', 'DeleteWorkspaceRequest'].includes(operation.request)) {
    return equal({ kind: 'organization', organizationId: input.params.organizationId! }, scope);
  }
  if ('params' in operation && operation.params === 'FolderParams') return contains(route, scope);
  return equal(route, scope);
}

interface OwnedReply {
  scope: SettingsScope;
  id?: string;
  requestId?: string;
  settingsId?: string;
  settingsVersion?: number;
  snapshotId?: string;
  snapshotVersion?: number;
  suiteId?: string;
  items?: { scope: SettingsScope; suiteId?: string }[];
  candidates?: { scope: SettingsScope }[];
  effective?: EffectiveSettings;
}
function expectedOwner(operation: ApiOperation, input: PreparedInput): SettingsScope {
  if (input.body) return input.body.scope as SettingsScope;
  if (operation.response === 'Organization') return { kind: 'installation' };
  if (operation.response === 'Workspace') return { kind: 'organization', organizationId: input.params.organizationId! };
  return routeOwner(input);
}
function identityMatches(operation: ApiOperation, input: PreparedInput, reply: OwnedReply): boolean {
  const params = input.params;
  const identities: Partial<Record<ApiOperation['response'], string | undefined>> = {
    Organization: params.organizationId, Workspace: params.workspaceId, Folder: params.id,
    Suite: params.suiteId, SuiteRevision: params.revisionId, Run: params.runId, RunResultSnapshot: params.runId, ExportJob: params.exportId,
  };
  if (operation.response === 'DeletionReceipt') {
    return sameUuid(reply.id, params.id ?? params.workspaceId ?? params.organizationId) && sameUuid(reply.requestId, input.body?.requestId);
  }
  const expected = identities[operation.response];
  return expected === undefined || sameUuid(reply.id, expected);
}
function retentionMatches(input: PreparedInput, reply: OwnedReply): boolean {
  const body = input.body!;
  if (!sameUuid(reply.requestId, body.requestId) || !sameUuid(reply.settingsId, body.settingsId) || reply.settingsVersion !== body.expectedVersion) return false;
  if ('snapshotId' in body && (!sameUuid(reply.snapshotId, body.snapshotId) || reply.snapshotVersion !== body.snapshotVersion)) return false;
  return (reply.candidates ?? []).every(candidate => contains(reply.scope, candidate.scope));
}
function sourceAncestry(scope: SettingsScope, effective: EffectiveSettings): boolean {
  const leaves = [effective.runDefaults.engineProfile, effective.retention, ...Object.values(effective.runDefaults.budget)];
  return leaves.every(leaf => contains(leaf.source, scope));
}

/** Structural validation precedes this route/body/result binding. Backend SQL authorization is independent. */
export function responseOwnership(operation: ApiOperation, input: PreparedInput, value: unknown): boolean {
  if (session(operation)) return true;
  const retentionMatch=retentionResponseMatches(operation,input,value);if(retentionMatch!==undefined)return retentionMatch;
  if(operation.response==='WorkspaceOverview')return workspaceOverviewMatches(value as WorkspaceOverview,{organizationId:input.params.organizationId!,workspaceId:input.params.workspaceId!});
  if (operation.response === 'RunComparisonSnapshot') return runComparisonSnapshotMatches(value as RunComparisonSnapshot, input.body as unknown as RunComparisonRequest);
  if (operation.response === 'LiveMetricSnapshot') return liveMetricScopeMatches((value as LiveMetricSnapshot).scope,
    {organizationId: input.params.organizationId!, workspaceId: input.params.workspaceId!, attemptId: input.params.attemptId!, generation: 1});
  if (operation.response === 'RunEventPage') return runEventPageMatches(value as RunEventPage, { id: input.params.runId!,
    scope: routeOwner(input) as RunEventPage['scope'], ...input.query! });
  if (operation.response === 'RunArtifactPage') return runArtifactPageMatches(value as RunArtifactPage, { id: input.params.runId!,
    attemptId: input.params.attemptId!, scope: routeOwner(input) as RunArtifactPage['scope'], ...input.query! });
  if (operation.response === 'RunMetricSeriesPage') return runMetricSeriesPageMatches(value as RunMetricSeriesPage, { id: input.params.runId!,
    attemptId: input.params.attemptId!, scope: routeOwner(input) as RunMetricSeriesPage['scope'], ...input.query! });
  if (operation.response === 'RunMetricSamplesPage') return runMetricSamplesPageMatches(value as RunMetricSamplesPage, { id: input.params.runId!,
    attemptId: input.params.attemptId!, scope: routeOwner(input) as RunMetricSamplesPage['scope'], ...input.query! });
  return genericResponseOwnership(operation, input, value as OwnedReply);
}
function genericResponseOwnership(operation: ApiOperation, input: PreparedInput, reply: OwnedReply): boolean {
  if (!equal(expectedOwner(operation, input), reply.scope) || !identityMatches(operation, input, reply)) return false;
  if (reply.items && !reply.items.every(item => equal(reply.scope, item.scope))) return false;
  if (!resourceOwnership(operation, input, reply)) return false;
  if (retention(operation) && !retentionMatches(input, reply)) return false;
  return !reply.effective || sourceAncestry(reply.scope, reply.effective);
}

function resourceOwnership(operation: ApiOperation, input: PreparedInput, reply: OwnedReply): boolean {
  return revisionOwnership(operation, input, reply) && inputOwnership(operation, input, reply)
    && runOwnership(operation, input, reply) && exportOwnership(operation, input, reply);
}

function revisionOwnership(operation: ApiOperation, input: PreparedInput, reply: OwnedReply): boolean {
  if (!input.params.suiteId || !['SuiteRevision', 'SuiteRevisionPage'].includes(operation.response)) return true;
  if (!sameUuid(reply.suiteId, input.params.suiteId)) return false;
  return !reply.items || reply.items.every(item => sameUuid(item.suiteId, input.params.suiteId));
}
