import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApiClient, createInputTransferClient } from '@beetle/contracts/api';
import type { ApiClientResult, InputTransferResult } from '@beetle/contracts/api';

function value<T>(result: ApiClientResult<T> | InputTransferResult<T>): T {
  assert(result.ok, 'Bundled input HTTP operation failed'); return result.value;
}
/** Real compiled bootstrap and HTTP framing; synthetic bytes and no engine. */
export async function authorInputs(origin: string, cookie: string, csrfToken: string): Promise<void> {
  const headers = { origin, cookie, 'x-beetle-csrf': csrfToken };
  const api = createApiClient({ baseUrl: origin, headers });
  const organization = value(await api.createOrganization({ body: { scope: { kind: 'installation' },
    requestId: randomUUID(), name: 'Input smoke', slug: 'input-smoke' } }));
  const workspace = value(await api.createWorkspace({ params: { organizationId: organization.id }, body: {
    scope: { kind: 'organization', organizationId: organization.id }, requestId: randomUUID(), name: 'Input workspace' } }));
  const params = { organizationId: organization.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };
  const bytes = Buffer.alloc(65_543, 0x61); bytes.set(Buffer.from('synthetic π\n'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // Node has no browser cookie jar or automatic Origin header. Supply only that
  // transport behavior at fetch; the byte client's reserved-header guard stays on.
  const browserFetch: typeof fetch = (input, init) => {
    const outgoing = new Headers(init?.headers);
    outgoing.set('origin', origin); outgoing.set('cookie', cookie);
    return fetch(input, { ...init, headers: outgoing });
  };
  const transfers = createInputTransferClient({ baseUrl: origin, fetch: browserFetch,
    headers: { 'x-beetle-csrf': csrfToken } });
  try {
    const prepared = value(await transfers.prepare({ file: new Blob([new Uint8Array(bytes)]) }));
    assert.equal(prepared.sha256, sha256); assert.deepEqual(Buffer.from(prepared.content), bytes);
    let record = value(await api.createInput({ params, body: { scope, requestId: randomUUID(), name: 'Input smoke',
      sha256: prepared.sha256, bytes: prepared.content.length } }));
    const key = { ...params, inputId: record.id };
    for (let offset = 0; offset < bytes.length; offset += 65_536) {
      record = value(await transfers.append({ record, offset,
        chunk: prepared.content.subarray(offset, Math.min(bytes.length, offset + 65_536)) }));
      assert.equal(record.offset, Math.min(bytes.length, offset + 65_536));
    }
    value(await api.sealInput({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: record.version } }));
    record = value(await api.getInput({ params: key })); assert.equal(record.state, 'published');
    const downloaded = value(await transfers.download({ record }));
    assert.deepEqual(Buffer.from(downloaded), bytes);
    value(await api.deleteInput({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: record.version } }));
    assert.equal(value(await api.getInput({ params: key })).state, 'deleted');
  } finally { await transfers.close(); }
}
