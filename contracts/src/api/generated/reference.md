# Generated API v2 namespace/settings reference

Sources: `contracts/api/v2`; runtime entrypoint: `contracts/src/api/index.ts`.
Schema catalogue is complete, including runner common exactly once. These are route descriptors, not implemented routes or an HTTP client.

| Method | Route | Params | Query | Request | Success | Response |
| --- | --- | --- | --- | --- | --- | --- |
| GET | /api/v2/organizations | none | PageQuery | none | 200 | OrganizationPage |
| POST | /api/v2/organizations | none | none | CreateOrganizationRequest | 201 | Organization |
| GET | /api/v2/organizations/{organizationId} | OrganizationParams | none | none | 200 | Organization |
| PATCH | /api/v2/organizations/{organizationId} | OrganizationParams | none | PatchOrganizationRequest | 200 | Organization |
| DELETE | /api/v2/organizations/{organizationId} | OrganizationParams | none | DeleteOrganizationRequest | 200 | DeletionReceipt |
| GET | /api/v2/settings | none | none | none | 200 | InstallationSettings |
| PATCH | /api/v2/settings | none | none | PatchInstallationSettingsRequest | 200 | InstallationSettings |
| GET | /api/v2/organizations/{organizationId}/settings | OrganizationParams | none | none | 200 | OrganizationSettings |
| PATCH | /api/v2/organizations/{organizationId}/settings | OrganizationParams | none | PatchOrganizationSettingsRequest | 200 | OrganizationSettings |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings | WorkspaceParams | none | none | 200 | WorkspaceSettings |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/settings | WorkspaceParams | none | PatchWorkspaceSettingsRequest | 200 | WorkspaceSettings |
| POST | /api/v2/settings/retention-preview | none | none | RetentionPreviewRequest | 200 | RetentionPreview |
| POST | /api/v2/settings/retention-apply | none | none | RetentionApplyRequest | 202 | RetentionApplyReceipt |
| POST | /api/v2/organizations/{organizationId}/settings/retention-preview | OrganizationParams | none | RetentionPreviewRequest | 200 | RetentionPreview |
| POST | /api/v2/organizations/{organizationId}/settings/retention-apply | OrganizationParams | none | RetentionApplyRequest | 202 | RetentionApplyReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces | OrganizationParams | PageQuery | none | 200 | WorkspacePage |
| POST | /api/v2/organizations/{organizationId}/workspaces | OrganizationParams | none | CreateWorkspaceRequest | 201 | Workspace |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | WorkspaceParams | none | none | 200 | Workspace |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | WorkspaceParams | none | PatchWorkspaceRequest | 200 | Workspace |
| DELETE | /api/v2/organizations/{organizationId}/workspaces/{workspaceId} | WorkspaceParams | none | DeleteWorkspaceRequest | 200 | DeletionReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/folders | WorkspaceParams | PageQuery | none | 200 | FolderPage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/folders | WorkspaceParams | none | CreateFolderRequest | 201 | Folder |
| PATCH | /api/v2/organizations/{organizationId}/folders/{id} | FolderParams | none | PatchFolderRequest | 200 | Folder |
| DELETE | /api/v2/organizations/{organizationId}/folders/{id} | FolderParams | none | DeleteFolderRequest | 200 | DeletionReceipt |
| POST | /api/v2/auth/local | none | none | OpenLocalBrowserRequest | 200 | BrowserSession |
| POST | /api/v2/auth/pair | none | none | PairBrowserRequest | 200 | BrowserSession |
| GET | /api/v2/auth/session | none | none | none | 200 | BrowserSession |
| POST | /api/v2/auth/logout | none | none | LogoutBrowserRequest | 200 | LogoutBrowserReceipt |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites | WorkspaceParams | PageQuery | none | 200 | SuitePage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites | WorkspaceParams | none | CreateSuiteRequest | 201 | Suite |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId} | SuiteParams | none | none | 200 | Suite |
| PATCH | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId} | SuiteParams | none | PatchSuiteRequest | 200 | Suite |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId}/revisions | SuiteParams | PageQuery | none | 200 | SuiteRevisionPage |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/suites/{suiteId}/revisions | SuiteParams | none | CreateSuiteRevisionRequest | 201 | SuiteRevision |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/revisions/{revisionId} | SuiteRevisionParams | none | none | 200 | SuiteRevision |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs | WorkspaceParams | none | CreateInputRequest | 201 | InputRecord |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs | WorkspaceParams | PageQuery | none | 200 | InputPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId} | InputParams | none | none | 200 | InputRecord |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId}/seal | InputParams | none | TransitionInputRequest | 202 | InputReceipt |
| DELETE | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/inputs/{inputId} | InputParams | none | TransitionInputRequest | 202 | InputReceipt |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs | WorkspaceParams | none | CreateRunRequest | 202 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs | WorkspaceParams | PageQuery | none | 200 | RunPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId} | RunParams | none | none | 200 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/result | RunParams | none | none | 200 | RunResultSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/cancel | RunParams | none | CancelRunRequest | 202 | Run |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/events | RunParams | PageQuery | none | 200 | RunEventPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/artifacts | RunAttemptParams | PageQuery | none | 200 | RunArtifactPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics | RunAttemptParams | PageQuery | none | 200 | RunMetricSeriesPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics/samples | RunAttemptParams | RunMetricSamplesQuery | none | 200 | RunMetricSamplesPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/runs/{runId}/attempts/{attemptId}/metrics/live | RunAttemptParams | none | none | 200 | LiveMetricSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/comparisons | WorkspaceParams | none | RunComparisonRequest | 200 | RunComparisonSnapshot |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/revisions/{revisionId}/exports | SuiteRevisionParams | none | CreateExportRequest | 202 | ExportJob |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports | WorkspaceParams | PageQuery | none | 200 | ExportJobPage |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/{exportId} | ExportParams | none | none | 200 | ExportJob |
| POST | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/{exportId}/cancel | ExportParams | none | CancelExportRequest | 200 | ExportJob |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/exports/profiles | WorkspaceParams | none | none | 200 | ExportProfiles |
| GET | /api/v2/organizations/{organizationId}/workspaces/{workspaceId}/overview | WorkspaceParams | none | none | 200 | WorkspaceOverview |

All errors use ApiError. UUID path parameters are validated before URL encoding.
List queries require an integer limit 1–100 and optional opaque string cursor; HTTP query parsing belongs to the transport adapter.
Organisation retention operations also accept a workspace scope within that route organisation; installation retention operations require installation scope.
See ../CONTEXT.md for mandatory semantic checks and settings/retention behavior.
