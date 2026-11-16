import { expect, it } from 'vitest';
import { storageFixture } from '../storage/fixture.js';
import { captureLocalSessionOperation, captureLocalSessionReply } from '../../src/adapters/outbound/sqlite/local-session/index.js';
const storage = storageFixture();
const session = {cookie: 'a'.repeat(43), csrfToken: 'b'.repeat(43), issuedAt: '2026-11-12T00:00:00.000Z', expiresAt: '2026-11-12T08:00:00.000Z'};
it('persists one private session across compiled-worker restart, replays a lost write and durably revokes without disturbing other metadata', async () => {
  const path = storage.path(); let metadata = await storage.open(path, {runtime: null});
  expect(await metadata.localSessions.load()).toEqual({version: 0, session: null});
  const before = await metadata.inputs.storage(); const saved = await metadata.localSessions.save(0, session);
  await storage.close(metadata); metadata = await storage.open(path, {runtime: null});
  expect(await metadata.localSessions.load()).toEqual(saved);
  expect(await metadata.localSessions.save(0, session)).toEqual(saved);
  await expect(metadata.localSessions.save(0, {...session, cookie: 'c'.repeat(43)})).rejects.toMatchObject({code: 'conflict'});
  expect(await metadata.localSessions.save(1, null)).toEqual({version: 2, session: null});
  await storage.close(metadata); metadata = await storage.open(path, {runtime: null});
  expect(await metadata.localSessions.load()).toEqual({version: 2, session: null});
  expect(await metadata.localSessions.save(1, null)).toEqual({version: 2, session: null});
  await expect(metadata.localSessions.save(0, session)).rejects.toMatchObject({code: 'conflict'});
  expect(await metadata.inputs.storage()).toEqual(before);
});
it('rejects malformed credentials, oversized envelopes, changed reply secrets and accessors at both RPC boundaries', () => {
  const operation = {kind: 'saveLocalSession' as const, expectedVersion: 0, session};
  expect(captureLocalSessionOperation({...operation, messageId: 1})).toEqual(operation);
  for (const input of [{...operation, extra: true}, {...operation, expectedVersion: -0}, {...operation, session: {...session, expiresAt: session.issuedAt}},
    {...operation, padding: 'x'.repeat(2048)}, {...operation, session: {...session, cookie: session.csrfToken}}]) expect(() => captureLocalSessionOperation(input)).toThrow();
  expect(() => captureLocalSessionReply(operation, {version: 1, session: {...session, csrfToken: 'c'.repeat(43)}})).toThrow();
  expect(() => captureLocalSessionReply(operation, {version: 2, session})).toThrow();
  let accessed = false; const input = Object.defineProperty({}, 'kind', {enumerable: true, get() {accessed = true; return operation.kind;}});
  expect(() => captureLocalSessionOperation(input)).toThrow(); expect(accessed).toBe(false);
});
