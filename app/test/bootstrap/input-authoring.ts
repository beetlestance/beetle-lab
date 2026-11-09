import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createApiClient } from '@beetle/contracts/api';
import type { ApiClientResult, InputRecord } from '@beetle/contracts/api';

function value<T>(result: ApiClientResult<T>): T {
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
  let record = value(await api.createInput({ params, body: { scope, requestId: randomUUID(), name: 'Input smoke',
    sha256, bytes: bytes.length } }));
  const key = { ...params, inputId: record.id };
  const url = `${origin}/api/v2/organizations/${organization.id}/workspaces/${workspace.id}/inputs/${record.id}`;
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    const response = await fetch(`${url}/chunks?offset=${offset}`, { method: 'PUT',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: bytes.subarray(offset, Math.min(bytes.length, offset + 65_536)), signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); record = await response.json() as InputRecord;
    assert.equal(record.offset, Math.min(bytes.length, offset + 65_536));
  }
  value(await api.sealInput({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: record.version } }));
  record = value(await api.getInput({ params: key })); assert.equal(record.state, 'published');
  const downloaded = await fetch(`${url}/content`, { headers, signal: AbortSignal.timeout(3000) });
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('content-length'), null);
  assert.equal(downloaded.headers.get('transfer-encoding'), 'chunked');
  // arrayBuffer resolves only after successful message termination, not expected-byte arrival.
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  value(await api.deleteInput({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: record.version } }));
  assert.equal(value(await api.getInput({ params: key })).state, 'deleted');
}
