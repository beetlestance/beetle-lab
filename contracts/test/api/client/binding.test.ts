import { expect, expectTypeOf, it } from 'vitest';
import { apiOperations, createApiClient, createApiHttpTransport } from '../../../src/api/index.js';
import type { ApiClient, ApiClientResult, ApiOperation, ApiTypes, Organization } from '../../../src/api/index.js';
import { fixture } from '../fixtures.js';
import { baseUrl, load, organizationId, params, reply } from './helpers.js';

const files: Partial<Record<keyof ApiTypes, string>> = {
  RetentionTraversalPage:'retention-traversal-page',ManualRunDeletionPreviewRequest:'manual-run-deletion-request',RetentionBatchStatus:'retention-batch-status',RetentionBatchList:'retention-batch-list',RetentionDiscardReceipt:'retention-discard-receipt',
  OrganizationOverview:'organization-overview', WorkspaceOverview:'workspace-overview',
  ExportJob: 'export-job', ExportJobPage: 'export-job-page', ExportProfiles: 'export-profiles',
  CreateExportRequest: 'create-export', CancelExportRequest: 'cancel-export',
  RunComparisonRequest: 'run-comparison-request', RunComparisonSnapshot: 'run-comparison',
  LiveMetricSnapshot: 'live-metric-snapshot', RunMetricSeriesPage: 'run-metric-series-pending', RunMetricSamplesPage: 'run-metric-samples',
  RunResultSnapshot: 'run-result-pending', RunEventPage: 'run-events-pending', RunArtifactPage: 'run-artifacts-pending',
  Run: 'run', RunPage: 'run-page', CreateRunRequest: 'create-run', CancelRunRequest: 'cancel-run',
  InputRecord: 'input', InputReceipt: 'input-receipt', InputPage: 'input-page',
  CreateInputRequest: 'create-input', TransitionInputRequest: 'transition-input',
  Suite: 'suite', SuiteRevision: 'suite-revision', SuitePage: 'suite-page', SuiteRevisionPage: 'suite-revision-page',
  CreateSuiteRequest: 'create-suite', PatchSuiteRequest: 'patch-suite', CreateSuiteRevisionRequest: 'create-suite-revision',
  OpenLocalBrowserRequest: 'open-local-browser-request', PairBrowserRequest: 'pair-browser-request', BrowserSession: 'browser-session',
  LogoutBrowserRequest: 'logout-browser-request', LogoutBrowserReceipt: 'logout-browser-receipt',
  Organization: 'organization', Workspace: 'workspace', Folder: 'folder', DeletionReceipt: 'deletion-receipt',
  OrganizationPage: 'organization-page', WorkspacePage: 'workspace-page', FolderPage: 'folder-page',
  InstallationSettings: 'installation-settings', OrganizationSettings: 'organization-settings', WorkspaceSettings: 'workspace-settings',
  RetentionPreview: 'retention-preview', RetentionApplyReceipt: 'retention-apply-receipt',
  CreateOrganizationRequest: 'create-organization', PatchOrganizationRequest: 'patch-organization', DeleteOrganizationRequest: 'delete-organization',
  CreateWorkspaceRequest: 'create-workspace', PatchWorkspaceRequest: 'patch-workspace', DeleteWorkspaceRequest: 'delete-workspace',
  CreateFolderRequest: 'create-folder', PatchFolderRequest: 'patch-folder', DeleteFolderRequest: 'delete-folder',
  PatchInstallationSettingsRequest: 'patch-installation-settings', PatchOrganizationSettingsRequest: 'patch-organization-settings',
  PatchWorkspaceSettingsRequest: 'patch-workspace-settings', RetentionPreviewRequest: 'retention-preview-request', RetentionApplyRequest: 'retention-apply-request',
};
async function operationReply(operation: ApiOperation): Promise<Record<string, unknown>> {
  const file = operation.name === 'cancelRun' ? 'run-cancelling' : operation.name === 'cancelExport' ? 'export-cancelling' : files[operation.response];
  return await fixture(`valid/${file}.json`) as Record<string, unknown>;
}
async function queryFixture(operation: ApiOperation) {
  if (operation.name === 'listRuns') return { limit: 100 };
  if (operation.name === 'getRunMetricSamples') return {limit: 100, seriesOrdinal: 0};
  return ['listRunEvents', 'listRunArtifacts', 'listRunMetricSeries'].includes(operation.name)
    ? { limit: 100 } : await load('page-query', 'PageQuery');
}
function bindRetention(operation:ApiOperation,input:Record<string,unknown>,body:Record<string,unknown>|undefined,response:Record<string,unknown>):void{
  if(operation.name==='getWorkspaceRetentionPreview')response.scope={kind:'workspace',organizationId:(input.params as Record<string,string>).organizationId,workspaceId:(input.params as Record<string,string>).workspaceId};
  if(['previewWorkspaceRetention','applyWorkspaceRetention','previewRunDeletion'].includes(operation.name)){
   const owner={kind:'workspace',organizationId:(input.params as Record<string,string>).organizationId,workspaceId:(input.params as Record<string,string>).workspaceId};body!.scope=owner;response.scope=owner;
   if(operation.name==='previewRunDeletion'){
    response.kind='manual';response.scanned=1;response.protectedExclusions=[];
    response.candidates=[{id:body!.runId,version:body!.expectedRunVersion,scope:owner,estimatedBytes:1024,reason:'manual'}];
   }
  }
}
async function exchange(operation: ApiOperation) {
  const input: Record<string, unknown> = {};
  const parameterFiles = { RetentionBatchParams:'retention-batch',OrganizationParams: 'organization', WorkspaceParams: 'workspace', FolderParams: 'folder',
    SuiteParams: 'suite', SuiteRevisionParams: 'suite-revision', InputParams: 'input', RunParams: 'run', RunAttemptParams: 'run-attempt', ExportParams: 'export' };
  if ('params' in operation) input.params = await fixture(`valid/${parameterFiles[operation.params]}-params.json`);
  if ('query' in operation) input.query = await queryFixture(operation);
  const body = 'request' in operation ? await fixture(`valid/${files[operation.request]}.json`) as Record<string, unknown> : undefined;
  const response = await operationReply(operation);
  if (body) input.body = body;
  bindRevision(operation,input,body);
  bindRetention(operation,input,body,response);
  if (operation.name.includes('InstallationRetention')) { body!.scope = { kind: 'installation' }; response.scope = body!.scope; }
  if (operation.response === 'DeletionReceipt') {
    const path = input.params as Record<string, string>;
    response.id = path.id ?? path.workspaceId ?? path.organizationId;
    response.scope = body!.scope; response.requestId = body!.requestId;
  }
  if (operation.name === 'deleteInput') response.operation = 'delete';
  return { input, response };
}

