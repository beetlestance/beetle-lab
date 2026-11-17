import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createInputTransferClient } from '@beetle/contracts/api';
import { automaticSession } from '../compose/public.js';
import { value } from '../public-api.js';
import type { Fixture } from '../compose/fixture.js';
import type { setup } from './fixture.js';
import { fill, prefix, absent } from './fill.js';
import { deleteUnderFull } from './deletion.js';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function inputCase(
  f: Fixture,
  configured: ReturnType<typeof setup>,
  checkpoint: (part: unknown) => void,
  restart: () => void,
) {
  const client = await automaticSession(f.origin);
  assert.deepEqual(value(await client.api.getBrowserSession()), client.session);
  const api = client.api;
  const transfers = createInputTransferClient({
    baseUrl: f.origin,
    fetch: client.transport,
    headers: { 'X-Beetle-CSRF': client.session.csrfToken },
  });
  const evidence: Record<string, unknown> = {};
  try {
    const { params, scope } = await diskWorkspace(api);
    const bytes = new Uint8Array(32768).fill(0x62);
    let record = value(
      await api.createInput({
        params,
        body: { scope, requestId: randomUUID(), name: 'Finite disk input', bytes: bytes.length, sha256: sha(bytes) },
      }),
    );
    const key = { ...params, inputId: record.id };
    const first = await transfers.append({ record, offset: 0, chunk: bytes.subarray(0, 16384) });
    assert(first.ok);
    record = first.value;
    assert.equal(record.offset, 16384);
    evidence.prefixBefore = prefix(f, configured, record);
    evidence.full = fill(f, configured, 'fill');
    const rejected = await transfers.append({ record, offset: record.offset, chunk: bytes.subarray(16384) });
    assert(!rejected.ok && rejected.issued && rejected.error.kind === 'protocol' && rejected.error.status === 503);
    assert(rejected.error.protocol);
    assert(['capacity_unavailable', 'storage_unavailable'].includes(rejected.error.protocol.code));
    evidence.refusal = { status: rejected.error.status, code: rejected.error.protocol.code };
    const unchanged = value(await api.getInput({ params: key }));
    assert.equal(unchanged.state, 'staging');
    assert.equal(unchanged.offset, record.offset);
    evidence.prefixAfter = prefix(f, configured, record);
    assert.deepEqual(evidence.prefixAfter, evidence.prefixBefore);
    evidence.free = fill(f, configured, 'free');
    const resumed = await transfers.append({
      record: unchanged,
      offset: unchanged.offset,
      chunk: bytes.subarray(16384),
    });
    assert(resumed.ok);
    record = resumed.value;
    assert.equal(record.offset, bytes.length);
    value(
      await api.sealInput({ params: key, body: { scope, requestId: randomUUID(), expectedVersion: record.version } }),
    );
    record = value(await api.getInput({ params: key }));
    assert.equal(record.state, 'published');
    const downloaded = await transfers.download({ record });
    assert(downloaded.ok);
    assert.deepEqual(new Uint8Array(downloaded.value), bytes);
    evidence.download = { bytes: bytes.length, sha256: sha(downloaded.value) };
    evidence.deletion = await deleteUnderFull(client, record, {
      fill: (action) => fill(f, configured, action),
      restart,
    });
    evidence.filesAbsent = absent(f, configured, record);
    evidence.deleted = true;
    return evidence;
  } finally {
    await transfers.close();
    checkpoint(evidence);
  }
}

async function diskWorkspace(api: Awaited<ReturnType<typeof automaticSession>>['api']) {
  const org = value(
    await api.createOrganization({
      body: { scope: { kind: 'installation' }, requestId: randomUUID(), name: 'Bounded disk', slug: 'bounded-disk' },
    }),
  );
  const workspace = value(
    await api.createWorkspace({
      params: { organizationId: org.id },
      body: {
        scope: { kind: 'organization', organizationId: org.id },
        requestId: randomUUID(),
        name: 'Synthetic disk',
      },
    }),
  );
  const params = { organizationId: org.id, workspaceId: workspace.id };
  const scope = { kind: 'workspace' as const, ...params };

  return { params, scope };
}
