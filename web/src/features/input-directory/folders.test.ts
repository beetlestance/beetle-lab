// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {folder, testClient} from '../input-upload/test-fixtures.js';
import {DirectoryFolders} from './folders.js';
import {deferred, directoryFixture, ids, json, root, workspace} from './test-fixtures.js';

it('reuses exact existing spelling but refuses a folded alias without any writes', async () => {
  const test = directoryFixture(); test.folders.push({...folder(), name: 'Tree', displayPath: ['Tree']});
  const folders = new DirectoryFolders(test.api.client, workspace(), ids.root, () => {});
  await folders.initialize(1, new AbortController().signal);
  await expect(folders.resolve(['tree'], new AbortController().signal)).rejects.toThrow(/spelling/);
  expect(await folders.resolve(['Tree'], new AbortController().signal)).toBe(ids.folder);
  expect(test.api.records.filter(row => row.method === 'POST')).toHaveLength(0);
});
it('refuses missing destination, excessive combined depth and wrong workspace inventory before writes', async () => {
  const test = directoryFixture(); test.folders.push({...folder(), displayPath: ['Tree']});
  for (const [destination, depth] of [[ids.parent, 1], [ids.folder, 8]] as const) {
    const folders = new DirectoryFolders(test.api.client, workspace(), destination, () => {});
    await expect(folders.initialize(depth, new AbortController().signal)).rejects.toThrow();
  }
  const wrong = testClient(() => json({scope: {...root().scope, organizationId: ids.b}, items: [], nextCursor: null}));
  await expect(new DirectoryFolders(wrong.client, workspace(), ids.root, () => {}).initialize(1, new AbortController().signal)).rejects.toThrow(/could not be confirmed/);
  expect(test.api.records.every(row => row.method === 'GET')).toBe(true);
});
it('stops discovery at twenty pages and sends no folder creates', async () => {
  let n = 0;
  const api = testClient(() => json({scope: root().scope, items: [], nextCursor: 'page-' + ++n}));
  const folders = new DirectoryFolders(api.client, workspace(), ids.root, () => {});
  await expect(folders.initialize(1, new AbortController().signal)).rejects.toThrow(/2000/);
  expect(api.records).toHaveLength(20); expect(api.records.every(row => row.method === 'GET')).toBe(true);
});
it('fences a late folder response on cancellation and replays the exact original create', async () => {
  const pending = deferred<Response>(); let held = true;
  const test = directoryFixture(request => request.path.endsWith('/folders') && held ? pending.promise : undefined);
  const folders = new DirectoryFolders(test.api.client, workspace(), ids.root, () => {});
  const controller = new AbortController(); await folders.initialize(2, controller.signal);
  const resolving = folders.resolve(['tree', 'nested'], controller.signal);
  await vi.waitFor(() => expect(test.api.records.filter(row => row.method === 'POST')).toHaveLength(1));
  const body = test.api.records.at(-1)!.body; controller.abort();
  pending.resolve(json({...folder(), name: 'tree', displayPath: ['tree']}, 201));
  await expect(resolving).rejects.toThrow(/cancelled/);
  expect(test.api.records.filter(row => row.method === 'POST')).toHaveLength(1);
  held = false; await folders.resolve(['tree', 'nested'], new AbortController().signal);
  expect(test.api.records.filter(row => row.method === 'POST')[1]!.body).toEqual(body);
});
