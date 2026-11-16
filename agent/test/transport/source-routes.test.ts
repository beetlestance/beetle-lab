import { expect, it } from 'vitest';
import type { Owned, SourceEnvelope, SourceChunk } from '@beetle/contracts/output-source';
import { OutputTransferError } from '../../src/output-transfer/index.js';
import { JournalError } from '../../src/journal/index.js';
import { HTTP_LIMITS } from '../../src/transport/index.js';
import { sourceFixture } from './source-fixture.js';

const f = sourceFixture();
it('serves exact public envelopes and selected chunks on task-owned actual HTTP with fresh bounded budgets', async () => {
  const e = await f.server(); const port = await f.listen(e.server); const before = performance.now();
  const get = f.raw(port, e.path, e.headers); get.client.end(); const response = await get.response;
  expect(response.status).toBe(200); expect(response.headers.connection).toBe('close'); expect(JSON.parse(response.body)).toEqual(e.envelope);
  expect(response.body).not.toContain('directory'); expect(response.body).not.toContain('checkpoint');
  const post = f.raw(port, `${e.path}/chunk`, e.headers, 'POST'); post.client.end(JSON.stringify(e.selector));
  const chunk = await post.response; expect(chunk.status).toBe(200); expect(JSON.parse(chunk.body)).toEqual(e.chunk);
  expect(e.getChunk.mock.calls[0]![0]).toEqual(e.key); expect(e.getChunk.mock.calls[0]![1]).toEqual(e.selector);
  const budget = e.getSource.mock.calls[0]![1];
  expect(budget.deadline).toBeGreaterThan(before); expect(budget.deadline).toBeLessThanOrEqual(performance.now() + HTTP_LIMITS.requestMs);
  expect(budget.signal).toBeInstanceOf(AbortSignal); expect(e.unused).not.toHaveBeenCalled();
});
it('supports Fastify injection while retaining the same response cleanup path', async () => {
  const e = await f.server();
  for (let i = 0; i < 4; i++) {
    const response = await e.server.inject({ url: e.path, headers: e.headers });
    expect(response.statusCode).toBe(200); await new Promise(resolve => setImmediate(resolve));
  }
});
it.each([
  ['pending', 409, 'source_pending', 'transport'], ['unavailable', 409, 'source_unavailable', 'never'],
  ['conflict', 409, 'conflicting_digest', 'never'], ['invalid_input', 400, 'invalid_protocol', 'never'],
  ['busy', 429, 'budget_unavailable', 'transport'], ['interrupted', 503, 'execution_lost', 'transport'],
] as const)('maps %s source failures to fixed scoped errors', async (code, status, reason, retry) => {
  const e = await f.server(); e.getSource.mockRejectedValue(new OutputTransferError(code));
  const response = await e.server.inject({ url: e.path, headers: e.headers });
  expect(response.statusCode).toBe(status); expect(response.json()).toMatchObject({ organizationId: e.key.organizationId,
    workspaceId: e.key.workspaceId, attemptId: e.key.attemptId, reason, retry });
  expect(response.body).not.toContain('Output transfer');
});
it('maps missing original, absent wiring and unexpected errors without exposing private details', async () => {
  const e = await f.server();
  for (const [error, status, reason] of [[new JournalError('not_found'), 404, 'attempt_not_found'],
    [new Error('/private/task/secret'), 500, 'invalid_protocol']] as const) {
    e.getSource.mockRejectedValueOnce(error);
    const response = await e.server.inject({ url: e.path, headers: e.headers });
    expect(response.statusCode).toBe(status); expect(response.json()).toMatchObject({ reason }); expect(response.body).not.toContain('/private');
    await new Promise(resolve => setImmediate(resolve));
  }
  const absent = await f.server(true); const response = await absent.server.inject({ url: absent.path, headers: absent.headers });
  expect(response.statusCode).toBe(503); expect(response.json()).toMatchObject({ reason: 'execution_lost', retry: 'transport' });
});
it('checks authentication, exact namespace, generation, path UUID and authority before source service effects', async () => {
  const e = await f.server(); const foreign = '00000000-0000-4000-8000-000000000099';
  for (const [url, headers, status] of [
    [e.path, { ...e.headers, authorization: 'Bearer invalid' }, 401],
    [e.path, { ...e.headers, 'x-beetle-generation': '2' }, 409],
    [e.path, { ...e.headers, 'x-beetle-organization-id': 'bad' }, 400],
    [e.path, { ...e.headers, 'x-beetle-journal-authority': foreign }, 409],
    [e.path.replace(e.key.attemptId, 'bad'), e.headers, 400],
    [`${e.path}?unexpected=1`, e.headers, 400],
  ] as const) expect((await e.server.inject({ url, headers })).statusCode).toBe(status);
  expect(e.getSource).not.toHaveBeenCalled();
  const response = await e.server.inject({ url: e.path, headers: { ...e.headers, 'x-beetle-workspace-id': foreign } });
  expect(response.statusCode).toBe(500); expect(response.body).not.toContain(e.key.workspaceId);
});
it('bounds chunk body bytes before parse and uses shared closed selector validation', async () => {
  const e = await f.server(); const headers = { ...e.headers, 'content-type': 'application/json' };
  const text = JSON.stringify(e.selector); const payload = text + ' '.repeat(1024 - Buffer.byteLength(text));
  const options = { method: 'POST' as const, url: `${e.path}/chunk`, headers };
  const large = await e.server.inject({ ...options, payload: payload + ' ' });
  expect(large.statusCode).toBe(413); expect(large.json()).toMatchObject({ reason: 'invalid_protocol' });
  await new Promise(resolve => setImmediate(resolve));
  for (const body of ['{invalid', JSON.stringify({ ...e.selector, path: 'private' }),
    JSON.stringify({ ...e.selector, length: 65_537 }), JSON.stringify({ ...e.selector, artifactId: 'invalid' })]) {
    expect((await e.server.inject({ ...options, payload: body })).statusCode).toBe(400);
    await new Promise(resolve => setImmediate(resolve));
  }
  expect(e.getChunk).not.toHaveBeenCalled();
  expect((await e.server.inject({ ...options, payload })).statusCode).toBe(200); expect(e.getChunk).toHaveBeenCalledTimes(1);
});
it('passes exact selectors to the durable reader and preserves its conflicting selector outcome', async () => {
  const e = await f.server(); e.getChunk.mockRejectedValue(new OutputTransferError('conflict'));
  const input = { ...e.selector, sourceDigest: 'f'.repeat(64) };
  const response = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: input });
  expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({ reason: 'conflicting_digest', retry: 'never' });
  expect(e.getChunk.mock.calls[0]![1]).toEqual(input);
});
it('bounds producer replies before later getters/copies and refuses root leaks and malformed semantic chunks', async () => {
  const e = await f.server(); let calls = 0;
  const oversized = { base64: 'a'.repeat(90_113), get privateRoot() { calls++; return '/private/task'; } };
  e.getChunk.mockResolvedValueOnce(oversized as unknown as Owned<SourceChunk>);
  const options = { method: 'POST' as const, url: `${e.path}/chunk`, headers: e.headers, payload: e.selector };
  const response = await e.server.inject(options);
  expect(response.statusCode).toBe(500); expect(calls).toBe(0); expect(response.body).not.toContain('/private');
  await new Promise(resolve => setImmediate(resolve));
  e.getSource.mockResolvedValueOnce({ ...e.envelope, root: '/private/task' } as unknown as Owned<SourceEnvelope>);
  expect((await e.server.inject({ url: e.path, headers: e.headers })).statusCode).toBe(500);
  await new Promise(resolve => setImmediate(resolve));
  e.getChunk.mockResolvedValueOnce({ ...e.chunk, base64: 'YR==' });
  expect((await e.server.inject(options)).statusCode).toBe(500);
});
it('applies the smaller envelope cap before later field capture and accepts one full65536-byte chunk', async () => {
  const e = await f.server(); let reads = 0;
  e.getSource.mockResolvedValueOnce({ oversized: 'a'.repeat(75_777),
    get later() { reads++; return '/private/task'; } } as unknown as Owned<SourceEnvelope>);
  const response = await e.server.inject({ url: e.path, headers: e.headers });
  expect(response.statusCode).toBe(500); expect(reads).toBe(0); expect(response.body).not.toContain('/private');
  await new Promise(resolve => setImmediate(resolve));
  const bytes = Buffer.alloc(65_536, 7); const selector = { ...e.selector, length: bytes.length };
  e.getChunk.mockResolvedValueOnce({ ...e.chunk, nextOffset: bytes.length, totalBytes: bytes.length, eof: true, base64: bytes.toString('base64') });
  const chunk = await e.server.inject({ method: 'POST', url: `${e.path}/chunk`, headers: e.headers, payload: selector });
  expect(chunk.statusCode).toBe(200); expect(Buffer.byteLength(chunk.body)).toBeLessThanOrEqual(90_112);
  expect(Buffer.from(chunk.json().base64, 'base64')).toEqual(bytes);
});
it('requires header-only GET source requests and rejects chunk query selectors before services', async () => {
  const e = await f.server();
  const body = await e.server.inject({ method: 'GET', url: e.path, headers: e.headers, payload: '{}' });
  expect(body.statusCode).toBe(400); expect(body.json()).toMatchObject({ reason: 'invalid_protocol' });
  const query = await e.server.inject({ method: 'POST', url: `${e.path}/chunk?path=private`, headers: e.headers, payload: e.selector });
  expect(query.statusCode).toBe(400); expect(e.getSource).not.toHaveBeenCalled(); expect(e.getChunk).not.toHaveBeenCalled();
});
