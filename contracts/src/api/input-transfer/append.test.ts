import { describe, expect, it, vi } from 'vitest';
import { createInputTransferClient } from './index.js';
import { json, record } from './fixtures.test-support.js';

const baseUrl = 'https://fixture.invalid';
describe('append intent and acknowledgement', () => {
  it('captures bytes/record and emits only the fixed transfer policy', async () => {
    const input = record({ bytes: 3, state: 'staging' });
    const chunk = new Uint8Array([1, 2, 3]);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init).toMatchObject({ method: 'PUT', redirect: 'error', credentials: 'same-origin' });
      expect(init?.body).toEqual(new Uint8Array([1, 2, 3]));
      await Promise.resolve();
      return json(record({ bytes: 3, offset: 3, state: 'staging', version: 2 }));
    });
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    const result = client.append({ record: input, offset: 0, chunk });
    input.name = 'mutated'; chunk.fill(9);
    expect(await result).toMatchObject({ ok: true, value: { name: 'fixture', offset: 3, version: 2 } });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${baseUrl}/api/v2/organizations/${input.scope.organizationId}/workspaces/${input.scope.workspaceId}/inputs/${input.id}/chunks?offset=0`);
    await client.close();
  });
  it('accepts an exact replay without advancing progress', async () => {
    const input = record({ bytes: 4, offset: 3, version: 5, state: 'staging' });
    const client = createInputTransferClient({ baseUrl, fetch: async () => json(input) });
    expect(await client.append({ record: input, offset: 0, chunk: new Uint8Array([1, 2]) })).toEqual({ ok: true, value: input });
    await client.close();
  });
  it.each(['id', 'folderId', 'name', 'sha256', 'bytes', 'scope', 'offset', 'version', 'state', 'reason'] as const)('rejects corrupt %s acknowledgement', async field => {
    const input = record({ bytes: 3, state: 'staging' });
    const reply: Record<string, unknown> = { ...input, offset: 3, version: 2 };
    const changes = { id: record().folderId, folderId: record().id, name: 'wrong', sha256: 'a'.repeat(64), bytes: 4,
      scope: { ...input.scope, workspaceId: input.id }, offset: 2, version: 3, state: 'published', reason: 'io' };
    reply[field] = changes[field];
    const client = createInputTransferClient({ baseUrl, fetch: async () => json(reply) });
    expect(await client.append({ record: input, offset: 0, chunk: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: false, issued: true, error: { kind: 'response' } });
    await client.close();
  });
  it('rejects invalid accessors, overlap, states and chunks before issue', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createInputTransferClient({ baseUrl, fetch: fetcher });
    const getter = vi.fn(() => record());
    const input = record({ bytes: 4, offset: 3, state: 'staging' });
    const requests = [Object.defineProperty({}, 'record', { get: getter }),
      { record: input, offset: 2, chunk: new Uint8Array([1, 2]) },
      { record: { ...input, reason: 'io' }, offset: 0, chunk: new Uint8Array([1]) },
      { record: input, offset: 0, chunk: new Uint8Array(65_537) },
      { record: input, offset: 0, chunk: new Uint8Array() },
      { record: { ...input, id: input.id.toUpperCase().replace('000001', '00000A') }, offset: 0, chunk: new Uint8Array([1]) }];
    for (const request of requests) expect(await client.append(request as Parameters<typeof client.append>[0])).toMatchObject({ ok: false, issued: false, error: { kind: 'request' } });
    expect(getter).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    await client.close();
  });
  it('uses intrinsic typed array copying without executing custom getters', async () => {
    const chunk = new Uint8Array([1]); const getter = vi.fn(() => { throw new Error('getter'); });
    Object.defineProperty(chunk, 'length', { get: getter });
    Object.defineProperty(chunk, Symbol.iterator, { get: getter });
    const client = createInputTransferClient({ baseUrl, fetch: async (_url, init) => {
      expect(init?.body).toEqual(new Uint8Array([1]));
      return json(record({ bytes: 1, offset: 1, version: 2, state: 'staging' }));
    } });
    expect(await client.append({ record: record({ bytes: 1, state: 'staging' }), offset: 0, chunk })).toMatchObject({ ok: true });
    expect(getter).not.toHaveBeenCalled(); await client.close();
  });
});
