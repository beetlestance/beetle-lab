import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { ClientRequest } from 'node:http';
import { afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Capabilities } from '@beetle/contracts';
import type { Operation } from '../../src/backends/docker/index.js';
import type { Scope } from '../../src/admission/index.js';
import type { Owned, SourceEnvelope, SourceChunkRequest, SourceChunk } from '@beetle/contracts/output-source';
import { source } from '../output-source/fixtures.js';
import type { AgentHttpOptions } from '../../src/transport/index.js';
import { createAgentServer } from '../../src/transport/index.js';
import { JournalError } from '../../src/journal/index.js';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve };
}
export interface WireResponse { readonly status: number; readonly body: string; readonly headers: Record<string, unknown> }
export function sourceFixture() {
  const clients = new Set<ClientRequest>(); const servers: FastifyInstance[] = [];
  afterEach(async () => {
    for (const client of clients) client.destroy(); clients.clear();
    await Promise.all(servers.splice(0).map(server => server.close()));
  });
  return {
    async server(absent = false, liveMetrics?: AgentHttpOptions['liveMetrics']) {
      const stored = source(); const original = stored.manifest.binding;
      const key = { organizationId: original.organizationId, workspaceId: original.workspaceId,
        attemptId: original.attemptId, generation: 1 as const };
      const envelope: SourceEnvelope = { version: 1, manifest: stored.manifest, sourceDigest: stored.sourceDigest,
        closure: { version: 1, receipt: { version: 1, journalAuthority: original.journalAuthority, key,
          manifestDigest: stored.manifest.manifestDigest, sourceDigest: stored.sourceDigest }, finalAgentSeq: 0 } };
      const selector: SourceChunkRequest = { version: 1, manifestDigest: stored.manifest.manifestDigest,
        sourceDigest: stored.sourceDigest, artifactId: stored.manifest.result.artifacts[0]!.artifactId, offset: 0, length: 3 };
      const chunk: SourceChunk = { version: 1, manifestDigest: selector.manifestDigest, sourceDigest: selector.sourceDigest,
        artifactId: selector.artifactId, offset: 0, nextOffset: 3,
        totalBytes: stored.manifest.result.artifacts[0]!.bytes, eof: false, base64: 'YWJj' };
      const getSource = vi.fn(async (key: Scope, budget: Operation): Promise<Owned<SourceEnvelope>> => {
        void key; void budget; return envelope;
      });
      const getChunk = vi.fn(async (key: Scope, body: SourceChunkRequest, budget: Operation): Promise<Owned<SourceChunk>> => {
        void key; void body; void budget; return chunk;
      });
      const capabilities = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
      capabilities.journalAuthority = original.journalAuthority;
      const cap = vi.fn(async () => capabilities);
      const unused = vi.fn(async () => { throw new JournalError('not_found'); });
      const server = createAgentServer({ credential: 'S'.repeat(64), journalAuthority: original.journalAuthority,
        installation: { cancelExportOriginal: unused, enqueueExport: unused, enqueue: unused, cancel: unused, cancelOriginal: unused },
        ...(liveMetrics ? {liveMetrics} : {}),
        journal: { get: unused, readEvents: unused, acknowledge: unused }, capabilities: cap,
        ...(absent ? {} : { outputs: { source: getSource, chunk: getChunk } }) });
      servers.push(server);
      const headers = { authorization: `Bearer ${'S'.repeat(64)}`, 'x-beetle-organization-id': key.organizationId,
        'x-beetle-workspace-id': key.workspaceId, 'x-beetle-generation': '1',
        'x-beetle-journal-authority': original.journalAuthority, 'content-type': 'application/json' };
      return { server, key, envelope, selector, chunk, getSource, getChunk, capabilities, cap, headers,
        path: `/runner/v1/attempts/${key.attemptId}/source`, unused };
    },
    async listen(server: FastifyInstance): Promise<number> {
      await server.listen({ host: '127.0.0.1', port: 0 }); const address = server.server.address();
      if (!address || typeof address === 'string') throw new Error('missing task loopback port');
      return address.port;
    },
    raw(port: number, path: string, headers: Record<string, string>, method = 'GET') {
      let client!: ClientRequest;
      const response = new Promise<WireResponse>(resolve => {
        client = httpRequest({ host: '127.0.0.1', port, path, method, headers, agent: false }, reply => {
          const parts: Buffer[] = []; let size = 0;
          reply.on('data', (bytes: Buffer) => { size += bytes.length; if (size > 100_000) reply.destroy(); else parts.push(bytes); });
          reply.once('end', () => resolve({ status: reply.statusCode!, body: Buffer.concat(parts).toString(), headers: reply.headers }));
          reply.once('error', () => resolve({ status: 0, body: '', headers: {} }));
        });
        client.once('error', () => resolve({ status: 0, body: '', headers: {} }));
      });
      clients.add(client); client.flushHeaders(); return { client, response };
    },
  };
}
