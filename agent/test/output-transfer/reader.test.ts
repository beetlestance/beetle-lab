import { executionArtifacts } from '@beetle/contracts';
import { expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { sealEngineResult } from '@beetle/contracts';
import type { Scope } from '../../src/admission/index.js';
import { JournalError } from '../../src/journal/index.js';
import { prepareOutputSource, receiptForOutputSource } from '../../src/output-source/index.js';
import { deliveryFixture, hash } from '../output-delivery/fixtures.js';
import { now, reserved, scope } from '../admission/fixtures.js';
import { deferred, operation, ranges, reader, releases, request, track, turns, until } from './fixtures.js';

const f = deliveryFixture();
async function ready() {
  const e = await f.ready(); const closure = await e.journal.closeOutputDelivery(e.receipt);
  return { ...e, closure, artifact: executionArtifacts(e.source.manifest.result)[0]! };
}

it('returns the actual durable public source/closure across Journal reopen, without private facts or native calls', async () => {
  const e = await ready(); await f.close(e.journal); const journal = await f.open(e.path); const r = reader(journal);
  const value = await track(r.service.source(e.key, operation()));
  expect(value).toEqual({ version: 1, manifest: e.source.manifest, sourceDigest: e.receipt.sourceDigest, closure: e.closure });
  expect(Object.isFrozen(executionArtifacts(value.manifest.result))).toBe(true); expect(Object.isFrozen(value.closure.receipt.key)).toBe(true);
  expect(r.readRange).not.toHaveBeenCalled();
  const json = encodeJson(value, 75_776);
  for (const privateField of ['directory', 'checkpoint', 'release', 'createToken', 'runtimeId', 'modifiedNs']) expect(json).not.toContain(`"${privateField}"`);
  expect(await journal.readOutputDelivery(e.key)).toEqual(e.closure); expect(await journal.readOutputSource(e.key)).toEqual(e.source);
});

it('sends exact stored root/declaration and fresh budget to the injected native owner for every range and EOF', async () => {
  const e = await ready(); const r = reader(e.journal);
  for (const [offset, length] of [[0, 20], [20, 20], [32, 20]] as const) {
    const value = await track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId, offset, length), operation()));
    const expected = Buffer.from(Array.from({ length: Math.min(length, 32 - offset) }, (_, index) => offset + index));
    expect(Buffer.from(value.base64, 'base64')).toEqual(expected); expect(value.nextOffset).toBe(offset + expected.length);
    expect(value.eof).toBe(value.nextOffset === 32); expect(value.totalBytes).toBe(32); expect(Object.isFrozen(value)).toBe(true);
  }
  const empty = executionArtifacts(e.source.manifest.result)[1]!;
  const value = await track(r.service.chunk(e.key, request(e.receipt, empty.artifactId), operation()));
  expect(value).toMatchObject({ base64: '', eof: true, nextOffset: 0, totalBytes: 0 });
  expect(r.originals).toHaveLength(4);
  for (const work of r.originals) {
    expect(work.options.root).toEqual(e.source.root); expect(Object.isFrozen(work.options.root)).toBe(true);
    expect(work.options.artifact).toEqual(executionArtifacts(e.source.manifest.result).find(artifact => artifact.artifactId === work.options.artifact.artifactId));
    expect(work.options.deadline).toBe(1000); expect(work.options.signal).toBeInstanceOf(AbortSignal); expect(work.close).toHaveBeenCalledTimes(1);
  }
});

it.each(['source', 'closure'] as const)('withholds a positive reply when durable %s is absent', async absent => {
  const e = absent === 'source' ? await f.seed() : await f.ready();
  const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'pending' });
  expect(r.readRange).not.toHaveBeenCalled(); expect(await e.journal.readOutputDelivery(e.key)).toBeNull();
});

