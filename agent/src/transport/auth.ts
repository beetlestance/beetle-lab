import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { validatePrimitive } from '@beetle/contracts';
import { AgentHttpError, HTTP_LIMITS } from './types.js';
import type { HttpScope } from './types.js';

const hash = (value: string): Buffer => createHash('sha256').update(value).digest();
export function credentialHash(value: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new TypeError('Invalid agent credential');
  return hash(value);
}
function headers(request: FastifyRequest): Map<string, string> {
  const raw = request.raw.rawHeaders; const result = new Map<string, string>(); let bytes = 0;
  if (raw.length > HTTP_LIMITS.headers * 2 || raw.length % 2 !== 0) throw new AgentHttpError(403, 'invalid_protocol');
  for (let at = 0; at < raw.length; at += 2) {
    const name = raw[at]!.toLowerCase(); const value = raw[at + 1]!; bytes += name.length + value.length;
    if (bytes > HTTP_LIMITS.headerBytes || result.has(name) || /[^\x20-\x7e]/.test(value)) throw new AgentHttpError(403, 'invalid_protocol');
    result.set(name, value);
  }
  return result;
}
export function authenticate(request: FastifyRequest, expected: Buffer): Map<string, string> {
  const raw = headers(request); const authorization = raw.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(authorization)
    || !timingSafeEqual(hash(authorization.slice(7)), expected)) throw new AgentHttpError(401, 'invalid_protocol');
  if (raw.has('origin') || raw.has('sec-fetch-site') || raw.has('cookie')) throw new AgentHttpError(403, 'invalid_protocol');
  return raw;
}
export function decimal(value: unknown, minimum: number): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value)) throw new AgentHttpError(400, 'invalid_protocol');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new AgentHttpError(400, 'invalid_protocol');
  return number;
}
function uuid(value: unknown): string {
  const result = validatePrimitive('uuid', value);
  if (!result.ok) throw new AgentHttpError(400, 'invalid_protocol');
  return result.value.toLowerCase();
}
export function scopeFromHeaders(raw: ReadonlyMap<string, string>): HttpScope {
  return Object.freeze({ organizationId: uuid(raw.get('x-beetle-organization-id')),
    workspaceId: uuid(raw.get('x-beetle-workspace-id')), generation: decimal(raw.get('x-beetle-generation'), 1) });
}
export function attemptId(params: unknown): string {
  if (!params || typeof params !== 'object' || !('attemptId' in params)) throw new AgentHttpError(400, 'invalid_protocol');
  return uuid(params.attemptId);
}
export function bodyMatches(scope: HttpScope, id: string,
  body: { organizationId: string; workspaceId: string; attemptId: string; generation?: number }): void {
  if (scope.organizationId !== body.organizationId.toLowerCase() || scope.workspaceId !== body.workspaceId.toLowerCase()
    || id !== body.attemptId.toLowerCase() || (body.generation !== undefined && body.generation !== scope.generation)) {
    throw new AgentHttpError(409, 'conflicting_digest');
  }
}
