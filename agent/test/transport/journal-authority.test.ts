import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { fixture } from './fixtures.js';

const f = fixture();
const other = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
it.each(['', 'not-a-uuid', other.toUpperCase(), `urn:uuid:${other}`])('rejects malformed authority %s before immutable admission', async invalid => {
  const e = await f.server();
  const response = await e.server.inject({ method: 'PUT', url: e.path, payload: e.job,
    headers: { ...e.headers, 'x-beetle-journal-authority': invalid } });
  expect(response.statusCode).toBe(400); expect(e.enqueue).not.toHaveBeenCalled();
  expect((await e.journal.listOpen({ limit: 1 })).snapshots).toEqual([]);
});
it('rejects missing and duplicate authority before service work', async () => {
  const e = await f.server();
  const { 'x-beetle-journal-authority': _authority, ...missing } = e.headers; void _authority;
  const absent = await e.server.inject({ method: 'PUT', url: e.path, payload: e.job, headers: missing });
  expect(absent.statusCode).toBe(400);
  const duplicate = await e.server.inject({ method: 'PUT', url: e.path, payload: e.job,
    headers: { ...e.headers, 'x-beetle-journal-authority': [e.capabilities.journalAuthority, e.capabilities.journalAuthority] } });
  expect([400, 403]).toContain(duplicate.statusCode); expect(e.enqueue).not.toHaveBeenCalled();
  expect((await e.journal.listOpen({ limit: 1 })).snapshots).toEqual([]);
});
it.each(['PUT', 'GET', 'cancel', 'events', 'ack'] as const)('fences %s with wrong authority before reading or mutating an existing receipt', async operation => {
  const e = await f.server(); const before = await e.store();
  const path = operation === 'PUT' || operation === 'GET' ? e.path : `${e.path}/${operation}`;
  const method = operation === 'cancel' || operation === 'ack' ? 'POST' : operation === 'PUT' ? 'PUT' : 'GET';
  const response = await e.server.inject({ method, url: operation === 'events' ? `${path}?after=0` : path,
    headers: { ...e.headers, 'x-beetle-journal-authority': other }, ...(operation === 'PUT' ? { payload: e.job } : {}) });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ reason: 'authority_mismatch', attemptId: e.key.attemptId });
  expect(validate('ProtocolError', response.json()).ok).toBe(true);
  expect(e.enqueue).not.toHaveBeenCalled(); expect(e.cancel).not.toHaveBeenCalled(); expect(e.events).not.toHaveBeenCalled();
  expect(await e.journal.get(e.key)).toEqual(before);
});
it('returns an exactly scoped missing receipt only under the current authority and keeps replay idempotent', async () => {
  const e = await f.server();
  const missing = await e.server.inject({ url: e.path, headers: e.headers });
  expect(missing.statusCode).toBe(404); expect(missing.json()).toMatchObject({ reason: 'attempt_not_found',
    attemptId: e.key.attemptId, organizationId: e.key.organizationId, workspaceId: e.key.workspaceId });
  expect(validate('ProtocolError', missing.json()).ok).toBe(true);
  const first = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers, payload: e.job });
  const replay = await e.server.inject({ method: 'PUT', url: e.path, headers: e.headers, payload: e.job });
  expect(first.statusCode).toBe(202); expect(replay.statusCode).toBe(202); expect(replay.json()).toEqual(first.json());
  expect((await e.journal.listOpen({ limit: 10 })).snapshots).toHaveLength(1);
});
it('refuses a structurally valid capability producer from another physical journal', async () => {
  const e = await f.server(); e.setCapabilities(async () => ({ ...e.capabilities, journalAuthority: other }));
  const response = await e.server.inject({ url: '/runner/v1/capabilities', headers: e.headers });
  expect(response.statusCode).toBe(503); expect(response.body).not.toContain(other);
});
