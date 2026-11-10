import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { Owned, OutputAbsence } from '@beetle/contracts/output-source';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { AgentHttpOptions } from '../../src/transport/index.js';
import { createAgentServer } from '../../src/transport/index.js';

export const key = { organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002', attemptId: '00000000-0000-4000-8000-000000000003', generation: 1 };
export const authority = '33333333-3333-4333-8333-333333333333';
export const other = '00000000-0000-4000-8000-000000000099';
export const headers = { authorization: `Bearer ${'S'.repeat(64)}`, 'x-beetle-organization-id': key.organizationId,
  'x-beetle-workspace-id': key.workspaceId, 'x-beetle-generation': '1', 'x-beetle-journal-authority': authority };
export const path = `/runner/v1/attempts/${key.attemptId}/source`;
export function proof(): Owned<OutputAbsence> {
  return captureOutputAbsence({ ...key, version: 1, intentDigest: 'a'.repeat(64), journalAuthority: authority,
    finalAgentSeq: 0, admission: { state: 'rejected', reason: 'unsupported_capability' }, reason: 'unsupported_capability' });
}
export function snapshot(): AttemptSnapshot {
  return { ...key, protocolVersion: '1.0', intentDigest: 'a'.repeat(64), state: 'admitted', lastSeq: 0,
    retainedStartSeq: 0, cancelRequested: false };
}
export const unused = async (): Promise<never> => { throw new Error('Unexpected service call'); };
export function server(options: Partial<AgentHttpOptions> = {}, absence = true) {
  return createAgentServer({ credential: 'S'.repeat(64), journalAuthority: authority,
    installation: { enqueue: unused, cancel: unused, cancelOriginal: unused }, capabilities: unused,
    journal: { get: async () => snapshot(), readEvents: unused, acknowledge: unused },
    ...(absence ? { absences: { readOutputAbsence: async () => proof() } } : {}), ...options });
}
export function get(origin: string, route = `${path}/absence`, overrides: Record<string, string> = {}, body?: string) {
  const req = request(new URL(route, origin), { method: 'GET', agent: false, headers: { ...headers, ...overrides } });
  const result = new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    req.once('response', response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      response.once('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString(), headers: response.headers }));
      response.once('error', reject);
    });
    req.once('error', reject);
  });
  req.end(body); return { req, result };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
export async function turns() { await new Promise<void>(resolve => setImmediate(resolve)); }
