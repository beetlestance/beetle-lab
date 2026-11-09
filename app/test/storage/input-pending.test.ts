import { expect, it } from 'vitest';
import type { InputRecord } from '../../src/ports/inputs.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { storageFixture, seed, scope, uuid } from './fixture.js';
import { createInput, inputOptions, transition, trustedPublish } from './inputs-fixture.js';

const fixture = storageFixture();
/** Metadata-only state selection fixtures; no filesystem availability is claimed. */
async function create(metadata: Metadata, id: number, owner = scope): Promise<InputRecord> {
  return await metadata.inputs.control(createInput(id, 0, owner)) as InputRecord;
}

it('selects pending custody across organisations without walking published/staging/failed rows', async () => {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  for (let id = 2000; id < 2101; id++) await trustedPublish(metadata, await create(metadata, id));
  await create(metadata, 2200);
  const failed = await create(metadata, 2201);
  await metadata.inputs.advance({ kind: 'failInput', key: { scope, id: failed.id }, expectedVersion: failed.version, reason: 'integrity' });
  const deletion = await create(metadata, 3000); await metadata.inputs.control(transition(deletion, 'deleteInput'));
  const other = await create(metadata, 3001, foreign); await metadata.inputs.control(transition(other, 'sealInput'));
  const local = await create(metadata, 3002); await metadata.inputs.control(transition(local, 'sealInput'));
  const before = await metadata.inputs.storage();
  const full = await metadata.inputs.recovery({ limit: 100 });
  expect(full.items).toHaveLength(100); expect(full.items.some(row => row.state === 'publishing')).toBe(false);
  const first = await metadata.inputs.recovery({ limit: 2, mode: 'pending' });
  expect(first.items.map(row => [row.id, row.state])).toEqual([[uuid(3000), 'deleting'], [uuid(3002), 'publishing']]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const tail = await metadata.inputs.recovery({ limit: 2, mode: 'pending', cursor: first.nextCursor! });
  expect(tail.items.map(row => [row.id, row.scope])).toEqual([[uuid(3001), foreign]]); expect(tail.nextCursor).toBeNull();
  expect(await metadata.inputs.storage()).toEqual(before);
  expect((await metadata.inputs.get({ scope, id: uuid(2000) })).state).toBe('published');
});

it('binds cursor mode/limit/state and rejects new flags on workspace list queries', async () => {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata);
  for (const id of [90, 91]) {
    const input = await create(metadata, id); await metadata.inputs.control(transition(input, 'sealInput'));
  }
  const pending = await metadata.inputs.recovery({ limit: 1, mode: 'pending' });
  const full = await metadata.inputs.recovery({ limit: 1 });
  expect(pending.nextCursor).toEqual(expect.any(String)); expect(full.nextCursor).toEqual(expect.any(String));
  for (const query of [{ limit: 1, cursor: pending.nextCursor! }, { limit: 1, mode: 'pending', cursor: full.nextCursor! },
    { limit: 2, mode: 'pending', cursor: pending.nextCursor! }, { limit: 1, mode: 'all' },
    { limit: 1, mode: true }, { limit: 1, mode: 'pending', scope }]) {
    await expect(metadata.inputs.recovery(query as never)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const cursor = JSON.parse(Buffer.from(pending.nextCursor!, 'base64url').toString('utf8')) as { after: string[] };
  cursor.after[0] = 'published';
  await expect(metadata.inputs.recovery({ limit: 1, mode: 'pending', cursor: Buffer.from(JSON.stringify(cursor)).toString('base64url') }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.list({ scope, limit: 1, mode: 'pending' } as never)).rejects.toMatchObject({ code: 'invalid_input' });
});