it.each(['queued', 'released', 'rejected'] as const)('classifies actual source-less admission %s without fabricating output', async state => {
  const journal = await f.configured(); const job = f.job();
  if (state === 'rejected') await journal.cancelOriginal({ offer: job, now });
  else await f.enqueue(journal, job);
  const key = scope(job);
  if (state === 'released') { reserved(await f.admit(journal, job)); await journal.admission({ kind: 'abortUnstarted', key }); }
  expect((await journal.get(key)).admission?.state).toBe(state);
  const r = reader(journal);
  await expect(track(r.service.source(key, operation()))).rejects.toMatchObject({ code: state === 'queued' ? 'pending' : 'unavailable' });
  expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['exited', 'lost'] as const)('does not treat provisional %s snapshot state as source completion', async state => {
  const e = await f.seed(); const get = e.journal.get.bind(e.journal);
  vi.spyOn(e.journal, 'get').mockImplementation(async key => ({ ...await get(key), state }));
  await expect(track(reader(e.journal).service.source(e.key, operation()))).rejects.toMatchObject({ code: 'pending' });
});

it('retains actual Journal not_found taxonomy for a missing original', async () => {
  const journal = await f.configured(); const key = scope(f.job());
  await expect(track(reader(journal).service.source(key, operation()))).rejects.toBeInstanceOf(JournalError);
  await expect(track(reader(journal).service.source(key, operation()))).rejects.toMatchObject({ code: 'not_found' });
});

it.each(['queue_full', 'unavailable', 'conflict'] as const)('preserves Journal %s instead of inventing source-unavailable state', async code => {
  const e = await ready(); const error = new JournalError(code);
  vi.spyOn(e.journal, 'readOutputSource').mockRejectedValueOnce(error);
  await expect(track(reader(e.journal).service.source(e.key, operation()))).rejects.toBe(error);
});

it('rejects a source from another physical Journal before closure/range IO', async () => {
  const e = await ready(); vi.spyOn(e.journal, 'journalAuthority').mockResolvedValue('ffffffff-ffff-4fff-8fff-ffffffffffff');
  const closure = vi.spyOn(e.journal, 'readOutputDelivery'); const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'unavailable' });
  expect(closure).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['organizationId', 'workspaceId', 'attemptId', 'generation'] as const)('rejects a reply source mismatched to caller %s', async field => {
  const e = await ready(); const original = e.journal.readOutputSource.bind(e.journal);
  vi.spyOn(e.journal, 'readOutputSource').mockImplementation(() => original(e.key));
  const key = { ...e.key, [field]: field === 'generation' ? 2 : 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
  // Deliberately faulty durable-open reply isolates the independent source binding check.
  const journal = { retirements: { ...e.journal.retirements, isOpen: async () => true },
    readOutputSource: e.journal.readOutputSource.bind(e.journal), readOutputDelivery: e.journal.readOutputDelivery.bind(e.journal),
    get: e.journal.get.bind(e.journal), journalAuthority: e.journal.journalAuthority.bind(e.journal) };
  await expect(track(reader(journal).service.source(key, operation()))).rejects.toMatchObject({ code: field === 'generation' ? 'invalid_input' : 'unavailable' });
});

it.each(['journalAuthority', 'manifestDigest', 'sourceDigest', 'organizationId', 'workspaceId', 'attemptId', 'generation'] as const)(
  'rejects a held Journal closure reply with mismatched receipt %s', async field => {
    const e = await ready(); const read = e.journal.readOutputDelivery.bind(e.journal);
    vi.spyOn(e.journal, 'readOutputDelivery').mockImplementation(async key => {
      const value = structuredClone((await read(key))!);
      if (field === 'generation') Reflect.set(value.receipt.key, field, 2);
      else if (field === 'organizationId' || field === 'workspaceId' || field === 'attemptId') Reflect.set(value.receipt.key, field, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
      else Reflect.set(value.receipt, field, field === 'journalAuthority' ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : 'f'.repeat(64));
      return value;
    });
    const r = reader(e.journal); await expect(track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), operation()))).rejects.toMatchObject({ code: 'unavailable' });
    expect(r.readRange).not.toHaveBeenCalled();
  });

it.each(['manifestDigest', 'sourceDigest', 'artifactId'] as const)('rejects wrong %s selectors before native work', async field => {
  const e = await ready(); const input = request(e.receipt, e.artifact.artifactId);
  Reflect.set(input, field, field === 'artifactId' ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : 'f'.repeat(64));
  const r = reader(e.journal);
  await expect(track(r.service.chunk(e.key, input, operation()))).rejects.toMatchObject({ code: 'conflict' }); expect(r.readRange).not.toHaveBeenCalled();
});

