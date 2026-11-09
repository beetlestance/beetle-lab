// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import type { InputRecord } from '@beetle/contracts/api';
import { deferred, file, fixture, input, json, receipt, settled } from './test-fixtures.js';

it.each([0, 150000])('publishes %i bytes using one preparation and sequential bounded chunks', async size => {
  let record = input({ bytes: size });
  const test = fixture(request => {
    if (request.path.endsWith('/seal')) { record = { ...record, state: 'published', offset: size }; return receipt(request.body); }
    return json(record, request.method === 'POST' ? 201 : 200);
  }, new Uint8Array(size));
  test.transfer.append.mockImplementation(async ({ record: prior, chunk }) => {
    record = { ...prior, offset: prior.offset + chunk.length, version: prior.version + 1 };
    return { ok: true, value: record };
  });
  test.owner.start(file(size), ' Dataset ', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('complete');
  expect(test.transfer.prepare).toHaveBeenCalledTimes(1);
  expect(test.transfer.append.mock.calls.map(([request]) => request.chunk.length)).toEqual(size ? [65536, 65536, 18928] : []);
  expect(test.api.records.map(request => request.method)).toEqual(['POST', 'GET', 'POST', 'GET']);
});

it('replays unknown create with its original body and always reads current status before Resume', async () => {
  let creates = 0;
  const test = fixture(request => {
    if (request.method === 'POST') {
      if (++creates === 1) throw new Error('secret synthetic failure');
      return json(input(), 201);
    }
    return json(input({ offset: 2, version: 2 }));
  });
  test.owner.start(file(), 'Dataset', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('replay-create');
  expect(test.owner.state.message).not.toContain('secret');
  const original = test.api.records[0]!.body;
  await test.owner.run('replay-create');
  expect(test.api.records[1]!.body).toEqual(original);
  expect(test.api.records[2]!.method).toBe('GET');
  expect(test.owner.state.phase).toBe('resume');
  expect(test.transfer.append).not.toHaveBeenCalled();
  expect(test.transfer.prepare).toHaveBeenCalledTimes(1);
  test.owner.start(file(), 'Different', input().folderId);
  expect(test.api.records).toHaveLength(3);
});

it('requires explicit fresh status after an issued failed chunk and resumes its exact committed prefix', async () => {
  let reads = 0;
  const test = fixture(request => {
    if (request.path.endsWith('/seal')) return receipt(request.body);
    if (request.method === 'POST') return json(input(), 201);
    return json(input({ offset: ++reads > 1 ? 2 : 0, version: reads > 1 ? 2 : 1 }));
  });
  test.transfer.append.mockResolvedValueOnce({ ok: false, issued: true, error: { kind: 'transport' } });
  test.owner.start(file(), 'Dataset', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('refresh');
  await test.owner.run('resume');
  expect(test.transfer.append).toHaveBeenCalledTimes(1);
  await test.owner.run('refresh');
  expect(test.owner.state.phase).toBe('resume');
  expect(test.transfer.append).toHaveBeenCalledTimes(1);
  await test.owner.run('resume');
  expect(test.transfer.append.mock.calls[1]![0].offset).toBe(2);
  expect([...test.transfer.append.mock.calls[1]![0].chunk]).toEqual([3]);
});

it('retains one seal identity through unknown outcome and status refresh, then waits for publication', async () => {
  let sealCalls = 0;
  let state: InputRecord['state'] = 'staging';
  const test = fixture(request => {
    if (request.path.endsWith('/seal')) {
      if (++sealCalls === 1) throw new Error('Synthetic response loss');
      state = 'publishing';
      return receipt(request.body);
    }
    return json(input({ state, offset: state === 'staging' ? 0 : 3 }), request.method === 'POST' ? 201 : 200);
  });
  test.owner.start(file(), 'Dataset', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('replay-seal');
  const original = test.api.records.find(request => request.path.endsWith('/seal'))!.body;
  await test.owner.run('refresh');
  expect(test.owner.state.phase).toBe('replay-seal');
  await test.owner.run('replay-seal');
  expect(test.api.records.filter(request => request.path.endsWith('/seal')).map(request => request.body)).toEqual([original, original]);
  expect(test.owner.state.phase).toBe('publishing');
  state = 'published';
  await test.owner.run('refresh');
  expect(test.owner.state.phase).toBe('complete');
});

it.each(['name', 'folderId', 'sha256', 'bytes', 'id'] as const)('stops before bytes if authoritative %s changes', async field => {
  const wrong = field === 'bytes' ? 4 : field === 'id' || field === 'folderId'
    ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : field === 'sha256' ? 'b'.repeat(64) : 'Other';
  const test = fixture(request => json(request.method === 'POST' ? input() : input({ [field]: wrong }), request.method === 'POST' ? 201 : 200));
  test.owner.start(file(), 'Dataset', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toMatch(/stopped|refresh/);
  expect(test.transfer.append).not.toHaveBeenCalled();
  expect(test.api.records.filter(request => request.method === 'POST')).toHaveLength(1);
});

it('cancel stops dependent work and double submission cannot replace the original intent', async () => {
  const pending = deferred<Response>();
  const test = fixture(() => pending.promise);
  test.owner.start(file(), 'Dataset', input().folderId);
  await vi.waitFor(() => expect(test.api.records).toHaveLength(1));
  test.owner.start(file(), 'Other', input().folderId);
  test.owner.cancel();
  expect(test.api.records[0]!.signal?.aborted).toBe(true);
  pending.resolve(json(input(), 201));
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('replay-create');
  expect(test.api.records).toHaveLength(1);
  expect(test.transfer.append).not.toHaveBeenCalled();
  test.owner.discard();
  expect(test.owner.state.retained).toBe(false);
  expect(test.owner.state.message).toContain('no backend data was deleted');
  expect(test.api.records).toHaveLength(1);
});

it('departure fences a held preparation and never closes the shared client', async () => {
  const pending = deferred<Awaited<ReturnType<ReturnType<typeof fixture>['transfer']['prepare']>>>();
  const test = fixture(() => json(input(), 201));
  test.transfer.prepare.mockReturnValue(pending.promise);
  test.owner.start(file(), 'Dataset', input().folderId);
  test.owner.dispose();
  const calls = test.changed.mock.calls.length;
  pending.resolve({ ok: true, value: { sha256: 'a'.repeat(64), content: new Uint8Array(3) } });
  await Promise.resolve();
  await Promise.resolve();
  expect(test.changed).toHaveBeenCalledTimes(calls);
  expect(test.api.records).toHaveLength(0);
  expect(test.invalidate).not.toHaveBeenCalled();
  expect(test.transfer.close).not.toHaveBeenCalled();
});

it.each(['failed', 'deleting', 'deleted'] as const)('stops on authoritative %s without compensation or recreation', async state => {
  const test = fixture(request => json(request.method === 'POST' ? input()
    : input({ state, reason: state === 'failed' ? 'io' : null }), request.method === 'POST' ? 201 : 200));
  test.owner.start(file(), 'Dataset', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('stopped');
  expect(test.owner.state.record?.state).toBe(state);
  expect(test.transfer.append).not.toHaveBeenCalled();
  test.owner.discard();
  expect(test.api.records.map(request => request.method)).toEqual(['POST', 'GET']);
});

it('retains preparation failure for explicit retry with the original frozen metadata', async () => {
  const test = fixture(request => json(input(), request.method === 'POST' ? 201 : 200));
  test.transfer.prepare.mockResolvedValueOnce({ ok: false, issued: false, error: { kind: 'busy' } });
  test.owner.start(file(), ' Dataset ', input().folderId);
  await settled(test.owner);
  expect(test.owner.state.phase).toBe('prepare');
  expect(test.api.records).toHaveLength(0);
  await test.owner.run('prepare');
  expect(test.transfer.prepare).toHaveBeenCalledTimes(2);
  expect(test.api.records[0]!.body?.name).toBe('Dataset');
});
