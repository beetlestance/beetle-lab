import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { TRANSPORT_LIMITS, UnixDockerTransport } from '../../../src/backends/docker/index.js';
import type { DockerRequest, RequestFactory } from '../../../src/backends/docker/index.js';
import { operation } from './fixtures.js';

type SyntheticResponse = PassThrough & { statusCode: number; complete: boolean };
class SyntheticRequest extends EventEmitter {
  destroyed = false;
  body = '';
  response: SyntheticResponse | undefined;
  constructor(readonly options: RequestOptions, readonly send: (request: SyntheticRequest) => void) { super(); }
  end(body: string): void { this.body = body; queueMicrotask(() => this.send(this)); }
  destroy(): void { this.destroyed = true; }
  respond(status = 200): SyntheticResponse {
    const response = Object.assign(new PassThrough(), { statusCode: status, complete: true });
    this.response = response; this.emit('response', response as unknown as IncomingMessage);
    return response;
  }
}
function harness(send: (request: SyntheticRequest) => void) {
  const requests: SyntheticRequest[] = [];
  const factory = ((options: RequestOptions) => {
    const request = new SyntheticRequest(options, send); requests.push(request);
    return request as unknown as ClientRequest;
  }) as RequestFactory;
  return { transport: new UnixDockerTransport('/tmp/task-owned-docker.sock', factory), requests };
}
function call(extra: Partial<DockerRequest> = {}): DockerRequest {
  return { ...operation(), method: 'GET', path: '/version', ...extra };
}

describe('bounded Unix HTTP transport', () => {
  it('uses only explicit Unix socket and returns bounded parsed JSON', async () => {
    const { transport, requests } = harness(request => request.respond().end('{"ApiVersion":"1.47"}'));
    expect(await transport.request(call())).toEqual({ ok: true, status: 200, body: { ApiVersion: '1.47' } });
    expect(requests[0]?.options).toMatchObject({ socketPath: '/tmp/task-owned-docker.sock', method: 'GET',
      path: '/version', agent: false, maxHeaderSize: 16_384 });
    expect(requests[0]?.options).not.toHaveProperty('host');
    expect(requests[0]?.destroyed).toBe(true);
    expect(requests[0]?.response?.destroyed).toBe(true);
  });
  it('handles empty mutation response and serializes only bounded request JSON', async () => {
    const { transport, requests } = harness(request => request.respond(204).end());
    expect(await transport.request(call({ method: 'POST', path: '/v1.47/containers/fake/start', body: { trusted: true } })))
      .toEqual({ ok: true, status: 204, body: null });
    expect(requests[0]?.body).toBe('{"trusted":true}');
    expect(requests[0]?.options.headers).toMatchObject({ 'content-length': 16 });
    expect(await transport.request(call({ body: { huge: 'x'.repeat(TRANSPORT_LIMITS.requestBytes) } })))
      .toEqual({ ok: false, reason: 'request_limit', dispatched: false });
    expect(requests).toHaveLength(1);
  });
  it.each(['http://remote/socket', 'relative', '/tmp/../docker.sock', '/tmp/socket\n'])('rejects invalid socket %s', path => {
    expect(() => new UnixDockerTransport(path)).toThrow('invalid_socket');
  });
  it('rejects host URLs, invalid API paths and nonfinite deadlines without dispatch', async () => {
    const { transport, requests } = harness(request => request.respond().end('{}'));
    for (const path of ['http://remote/containers', '//remote/containers', '/v1.46/containers/json', '/v1.47/containers/name#fragment']) {
      expect(await transport.request(call({ path }))).toEqual({ ok: false, reason: 'invalid_input', dispatched: false });
    }
    expect(await transport.request(call({ deadline: Infinity }))).toMatchObject({ ok: false, reason: 'invalid_input' });
    expect(requests).toHaveLength(0);
  });
  it.each(['bytes', 'fragments', 'malformed', 'utf8', 'early-close', 'error'])('bounds/rejects response %s and destroys streams', async kind => {
    const { transport, requests } = harness(request => {
      const response = request.respond();
      const scripts: Record<string, () => void> = {
        bytes: () => response.end(Buffer.alloc(TRANSPORT_LIMITS.responseBytes + 1, 32)),
        fragments: () => { for (let index = 0; index <= TRANSPORT_LIMITS.fragments; index++) response.write(' '); response.end(); },
        malformed: () => response.end('secret-canary'), utf8: () => response.end(Buffer.from([255])),
        'early-close': () => { response.complete = false; response.emit('close'); },
        error: () => response.emit('error', new Error('/private/secret-canary')),
      };
      scripts[kind]!();
    });
    const result = await transport.request(call());
    expect(result).toEqual({ ok: false, reason: ['bytes', 'fragments'].includes(kind) ? 'response_limit'
      : ['malformed', 'utf8'].includes(kind) ? 'malformed' : 'unavailable', dispatched: true });
    expect(JSON.stringify(result)).not.toContain('secret-canary');
    expect(requests[0]?.destroyed).toBe(true);
    expect(requests[0]?.response?.destroyed).toBe(true);
  });
  it('uses an absolute deadline despite continuous fragments and ignores delayed response', async () => {
    vi.useFakeTimers();
    try {
      const { transport, requests } = harness(request => { request.respond().write(' '); });
      const pending = transport.request(call({ ...operation(25) }));
      await vi.advanceTimersByTimeAsync(10);
      requests[0]?.response?.write(' ');
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toEqual({ ok: false, reason: 'deadline', dispatched: true });
      requests[0]?.respond().end('{}');
      expect(requests[0]?.response?.destroyed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('handles abort before dispatch and while response is incomplete, removing listener', async () => {
    const controller = new AbortController();
    const { transport, requests } = harness(request => request.respond().write(' '));
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = transport.request(call({ signal: controller.signal }));
    await Promise.resolve(); controller.abort();
    expect(await pending).toEqual({ ok: false, reason: 'aborted', dispatched: true });
    expect(requests[0]?.response?.destroyed).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(await transport.request(call({ signal: controller.signal })))
      .toEqual({ ok: false, reason: 'aborted', dispatched: false });
    expect(requests).toHaveLength(1);
  });
  it('caps active operations at 64 and releases slots on cancellation', async () => {
    const controller = new AbortController();
    const { transport, requests } = harness(() => undefined);
    const pending = Array.from({ length: 64 }, () => transport.request(call({ signal: controller.signal })));
    expect(await transport.request(call())).toEqual({ ok: false, reason: 'overflow', dispatched: false });
    controller.abort();
    expect((await Promise.all(pending)).every(result => !result.ok && result.reason === 'aborted')).toBe(true);
    expect(requests).toHaveLength(64);
    expect(requests.every(request => request.destroyed)).toBe(true);
    const second = new AbortController(); second.abort();
    expect(await transport.request(call({ signal: second.signal }))).toMatchObject({ reason: 'aborted' });
  });
  it('never exposes request factory errors or retries', async () => {
    let count = 0;
    const factory = (() => { count++; throw new Error('/private/secret-canary'); }) as RequestFactory;
    const transport = new UnixDockerTransport('/tmp/task-owned.sock', factory);
    expect(await transport.request(call())).toEqual({ ok: false, reason: 'unavailable', dispatched: false });
    expect(count).toBe(1);
  });
});
