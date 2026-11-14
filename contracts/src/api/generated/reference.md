# Generated API v2 namespace/settings reference

Sources: `contracts/api/v2`; runtime entrypoint: `contracts/src/api/index.ts`.
Schema catalogue is complete, including runner common exactly once. Implementation status describes route support in the standard source configuration, not runtime readiness or release qualification. Planned operations have schemas/clients but no shipped route.

| Method | Route | Status | Params | Query | Request | Success | Response |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET | /api/v2/organizations | implemented | none | PageQuery | none | 200 | OrganizationPage |
| POST | /api/v2/organizations | implemented | none | none | CreateOrganizationRequest | 201 | Organization |
| GET | /api/v2/organizations/{organizationId} | implemented | OrganizationParams | none | none | 200 | Organization |
| PATCH | /api/v2/organizations/{organizationId} | implemented | OrganizationParams | none | PatchOrganizationRequest | 200 | Organization |
| DELETE | /api/v2/organizations/{organizationId} | implemented | OrganizationParams | none | DeleteOrganizationRequest | 200 | DeletionReceipt |
| GET | /api/v2/settings | implemented | none | none | none | 200 | InstallationSettings |
| PATCH | /api/v2/settings | implemented | none | none | PatchInstallationSettingsRequest | 200 | InstallationSettings |
| GET | /api/v2/organizations/{organizationId}/settings | implemented | OrganizationParams | none | none | 200 | OrganizationSettings |
| PATCH | /api/v2/organizations/{organizationId}/settings | implemented | OrganizationParams | none | PatchOrganizationSettingsRequest | 200 | OrganizationSettings |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings | implemented | WorkspaceParams | none | none | 200 | WorkspaceSettings |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings | implemented | WorkspaceParams | none | PatchWorkspaceSettingsRequest | 200 | WorkspaceSettings |
| POST | /api/v2/settings/retention-preview | implemented | none | none | RetentionPreviewRequest | 200 | RetentionTraversalPage |
| POST | /api/v2/organizations/{organizationId}/settings/retention-preview | implemented | OrganizationParams | none | RetentionPreviewRequest | 200 | RetentionTraversalPage |
| GET | /api/v2/organizations/{organizationId}/workspaces | implemented | OrganizationParams | PageQuery | none | 200 | WorkspacePage |
| POST | /api/v2/organizations/{organizationId}/workspaces | implemented | OrganizationParams | none | CreateWorkspaceRequest | 201 | Workspace |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | implemented | WorkspaceParams | none | none | 200 | Workspace |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | implemented | WorkspaceParams | none | PatchWorkspaceRequest | 200 | Workspace |
| DELETE | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | implemented | WorkspaceParams | none | DeleteWorkspaceRequest | 200 | DeletionReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/folders | implemented | WorkspaceParams | PageQuery | none | 200 | FolderPage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/folders | implemented | WorkspaceParams | none | CreateFolderRequest | 201 | Folder |
| PATCH | /api/v2/organizations/{organizationId}/folders/{id} | implemented | FolderParams | none | PatchFolderRequest | 200 | Folder |
| DELETE | /api/v2/organizations/{organizationId}/folders/{id} | implemented | FolderParams | none | DeleteFolderRequest | 200 | DeletionReceipt |
| POST | /api/v2/auth/local | implemented | none | none | OpenLocalBrowserRequest | 200 | BrowserSession |
| POST | /api/v2/auth/pair | implemented | none | none | PairBrowserRequest | 200 | BrowserSession |
| GET | /api/v2/auth/session | implemented | none | none | none | 200 | BrowserSession |
| POST | /api/v2/auth/logout | implemented | none | none | LogoutBrowserRequest | 200 | LogoutBrowserReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites | implemented | WorkspaceParams | PageQuery | none | 200 | SuitePage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites | implemented | WorkspaceParams | none | CreateSuiteRequest | 201 | Suite |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId} | implemented | SuiteParams | none | none | 200 | Suite |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId} | implemented | SuiteParams | none | PatchSuiteRequest | 200 | Suite |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId}/revisions | implemented | SuiteParams | PageQuery | none | 200 | SuiteRevisionPage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId}/revisions | implemented | SuiteParams | none | CreateSuiteRevisionRequest | 201 | SuiteRevision |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/revisions/{revisionId} | implemented | SuiteRevisionParams | none | none | 200 | SuiteRevision |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs | implemented | WorkspaceParams | none | CreateInputRequest | 201 | InputRecord |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs | implemented | WorkspaceParams | PageQuery | none | 200 | InputPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId} | implemented | InputParams | none | none | 200 | InputRecord |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId}/seal | implemented | InputParams | none | TransitionInputRequest | 202 | InputReceipt |
| DELETE | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId} | implemented | InputParams | none | TransitionInputRequest | 202 | InputReceipt |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs | implemented | WorkspaceParams | none | CreateRunRequest | 202 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs | implemented | WorkspaceParams | RunListQuery | none | 200 | RunPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId} | implemented | RunParams | none | none | 200 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/result | implemented | RunParams | none | none | 200 | RunResultSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/cancel | implemented | RunParams | none | CancelRunRequest | 202 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/events | implemented | RunParams | PageQuery | none | 200 | RunEventPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/artifacts | implemented | RunAttemptParams | PageQuery | none | 200 | RunArtifactPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics | implemented | RunAttemptParams | PageQuery | none | 200 | RunMetricSeriesPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics/samples | implemented | RunAttemptParams | RunMetricSamplesQuery | none | 200 | RunMetricSamplesPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics/live | implemented | RunAttemptParams | none | none | 200 | LiveMetricSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/comparisons | implemented | WorkspaceParams | none | RunComparisonRequest | 200 | RunComparisonSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/revisions/{revisionId}/exports | implemented | SuiteRevisionParams | none | CreateExportRequest | 202 | ExportJob |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports | implemented | WorkspaceParams | PageQuery | none | 200 | ExportJobPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/{exportId} | implemented | ExportParams | none | none | 200 | ExportJob |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/{exportId}/cancel | implemented | ExportParams | none | CancelExportRequest | 200 | ExportJob |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/profiles | implemented | WorkspaceParams | none | none | 200 | ExportProfiles |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/overview | implemented | WorkspaceParams | none | none | 200 | WorkspaceOverview |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings/retention-preview | implemented | WorkspaceParams | none | RetentionPreviewRequest | 200 | RetentionPreview |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings/retention-apply | implemented | WorkspaceParams | none | RetentionApplyRequest | 202 | RetentionApplyReceipt |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/deletion-preview | implemented | RunParams | none | ManualRunDeletionPreviewRequest | 200 | RetentionPreview |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/retention-batches | implemented | WorkspaceParams | none | none | 200 | RetentionBatchList |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/retention-batches/{snapshotId} | implemented | RetentionBatchParams | none | none | 200 | RetentionBatchStatus |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/retention-batches/{snapshotId}/discard | implemented | RetentionBatchParams | none | none | 200 | RetentionDiscardReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/retention-batches/{snapshotId}/preview | implemented | RetentionBatchParams | none | none | 200 | RetentionPreview |

All errors use ApiError. UUID path parameters are validated before URL encoding.
List queries require an integer limit 1–100 and optional opaque string cursor; HTTP query parsing belongs to the transport adapter.
Organisation retention operations also accept a workspace scope within that route organisation; installation retention operations require installation scope.
See ../CONTEXT.md for mandatory semantic checks and settings/retention behavior.