it('rejects beyond-end ranges and malformed scopes/requests without issuing native work', async () => {
  const e = await ready(); const r = reader(e.journal);
  await expect(track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId, 33), operation()))).rejects.toMatchObject({ code: 'invalid_input' });
  for (const input of [{ ...request(e.receipt, e.artifact.artifactId), length: 0 }, { ...request(e.receipt, e.artifact.artifactId), offset: Number.MAX_SAFE_INTEGER + 1 }]) {
    await expect(track(r.service.chunk(e.key, input, operation()))).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const get = vi.fn(() => e.key.attemptId); const key = Object.defineProperty({ ...e.key }, 'attemptId', { get });
  await expect(track(r.service.source(key, operation()))).rejects.toMatchObject({ code: 'invalid_input' }); expect(get).not.toHaveBeenCalled();
  expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['exact duplicate', 'case aliases'] as const)('rejects %s declarations in a faulty Journal reply without first-match selection', async mode => {
  const e = await ready(); const draft = structuredClone(e.collected); const result=draft.collection.value;if ('purpose' in result) throw new Error('Expected performance fixture');const artifacts=result.artifacts;
  const id = mode === 'case aliases' ? 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' : artifacts[0]!.artifactId;
  artifacts[0]!.artifactId = id; artifacts[1]!.artifactId = mode === 'case aliases' ? id.toLowerCase() : id;
  const { seal, ...body } = draft.collection.value; const sealed = sealEngineResult(body, seal.sealedAt, hash);
  if (!sealed.ok) throw new Error('Malformed controlled source fixture');
  draft.collection.value = structuredClone(sealed.value);
  const faultySource = prepareOutputSource(draft, hash); const faultyReceipt = receiptForOutputSource(faultySource, hash);
  const originalSource = e.journal.readOutputSource.bind(e.journal); const originalClosure = e.journal.readOutputDelivery.bind(e.journal);
  vi.spyOn(e.journal, 'readOutputSource').mockImplementation(async key => { await originalSource(key); return faultySource; });
  vi.spyOn(e.journal, 'readOutputDelivery').mockImplementation(async key => ({ ...(await originalClosure(key))!, receipt: faultyReceipt }));
  const r = reader(e.journal);
  await expect(track(r.service.chunk(e.key, request(faultyReceipt, id), operation()))).rejects.toMatchObject({ code: 'conflict' });
  expect(r.readRange).not.toHaveBeenCalled(); expect(await originalSource(e.key)).toEqual(e.source);
});

it('captures keys, chunk selectors and known deadline data before a held Journal await', async () => {
  const e = await ready(); const held = deferred<string>(); releases.push(() => held.resolve(e.receipt.journalAuthority));
  vi.spyOn(e.journal, 'journalAuthority').mockReturnValue(held.promise);
  const key = { ...e.key }; const input = request(e.receipt, e.artifact.artifactId); const op = { deadline: 1000 };
  const r = reader(e.journal); const pending = track(r.service.chunk(key, input, op));
  key.attemptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; input.offset = 32; input.sourceDigest = 'f'.repeat(64); op.deadline = 99;
  held.resolve(e.receipt.journalAuthority); const result = await pending;
  expect(result.offset).toBe(0); expect(result.sourceDigest).toBe(e.receipt.sourceDigest);
  expect(r.originals[0]!.options.deadline).toBe(1000); expect(Buffer.from(result.base64, 'base64')).toHaveLength(32);
});

