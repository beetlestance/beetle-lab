import type { FastifyRequest } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import { ApiFault } from '../api-errors.js';

export const inputPath = '/api/v2/organizations/:organizationId/workspaces/:workspaceId/inputs';
interface Params { organizationId: string; workspaceId: string; inputId?: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function scope(params: Params): WorkspaceScope {
  return { kind: 'workspace', organizationId: params.organizationId, workspaceId: params.workspaceId };
}
export function routeParams(request: FastifyRequest): Params {
  const params = request.params as Params;
  for (const value of Object.values(params)) {
    if (typeof value !== 'string' || !uuid.test(value)) throw new ApiFault('malformed_request');
  }
  return params;
}
export function routeKey(request: FastifyRequest) {
  const params = routeParams(request);
  if (!params.inputId) throw new ApiFault('malformed_request');
  return { scope: scope(params), id: params.inputId };
}
export function noQuery(request: FastifyRequest): void {
  if (request.raw.url?.includes('?')) throw new ApiFault('malformed_request');
}
export function chunkOffset(request: FastifyRequest): number {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).length !== 1 || typeof query.offset !== 'string' ||
    !/^(0|[1-9][0-9]{0,6})$/.test(query.offset)) throw new ApiFault('malformed_request');
  const offset = Number(query.offset);
  if (offset > 8_388_608) throw new ApiFault('malformed_request');
  return offset;
}
