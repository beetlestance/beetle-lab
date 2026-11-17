import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createInputTransferClient } from '@beetle/contracts/api';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { automaticSession } from '../compose/public.js';
import { value, pause } from '../public-api.js';
import { contents } from './config.js';
export async function inputs(
  client: Awaited<ReturnType<typeof automaticSession>>,
  origin: string,
  scope: WorkspaceScope,
) {
  const transfer = createInputTransferClient({
    baseUrl: origin,
    fetch: client.transport,
    headers: { 'X-Beetle-CSRF': client.session.csrfToken },
  });
  const publish = async (name: keyof typeof contents) => {
    const bytes = new TextEncoder().encode(contents[name]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
    let record = value(
      await client.api.createInput({
        params,
        body: { scope, requestId: randomUUID(), name: name + '.txt', bytes: bytes.length, sha256 },
      }),
    );
    const append = await transfer.append({ record, offset: 0, chunk: bytes });
    assert(append.ok);
    record = append.value;
    const key = { ...params, inputId: record.id };
    value(
      await client.api.sealInput({
        params: key,
        body: { scope, requestId: randomUUID(), expectedVersion: record.version },
      }),
    );
    for (let n = 0; n < 40; n++) {
      record = value(await client.api.getInput({ params: key }));
      if (record.state === 'published') break;
      assert.equal(record.state, 'publishing');
      await pause();
    }
    assert.equal(record.state, 'published');
    assert.equal(record.sha256, sha256);
    return { id: record.id, sha256, bytes: bytes.length };
  };
  try {
    return { json: await publish('json'), csv: await publish('csv'), body: await publish('body') };
  } finally {
    await transfer.close();
  }
}
