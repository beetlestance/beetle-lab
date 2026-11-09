import { validatePrimitive } from '@beetle/contracts';
import type { FastifyRequest } from 'fastify';
import type { GenerationKey } from '../journal/index.js';
import { authenticate, attemptId, credentialHash, scopeFromHeaders } from './auth.js';
import { AgentHttpError } from './types.js';
import type { HttpScope } from './types.js';

function authority(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && value === value.toLowerCase()
    && validatePrimitive('uuid', value).ok;
}
/** Captured installation authority and request identities, before any service effect. */
export class RequestIdentity {
  private readonly credential: Buffer;
  readonly journalAuthority: string;
  private readonly scopes = new WeakMap<FastifyRequest, HttpScope>();
  constructor(credential: string, journalAuthority: string) {
    this.credential = credentialHash(credential);
    if (!authority(journalAuthority)) throw new TypeError('Invalid agent journal authority');
    this.journalAuthority = journalAuthority;
  }
  capture(request: FastifyRequest): void {
    const raw = authenticate(request, this.credential);
    if ((request.raw.url?.length ?? 0) > 2048) throw new AgentHttpError(414, 'invalid_protocol');
    if (request.routeOptions.url === '/runner/v1/capabilities') return;
    const scope = scopeFromHeaders(raw); this.scopes.set(request, scope);
    if (!request.routeOptions.url?.startsWith('/runner/v1/attempts/:attemptId')) return;
    this.scopes.set(request, Object.freeze({ ...scope, attemptId: attemptId(request.params) }));
    const expected = raw.get('x-beetle-journal-authority');
    if (!authority(expected)) throw new AgentHttpError(400, 'invalid_protocol');
    if (expected !== this.journalAuthority) throw new AgentHttpError(409, 'authority_mismatch');
  }
  scope(request: FastifyRequest): HttpScope | undefined { return this.scopes.get(request); }
  key(request: FastifyRequest): GenerationKey {
    const scope = this.scopes.get(request);
    if (!scope?.attemptId) throw new AgentHttpError(403, 'invalid_protocol');
    return { organizationId: scope.organizationId, workspaceId: scope.workspaceId,
      generation: scope.generation, attemptId: scope.attemptId };
  }
}
