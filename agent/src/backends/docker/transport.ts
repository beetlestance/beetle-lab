import { exchangeDockerOriginal } from './request-original.js';
import { inspectionPath } from './inspection-paths.js';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { isAbsolute, normalize } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeJson } from '@beetle/contracts';
import type { DockerReply, DockerRequest, DockerTransport, FailureReason } from './types.js';
import type { MailboxArchiveRequest, MailboxArchiveReply } from './types.js';
import { readMailboxOriginal } from './mailbox-read.js';

export const TRANSPORT_LIMITS = Object.freeze({ requestBytes: 65_536, responseBytes: 1_048_576,
  fragments: 4096, concurrent: 64, timeoutMs: 30_000 });
export type RequestFactory = typeof httpRequest;

function validSocket(path: string): boolean {
  return typeof path === 'string' && path.length <= 1024 && isAbsolute(path)
    && normalize(path) === path && !Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
function validRequest(input: DockerRequest): boolean {
  return !!input && ['GET', 'POST', 'DELETE'].includes(input.method) && typeof input.path === 'string' && input.path.length <= 2048
    && (/^\/(?:version|v1\.47\/(?:info|containers\/[^\s#]*))$/u.test(input.path)
      || input.method === 'GET' && inspectionPath(input.path) || volumePath(input))
    && Number.isFinite(input.deadline);
}
function volumePath(input: DockerRequest): boolean {
  if (input.method === 'POST') return input.path === '/v1.47/volumes/create';
  const suffix = input.method === 'DELETE' ? '\\?force=false' : '';
  return new RegExp(`^/v1\\.47/volumes/beetle-[a-f0-9]{64}-live${suffix}$`).test(input.path);
}
function validMailboxRequest(input: MailboxArchiveRequest): boolean {
  if (!input || typeof input.containerId !== 'string' || !/^[a-f0-9]{64}$/.test(input.containerId) || !Number.isFinite(input.deadline)) return false;
  return input.signal === undefined || input.signal instanceof AbortSignal;
}

/** One bounded Unix HTTP owner. Inject request factory for synthetic streams; never follows redirects. */
export class UnixDockerTransport implements DockerTransport {
  private active = 0;
  private mailboxActive = 0;
  constructor(private readonly socketPath: string, private readonly factory: RequestFactory = httpRequest) {
    if (!validSocket(socketPath)) throw new Error('invalid_socket');
  }
  async readMailboxArchive(input: MailboxArchiveRequest): Promise<MailboxArchiveReply> {
    if (!validMailboxRequest(input)) return {ok: false, reason: 'invalid_input', dispatched: false};
    if (input.signal?.aborted) return {ok: false, reason: 'aborted', dispatched: false};
    if (input.deadline <= performance.now()) return {ok: false, reason: 'deadline', dispatched: false};
    // Telemetry occupies at most two ordinary slots, leaving capacity for controls.
    if (this.mailboxActive >= 2 || this.active >= TRANSPORT_LIMITS.concurrent - 2) return {ok: false, reason: 'overflow', dispatched: false};
    const deadline = Math.min(input.deadline, performance.now() + 5000);
    this.active++; this.mailboxActive++;
    try {return await readMailboxOriginal({socketPath: this.socketPath, input: {...input, deadline}, factory: this.factory});}
    finally {this.active--; this.mailboxActive--;}
  }
  async request(input: DockerRequest): Promise<DockerReply> {
    if (!validRequest(input)) return { ok: false, reason: 'invalid_input', dispatched: false };
    if (this.active >= TRANSPORT_LIMITS.concurrent) return { ok: false, reason: 'overflow', dispatched: false };
    if (input.signal?.aborted) return { ok: false, reason: 'aborted', dispatched: false };
    const deadline = Math.min(input.deadline, performance.now() + TRANSPORT_LIMITS.timeoutMs);
    const remaining = deadline - performance.now();
    if (remaining <= 0) return { ok: false, reason: 'deadline', dispatched: false };
    let body: string;
    try { body = input.body === undefined ? '' : encodeJson(input.body, TRANSPORT_LIMITS.requestBytes); }
    catch { return { ok: false, reason: 'request_limit', dispatched: false }; }
    const dispatchBudget = Math.min(deadline - performance.now(), remaining);
    if (dispatchBudget <= 0) return { ok: false, reason: 'deadline', dispatched: false };
    this.active++;
    try { return await this.exchange({ ...input, deadline }, body, dispatchBudget); }
    finally { this.active--; }
  }
  private exchange(input: DockerRequest, body: string, remaining: number): Promise<DockerReply> {
    return exchangeDockerOriginal({socketPath:this.socketPath,factory:this.factory,input,body,remaining,consume});
  }
}

function consume(response: IncomingMessage, finish: (reply: DockerReply) => void,
  fail: (reason: FailureReason) => void): void {
  const buffer = Buffer.alloc(TRANSPORT_LIMITS.responseBytes);
  let length = 0;
  let fragments = 0;
  response.on('error', () => fail('unavailable'));
  response.on('aborted', () => fail('unavailable'));
  response.on('close', () => { if (!response.complete) fail('unavailable'); });
  response.on('data', (chunk: unknown) => {
    if (!Buffer.isBuffer(chunk)) { fail('malformed'); return; }
    if (++fragments > TRANSPORT_LIMITS.fragments || length + chunk.length > buffer.length) {
      fail('response_limit'); return;
    }
    chunk.copy(buffer, length); length += chunk.length;
  });
  response.on('end', () => {
    try {
      const body: unknown = length === 0 ? null
        : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
      if (!response.statusCode) { fail('malformed'); return; }
      finish({ ok: true, status: response.statusCode, body });
    } catch { fail('malformed'); }
  });
}
