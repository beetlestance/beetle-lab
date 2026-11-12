import { executionArtifacts } from '@beetle/contracts';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, vi } from 'vitest';
import type { SourceChunk, SourceChunkRequest, SourceEnvelope } from '@beetle/contracts/output-source';
import { OUTPUT_MANIFEST_PREFIX } from '@beetle/contracts/output-source';
import data from '../../../contracts/fixtures/output-source/v1.json' with { type: 'json' };
import { openGateway } from '../../src/adapters/outbound/runner/gateway.js';
import type { NativeIo } from '../../src/adapters/outbound/runner/native.js';
import type { RunnerAttemptIdentity } from '../../src/ports/runner.js';
import { deferred, loaded, turns } from './fixtures.js';

export function envelope(): SourceEnvelope {
  const vector = data.vectors[0]!;
  const manifest = { ...JSON.parse(vector.expected.manifestPreimage.slice(OUTPUT_MANIFEST_PREFIX.length)),
    manifestDigest: vector.expected.manifestDigest } as SourceEnvelope['manifest'];
  const { organizationId, workspaceId, attemptId, generation, journalAuthority } = manifest.binding;
  const sourceDigest = 'b'.repeat(64);
  return { version: 1, manifest, sourceDigest, closure: { version: 1, finalAgentSeq: 37,
    receipt: { version: 1, journalAuthority, key: { organizationId, workspaceId, attemptId, generation },
      manifestDigest: manifest.manifestDigest, sourceDigest } } };
}
export function originalIdentity(): RunnerAttemptIdentity {
  const { journalAuthority, organizationId, workspaceId, attemptId, generation, intentDigest } = envelope().manifest.binding;
  return { journalAuthority, organizationId, workspaceId, attemptId, generation, intentDigest };
}
export function selector(offset = 0, length = 32): SourceChunkRequest {
  const value = envelope();
  return { version: 1, manifestDigest: value.manifest.manifestDigest, sourceDigest: value.sourceDigest,
    artifactId: executionArtifacts(value.manifest.result)[0]!.artifactId, offset, length };
}
export function chunk(bytes = Buffer.alloc(32, 7), request = selector(), total = 32): SourceChunk {
  const { length, ...selected } = request; void length;
  return { ...selected, nextOffset: request.offset + bytes.length, totalBytes: total,
    eof: request.offset + bytes.length === total, base64: bytes.toString('base64') };
}
function nativeOriginal(options: RequestOptions) {
  const socket = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn<(body?: string) => void>(() => {
    request.emit('socket', socket as unknown as Socket);
  }) });
  const response = Object.assign(new EventEmitter(), { destroy: vi.fn(), complete: true,
    rawHeaders: ['Content-Type', 'application/json'], headers: { 'content-type': 'application/json' } as Record<string, string>, statusCode: 200 });
  return { request, response, socket, options,
    begin() { request.emit('response', response as unknown as IncomingMessage); },
    body(value: unknown, status = 200) {
      response.statusCode = status; this.begin(); response.emit('data', Buffer.from(JSON.stringify(value))); response.emit('end');
    },
    close() { response.emit('close'); request.emit('close'); socket.emit('close'); } };
}
function controlledNative(holdDns: boolean) {
  const originals: ReturnType<typeof nativeOriginal>[] = [];
  const lookups: ReturnType<typeof deferred<{ address: string; family: number }[]>>[] = [];
  const addresses = [{ address: '127.0.0.1', family: 4 }];
  const io: NativeIo = {
    lookup: vi.fn(() => {
      const work = deferred<typeof addresses>(); lookups.push(work);
      if (!holdDns) work.resolve(addresses);
      return work.promise;
    }),
    request: vi.fn(options => { const work = nativeOriginal(options); originals.push(work); return work.request as unknown as ClientRequest; }),
  };
  return { io, originals, lookups, releaseDns() { for (const work of lookups) work.resolve(addresses); } };
}
const cleanups: (() => Promise<void>)[] = [];
export function setup(holdDns = false) {
  const native = controlledNative(holdDns); const gateway = openGateway(loaded(), native.io);
  cleanups.push(async () => {
    const closing = gateway.close(); native.releaseDns(); await turns();
    for (const work of native.originals) work.close();
    await closing;
  });
  return { gateway, native, client: gateway.output(originalIdentity()) };
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks(); vi.useRealTimers();
});
