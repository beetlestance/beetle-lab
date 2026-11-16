import { encodeJson } from '@beetle/contracts';
import { validateApi, runComparisonRequestMatches } from '@beetle/contracts/api';
import type { ApiTypes, RunComparisonRequest } from '@beetle/contracts/api';
import { ComparisonError } from '../../ports/run-comparison.js';
export function captureApi<N extends keyof ApiTypes>(name: N, input: unknown, maximum: number): ApiTypes[N] {
  try {
    const checked = validateApi(name, JSON.parse(encodeJson(input, maximum)) as unknown);
    if (checked.ok) return checked.value;
  } catch { /* Fixed boundary classification below. */ }
  throw new ComparisonError('unavailable');
}
export function captureRequest(input: unknown): RunComparisonRequest {
  let request: RunComparisonRequest;
  try {
    request = captureApi('RunComparisonRequest', input, 4096);
    if (!runComparisonRequestMatches(request)) throw new Error('identity');
  } catch {throw new ComparisonError('invalid_input');}
  return {scope: {kind: 'workspace', organizationId: request.scope.organizationId.toLowerCase(),
    workspaceId: request.scope.workspaceId.toLowerCase()}, runIds: request.runIds.map(id => id.toLowerCase()), metric: request.metric};
}