it.each(apiOperations)('binds $name from its shipped descriptor and schema fixtures', async operation => {
  const { input, response } = await exchange(operation);
  const fetcher = reply(response, operation.successStatus);
  const client = createApiClient({ baseUrl, fetch: fetcher });
  const invoke = client[operation.name] as (input: unknown) => Promise<ApiClientResult<unknown>>;
  expect(await invoke(input)).toEqual({ ok: true, value: response });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(new URL(String(url)).origin).toBe('https://api.invalid');
  expect(new URL(String(url)).pathname).toBe(operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => (input.params as Record<string, string>)[name]!));
  expect(init?.method).toBe(operation.method);
  expect(init?.redirect).toBe('error');
  expect(init?.credentials).toBeUndefined();
  expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(input.body);
  if ('query' in operation) {
    const query = input.query as ApiTypes['PageQuery'];
    expect(new URL(String(url)).searchParams.get('limit')).toBe(String(query.limit));
    expect(new URL(String(url)).searchParams.get('cursor')).toBe(query.cursor ?? null);
  }
  expect(Object.isFrozen(client)).toBe(true);
  expect(Object.keys(client)).toEqual(apiOperations.map(value => value.name));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('exposes descriptor-derived static arguments and response types', () => {
  expectTypeOf<ReturnType<ApiClient['getOrganization']>>().toEqualTypeOf<Promise<ApiClientResult<Organization>>>();
  const compileOnly = (client: ApiClient) => {
    void client.getOrganization({ params: { organizationId } });
    void client.listFolders({ params, query: { limit: 25 } });
    void client.getInstallationSettings();
    // @ts-expect-error generated params require workspace identity
    void client.getWorkspace({ params: { organizationId } });
    // @ts-expect-error raw HTTP strings are not typed query limits
    void client.listOrganizations({ query: { limit: '25' } });
    // @ts-expect-error mutation requires its generated body
    void client.createOrganization({});
    // @ts-expect-error generated DTO rejects unknown fields
    void client.getOrganization({ params: { organizationId, extra: true } });
  };
  expectTypeOf(compileOnly).toBeFunction();
});

it('fixes the public transport namespace and rejects runner paths before fetch', async () => {
  const fetcher = reply(await load('organization', 'Organization'));
  const transport = createApiHttpTransport({ baseUrl, fetch: fetcher });
  expect(await transport.json({ method: 'GET', path: '/runner/v1/jobs', response: 'Organization', successStatus: 200 }))
    .toEqual({ ok: false, error: { kind: 'request' } });
  expect(fetcher).not.toHaveBeenCalled();
});

function bindRevision(operation:ApiOperation,input:Record<string,unknown>,body:Record<string,unknown>|undefined):void {
 if(operation.name==='createExport')(input.params as Record<string,string>).revisionId=body!.revisionId as string;
}
