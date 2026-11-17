import { expect, it } from 'vitest';
import type { InputRecord } from '../../src/ports/inputs.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { createInput, inputOptions, transition, trustedPublish } from './inputs-fixture.js';
import { storageFixture, seed, scope, uuid } from './fixture.js';
import { append, createSuite, request } from './suites-fixture.js';

const fixture = storageFixture();
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
async function pinned(metadata: Metadata, input: InputRecord, suiteId: number, revisions: number[]) {
  let suite = await createSuite(metadata, suiteId);
  for (const id of revisions) {
    const body = request(suite.version);
    body.config.datasets = [
      { id: 'data', kind: 'json', selection: 'byVu', input: { id: input.id, sha256: input.sha256, bytes: input.bytes } },
    ];
    await append(metadata, suite, id, body);
    suite = await metadata.suites.getSuite({ scope, id: suite.id });
  }
}

it('records creation and publication times once, and exact shapes only for the published bytes', async () => {
  const metadata = await fixture.open(fixture.path(), inputOptions());
  await seed(metadata);
  const created = (await metadata.inputs.control(createInput())) as InputRecord;
  expect(created).toMatchObject({ publishedAt: null, rowCount: null, columnCount: null, usedByCount: 0 });
  expect(created.createdAt).toMatch(timestamp);
  const key = { scope, id: created.id };
  const shape = { key, sha256: created.sha256, bytes: created.bytes, rowCount: 3, columnCount: 2 };
  await expect(metadata.inputs.recordShape(shape)).rejects.toMatchObject({ code: 'conflict' });
  const published = await trustedPublish(metadata, created);
  expect(published.createdAt).toBe(created.createdAt);
  expect(published.publishedAt).toMatch(timestamp);
  await expect(metadata.inputs.recordShape({ ...shape, sha256: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.inputs.recordShape({ ...shape, bytes: 13 })).rejects.toMatchObject({ code: 'conflict' });
  const measured = await metadata.inputs.recordShape(shape);
  expect(measured).toMatchObject({ rowCount: 3, columnCount: 2, version: published.version, publishedAt: published.publishedAt });
  await expect(metadata.inputs.recordShape({ ...shape, rowCount: 4 })).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.inputs.recordShape({ ...shape, rowCount: null, columnCount: null })).rejects.toMatchObject({
    code: 'invalid_input',
  });
  expect((await metadata.inputs.list({ scope, limit: 10 })).items[0]).toEqual(measured);
  await fixture.close(metadata);
});

it('pages exact usage by revision, flags current revisions and names delete blockers', async () => {
  const metadata = await fixture.open(fixture.path(), inputOptions());
  await seed(metadata);
  const input = await trustedPublish(metadata, (await metadata.inputs.control(createInput())) as InputRecord);
  const unused = await trustedPublish(metadata, (await metadata.inputs.control(createInput(91))) as InputRecord);
  await pinned(metadata, input, 50, [60, 61]);
  await pinned(metadata, input, 51, [62]);
  const key = { scope, id: input.id };
  expect(await metadata.inputs.get(key)).toMatchObject({ usedByCount: 3 });
  const first = await metadata.inputs.usage({ key, limit: 2 });
  expect(first).toMatchObject({ total: 3, items: [
    { suiteId: uuid(50), suiteName: 'Suite 50', revisionId: uuid(60), ordinal: 1, current: false },
    { suiteId: uuid(50), revisionId: uuid(61), ordinal: 2, current: true },
  ] });
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await metadata.inputs.usage({ key, limit: 2, cursor: first.nextCursor! });
  expect(second).toEqual({ total: 3, nextCursor: null, items: [
    { suiteId: uuid(51), suiteName: 'Suite 51', revisionId: uuid(62), ordinal: 1, current: true },
  ] });
  await expect(metadata.inputs.usage({ key, limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.usage({ key: { ...key, id: unused.id }, limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({
    code: 'invalid_input',
  });
  await expect(metadata.inputs.usage({ key, limit: 2, cursor: 'not-a-cursor' })).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await metadata.inputs.usage({ key: { ...key, id: unused.id }, limit: 2 })).toEqual({ total: 0, items: [], nextCursor: null });
  await expect(metadata.inputs.usage({ key: { ...key, id: uuid(99) }, limit: 2 })).rejects.toMatchObject({ code: 'not_found' });
  const foreign = { ...scope, workspaceId: uuid(98) };
  await expect(metadata.inputs.usage({ key: { scope: foreign, id: input.id }, limit: 2 })).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.inputs.control(transition(input, 'deleteInput'))).rejects.toMatchObject({ code: 'protected_dependency' });
  expect(await metadata.inputs.control(transition(unused, 'deleteInput'))).toMatchObject({ operation: 'delete' });
  await fixture.close(metadata);
});