it('holds two processwide source slots through delayed actual Journal replies after cancellation', async () => {
  const e = await ready(); const source = e.journal.readOutputSource.bind(e.journal);
  const replies: ReturnType<typeof deferred<Awaited<ReturnType<typeof source>>>>[] = [];
  vi.spyOn(e.journal, 'readOutputSource').mockImplementation(async key => {
    const value = await source(key); const held = deferred<typeof value>(); replies.push(held); releases.push(() => held.resolve(value));
    return held.promise;
  });
  const abort = new AbortController(); const r = reader(e.journal);
  const calls = [track(r.service.source(e.key, { ...operation(), signal: abort.signal })),
    track(reader(e.journal).service.source(e.key, { ...operation(), signal: abort.signal }))];
  await until(() => replies.length === 2); abort.abort(); let settled = 0; for (const call of calls) void call.catch(() => { settled++; });
  await turns(); expect(settled).toBe(0);
  const observe = vi.fn(() => { throw new Error('must not capture'); }); const key = new Proxy({} as Scope, { ownKeys: observe });
  await expect(track(r.service.source(key, operation()))).rejects.toMatchObject({ code: 'busy' }); expect(observe).not.toHaveBeenCalled();
  for (const held of replies) held.resolve(e.source);
  for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'interrupted' });
  expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['abort', 'deadline'] as const)('retains two issued native originals and refuses before capture through %s and cleanup', async stop => {
  const e = await ready(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const native = ranges(false); const r = reader(e.journal, native); const abort = new AbortController();
  const calls = [track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), { ...operation(), signal: abort.signal })),
    track(reader(e.journal, native).service.chunk(e.key, request(e.receipt, e.artifact.artifactId), { ...operation(), signal: abort.signal }))];
  await until(() => native.originals.length === 2);
  if (stop === 'abort') abort.abort(); else await vi.advanceTimersByTimeAsync(901);
  const observed = vi.fn(() => { throw new Error('must not capture'); });
  const key = new Proxy({} as Scope, { ownKeys: observed }); const input = new Proxy({} as ReturnType<typeof request>, { ownKeys: observed });
  const op = Object.defineProperty({}, 'deadline', { get: observed }) as ReturnType<typeof operation>;
  await expect(track(r.service.source(key, op))).rejects.toMatchObject({ code: 'busy' });
  await expect(track(r.service.chunk(e.key, input, op))).rejects.toMatchObject({ code: 'busy' }); expect(observed).not.toHaveBeenCalled();
  for (const work of native.originals) {
    expect(work.options.signal?.aborted).toBe(true); work.result.resolve({ ok: false, reason: stop === 'abort' ? 'cancelled' : 'deadline' });
  }
  await until(() => native.originals.every(work => work.close.mock.calls.length === 1));
  for (const work of native.originals) work.quiet.resolve(); await turns();
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'busy' });
  for (const work of native.originals) work.closed.resolve();
  for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'interrupted' });
});

it.each(['quiet', 'close'] as const)('does not settle an early failed result while original %s remains held', async last => {
  const e = await ready(); const r = reader(e.journal, ranges(false)); const input = request(e.receipt, e.artifact.artifactId);
  const pending = track(r.service.chunk(e.key, input, operation())); await until(() => r.originals.length === 1); const work = r.originals[0]!;
  work.result.resolve({ ok: false, reason: 'missing' }); await until(() => work.close.mock.calls.length === 1);
  if (last === 'quiet') work.closed.resolve(); else work.quiet.resolve();
  let settled = false; void pending.catch(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  if (last === 'quiet') work.quiet.resolve(); else work.closed.resolve();
  await expect(pending).rejects.toMatchObject({ code: 'unavailable' }); expect(work.close).toHaveBeenCalledTimes(1);
});


it('snapshots bounded positive bytes before delayed native quiescence and cached close', async () => {
  const e = await ready(); const r = reader(e.journal, ranges(false)); const pending = track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), operation()));
  await until(() => r.originals.length === 1); const work = r.originals[0]!; const bytes = new Uint8Array(32).fill(7);
  work.result.resolve({ ok: true, value: bytes }); await until(() => work.close.mock.calls.length === 1); bytes.fill(9);
  let settled = false; void pending.then(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  work.quiet.resolve(); work.closed.resolve(); const result = await pending;
  expect(Buffer.from(result.base64, 'base64')).toEqual(Buffer.alloc(32, 7));
});

