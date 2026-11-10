import { validateApi } from './validate.js';
import type { RunArtifactParams } from './generated/types.js';
export const RUN_ARTIFACT_CONTENT_ROUTE = '/api/v2/organizations/:organizationId/workspaces/:workspaceId/runs/:runId/attempts/:attemptId/artifacts/:artifactId/content';
/** Same-origin route only; engine relative paths are never request selectors. */
export function runArtifactContentPath(params: RunArtifactParams): string {
  if (!validateApi('RunArtifactParams', params).ok) throw new Error('Invalid artifact selection');
  let path: string = RUN_ARTIFACT_CONTENT_ROUTE;
  for (const key of ['organizationId', 'workspaceId', 'runId', 'attemptId', 'artifactId'] as const) {
    path = path.replace(`:${key}`, params[key].toLowerCase());
  }
  return path;
}
