// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {planDirectory} from './plan.js';
import {apiError, deferred, directoryFixture, ids, json, selected} from './test-fixtures.js';

it('preserves nested directories, confirms publication and prepares only one file at once', async () => {
  const test = directoryFixture();
  const pending = deferred<Awaited<ReturnType<typeof test.transfer.prepare>>>();
  test.transfer.prepare.mockReturnValueOnce(pending.promise);
  const running = test.owner.start(planDirectory([selected('tree/a'), selected('tree/nested/b')]), ids.root);
  await vi.waitFor(() => expect(test.transfer.prepare).toHaveBeenCalledTimes(1));
  expect(test.inputs.size).toBe(0); expect(test.folders.map(row => row.name)).toEqual(['Root', 'tree']);
  pending.resolve({ok: true, value: {sha256: 'a'.repeat(64), content: new Uint8Array(3)}}); await running;
  expect(test.owner.state.complete).toBe(true);
  expect(test.owner.state.rows.map(row => row.status)).toEqual(['published', 'published']);
  expect(test.folders.map(row => row.name)).toEqual(['Root', 'tree', 'nested']);
  expect([...test.inputs.values()].map(row => row.folderId)).toEqual(test.folders.slice(1).map(row => row.id));
  expect(test.transfer.prepare).toHaveBeenCalledTimes(2);
});
it('freezes an unknown folder-create intent and never starts files before explicit retry', async () => {
  let attempts = 0;
  const test = directoryFixture(request => {if (request.path.endsWith('/folders') && ++attempts === 1) throw new Error('private raw failure');});
  await test.owner.start(planDirectory([selected('tree/a')]), ids.root);
  expect(test.owner.state.message).not.toContain('private'); expect(test.transfer.prepare).not.toHaveBeenCalled();
  const original = test.api.records.find(row => row.method === 'POST')!.body;
  await test.owner.run();
  expect(test.api.records.filter(row => row.path.endsWith('/folders')).map(row => row.body)).toEqual([original, original]);
  expect(test.owner.state.complete).toBe(true);
});
it('pauses on file conflict, keeps existing input intact, and requires explicit skip', async () => {
  let creates = 0;
  const test = directoryFixture(request => {if (request.path.endsWith('/inputs') && ++creates === 1) return json(apiError('conflict'), 409);});
  await test.owner.start(planDirectory([selected('tree/a'), selected('tree/b')]), ids.root);
  expect(test.owner.state.current?.phase).toBe('stopped'); expect(test.transfer.prepare).toHaveBeenCalledTimes(1);
  expect(test.api.records.filter(row => row.method === 'DELETE')).toHaveLength(0);
  await test.owner.skip();
  expect(test.owner.state.rows.map(row => row.status)).toEqual(['skipped', 'published']);
  expect(test.owner.state.complete).toBe(true);
});
it('does not auto-resume after an issued chunk loses its response', async () => {
  const test = directoryFixture();
  test.transfer.append.mockResolvedValueOnce({ok: false, issued: true, error: {kind: 'transport'}});
  await test.owner.start(planDirectory([selected('tree/a'), selected('tree/b')]), ids.root);
  expect(test.owner.state.current?.phase).toBe('refresh');
  await test.owner.run('resume'); expect(test.transfer.append).toHaveBeenCalledTimes(1);
  await test.owner.run('refresh'); expect(test.transfer.prepare).toHaveBeenCalledTimes(1);
  await test.owner.run('resume'); expect(test.owner.state.complete).toBe(true);
});
it.each(['cancel', 'dispose'] as const)('fences a held preparation on %s and never starts a later file', async action => {
  const test = directoryFixture(); const pending = deferred<Awaited<ReturnType<typeof test.transfer.prepare>>>();
  test.transfer.prepare.mockReturnValueOnce(pending.promise);
  const running = test.owner.start(planDirectory([selected('tree/a'), selected('tree/b')]), ids.root);
  await vi.waitFor(() => expect(test.transfer.prepare).toHaveBeenCalledTimes(1));
  test.owner[action](); const calls = test.changed.mock.calls.length;
  pending.resolve({ok: true, value: {sha256: 'a'.repeat(64), content: new Uint8Array(3)}}); await running;
  expect(test.inputs.size).toBe(0); expect(test.transfer.prepare).toHaveBeenCalledTimes(1);
  if (action === 'dispose') expect(test.changed).toHaveBeenCalledTimes(calls);
  expect(test.transfer.close).not.toHaveBeenCalled();
});

it('replays a committed folder create after reply loss without creating a second folder', async () => {
  let replies = 0;
  const test = directoryFixture(undefined, (_request, response) => {if (++replies === 1) throw new Error('Lost committed reply'); return response;});
  await test.owner.start(planDirectory([selected('tree/a')]), ids.root);
  expect(test.folders.map(row => row.name)).toEqual(['Root', 'tree']);
  expect(test.transfer.prepare).not.toHaveBeenCalled();
  const original = test.api.records.at(-1)!.body;
  await test.owner.run();
  expect(test.api.records.filter(row => row.path.endsWith('/folders')).map(row => row.body)).toEqual([original, original]);
  expect(test.folders).toHaveLength(2); expect(test.owner.state.complete).toBe(true);
});
it.each(['cancel', 'dispose'] as const)('fences a committed held folder reply on %s', async action => {
  const pending = deferred<Response>();
  const test = directoryFixture(undefined, () => pending.promise);
  const running = test.owner.start(planDirectory([selected('tree/a'), selected('tree/b')]), ids.root);
  await vi.waitFor(() => expect(test.folders).toHaveLength(2));
  test.owner[action](); const calls = test.changed.mock.calls.length;
  pending.resolve(json(test.folders[1], 201)); await running;
  expect(test.transfer.prepare).not.toHaveBeenCalled(); expect(test.inputs.size).toBe(0);
  if (action === 'dispose') expect(test.changed).toHaveBeenCalledTimes(calls);
});