it.each([31, 33, 65_537])('rejects native positive byte count %i before base64 serialization and waits cleanup', async count => {
  const e = await ready(); const r = reader(e.journal, ranges(false)); const pending = track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), operation()));
  await until(() => r.originals.length === 1); const work = r.originals[0]!;
  const encode = vi.spyOn(Buffer.prototype, 'toString'); work.result.resolve({ ok: true, value: new Uint8Array(count) });
  await until(() => work.close.mock.calls.length === 1); expect(encode.mock.calls.some(([encoding]) => encoding === 'base64')).toBe(false);
  let settled = false; void pending.catch(() => { settled = true; }); await turns(); expect(settled).toBe(false);
  work.quiet.resolve(); work.closed.resolve(); await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  expect(encode.mock.calls.some(([encoding]) => encoding === 'base64')).toBe(false);
});

it.each([
  ['busy', 'busy'], ['closed', 'interrupted'], ['cancelled', 'interrupted'], ['deadline', 'interrupted'],
  ['missing', 'unavailable'], ['custody', 'unavailable'], ['io', 'unavailable'], ['integrity', 'unavailable'],
] as const)('maps native %s to %s after actual cleanup', async (reason, code) => {
  const e = await ready(); const r = reader(e.journal, ranges(false)); const pending = track(r.service.chunk(e.key, request(e.receipt, e.artifact.artifactId), operation()));
  await until(() => r.originals.length === 1); const work = r.originals[0]!;
  work.result.resolve({ ok: false, reason }); work.quiet.resolve(); work.closed.resolve(); await expect(pending).rejects.toMatchObject({ code });
});

it.each([NaN, Infinity, 300_101])('refuses invalid request deadline %s before Journal IO', async deadline => {
  const e = await ready(); const authority = vi.spyOn(e.journal, 'journalAuthority');
  await expect(track(reader(e.journal).service.source(e.key, { deadline }))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(authority).not.toHaveBeenCalled();
});

it('captures only own operation data, rejecting accessors and stale/aborted budgets before Journal IO', async () => {
  const e = await ready(); const authority = vi.spyOn(e.journal, 'journalAuthority'); const get = vi.fn(() => 1000); const r = reader(e.journal);
  const deadline = Object.defineProperty({}, 'deadline', { get }) as ReturnType<typeof operation>;
  await expect(track(r.service.source(e.key, deadline))).rejects.toMatchObject({ code: 'invalid_input' }); expect(get).not.toHaveBeenCalled();
  const signal = Object.defineProperty(operation(), 'signal', { get });
  await expect(track(r.service.source(e.key, signal))).rejects.toMatchObject({ code: 'invalid_input' }); expect(get).not.toHaveBeenCalled();
  const abort = new AbortController(); abort.abort();
  await expect(track(r.service.source(e.key, { ...operation(), signal: abort.signal }))).rejects.toMatchObject({ code: 'interrupted' });
  await expect(track(r.service.source(e.key, { deadline: 100 }))).rejects.toMatchObject({ code: 'interrupted' });
  expect(authority).not.toHaveBeenCalled();
  const ignored = Object.defineProperty(operation(), 'executionGraph', { get });
  expect((await track(r.service.source(e.key, ignored))).closure).toEqual(e.closure); expect(get).not.toHaveBeenCalled();
});

it('rejects chunk accessors and encoded overflow before Journal reads without invoking getters', async () => {
  const e = await ready(); const r = reader(e.journal); const authority = vi.spyOn(e.journal, 'journalAuthority');
  const get = vi.fn(() => 0); const input = Object.defineProperty(request(e.receipt, e.artifact.artifactId), 'offset', { get });
  await expect(track(r.service.chunk(e.key, input, operation()))).rejects.toMatchObject({ code: 'invalid_input' }); expect(get).not.toHaveBeenCalled();
  const oversized = { ...request(e.receipt, e.artifact.artifactId), padding: 'x'.repeat(1025) };
  await expect(track(r.service.chunk(e.key, oversized, operation()))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(authority).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it('sanitizes a trusted clock exception after an issued Journal read without continuing work', async () => {
  const e = await ready(); let observations = 0;
  const r = reader(e.journal, ranges(), () => { if (++observations >= 3) throw new Error('/private/clock failure'); return 100; });
  const read = vi.spyOn(e.journal, 'readOutputSource');
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'invalid_input', message: 'Output transfer invalid_input' });
  expect(read).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});
