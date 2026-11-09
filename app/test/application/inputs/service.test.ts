import { expect, it, vi } from 'vitest';
import { createInputService } from '../../../src/application/inputs/index.js';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import type { InputRecord, InputControlResult } from '../../../src/ports/inputs.js';
import { storageFixture, seed } from '../../storage/fixture.js';
import { append as appendRevision, createSuite, request } from '../../storage/suites-fixture.js';
import { creation, transition, setup, key, source, uuid, scope, digest, deferred } from './fixture.js';

const fixture = storageFixture();
it('uploads and retries bounded chunks, reads ranges, preserves snapshots and never repairs create replays', async () => {
  const { service, model } = await setup(fixture);
  const command = creation(); const original = await service.control(command) as InputRecord;
  expect(original).toMatchObject({ state: 'staging', version: 1, name: 'Input 90', folderId: uuid(3) });
  expect(model.files.size).toBe(0);
  const first = await service.append(key(original), 0, source('ab'));
  expect(first).toMatchObject({ offset: 2, version: 2 });
  expect(await service.append(key(first), 0, source('ab'))).toEqual(first);
  const complete = await service.append(key(first), 2, source('c'));
  const seal = transition(complete, 'sealInput'); const receipt = await service.control(seal);
  expect(receipt).toMatchObject({ operation: 'seal', acceptedVersion: 4 });
  const published = await service.get(key(first)); expect(published).toMatchObject({ state: 'published', version: 5 });
  const chunks: Uint8Array[] = []; await service.read(key(first), { start: 1, endExclusive: 3 }, { write: async data => { chunks.push(data); } });
  expect(Buffer.concat(chunks).toString()).toBe('bc');
  expect(await service.control({ ...command, id: uuid(999) })).toEqual(original);
  expect(await service.control(seal)).toEqual(receipt);
  const deletion = transition(published, 'deleteInput'); const deleted = await service.control(deletion);
  expect(await service.get(key(first))).toMatchObject({ state: 'deleted' }); expect(model.files.size).toBe(0);
  expect(await service.control(command)).toEqual(original);
  expect(await service.control(seal)).toEqual(receipt); expect(await service.control(deletion)).toEqual(deleted);
  expect(model.files.size).toBe(0); await service.close();
});
it('rejects gaps, partial overlaps, changed retries, wrong states and invalid chunk sizes without committing claims', async () => {
  const { service, metadata, model } = await setup(fixture);
  const original = await service.control(creation()) as InputRecord;
  const lazy = vi.fn(source('a'));
  await expect(service.append(key(original), 1, lazy)).rejects.toMatchObject({ code: 'conflict' }); expect(lazy).not.toHaveBeenCalled();
  const first = await service.append(key(original), 0, source('ab'));
  for (const value of ['', 'bc', 'x'.repeat(65537)]) {
    await expect(service.append(key(first), 1, source(value))).rejects.toMatchObject({ code: 'invalid_value' });
  }
  await expect(service.append(key(first), 0, source('zz'))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await service.get(key(first))).toEqual(first);
  await expect(service.control(transition(first, 'sealInput'))).rejects.toMatchObject({ code: 'conflict' });
  model.bytes.append = () => ({ result: Promise.resolve(3), settled: Promise.resolve() });
  await expect(service.append(key(first), 2, source('c'))).rejects.toMatchObject({ code: 'invalid_value' });
  expect(await metadata.inputs.get(key(first))).toEqual(first); await service.close();
});
it('publishes empty input through the byte port and fails wrong empty hash without creating upload chunks', async () => {
  const { service, model } = await setup(fixture);
  const spy = vi.spyOn(model.bytes, 'publish');
  const empty = await service.control(creation(90, '')) as InputRecord;
  const seal = await service.control(transition(empty, 'sealInput'));
  expect(seal).toMatchObject({ acceptedVersion: 2 }); expect(spy).toHaveBeenCalledOnce();
  expect(await service.get(key(empty))).toMatchObject({ state: 'published', version: 3 });
  const bad = creation(91, ''); bad.request.sha256 = 'a'.repeat(64);
  const record = await service.control(bad) as InputRecord;
  expect(await service.control(transition(record, 'sealInput'))).toMatchObject({ acceptedVersion: 2 });
  expect(await service.get(key(record))).toMatchObject({ state: 'failed', reason: 'integrity' });
  await service.close();
});
it('fences bytes behind actual revision pins and serializes read/delete ownership', async () => {
  const { service, metadata, model } = await setup(fixture);
  const original = await service.control(creation()) as InputRecord;
  const uploaded = await service.append(key(original), 0, source('abc')); await service.control(transition(uploaded, 'sealInput'));
  const published = await service.get(key(original)); const suite = await createSuite(metadata);
  const body = request(); body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu', input: { id: published.id, sha256: published.sha256, bytes: published.bytes } }];
  await appendRevision(metadata, suite, 60, body);
  const remove = vi.spyOn(model.bytes, 'remove');
  await expect(service.control(transition(published, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  expect(remove).not.toHaveBeenCalled(); expect(await service.get(key(original))).toEqual(published);
  const gate = deferred<void>(); const entered = deferred<void>();
  const reading = service.read(key(original), undefined, { write: async () => { entered.resolve(); await gate.promise; } });
  await entered.promise;
  await expect(service.control(transition(published, 'deleteInput'))).rejects.toMatchObject({ code: 'busy' });
  gate.resolve(); await reading; await service.close();
});
it('uses receipt lookup before current status and old seal replay cannot publish deleting custody', async () => {
  const { service, model } = await setup(fixture);
  const original = await service.control(creation()) as InputRecord;
  const uploaded = await service.append(key(original), 0, source('abc'));
  model.bytes.publish = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  const seal = transition(uploaded, 'sealInput'); const receipt = await service.control(seal);
  const publishing = await service.get(key(original)); expect(publishing.state).toBe('publishing');
  model.bytes.remove = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  await service.control(transition(publishing, 'deleteInput'));
  const publish = vi.spyOn(model.bytes, 'publish'); expect(await service.control(seal)).toEqual(receipt); expect(publish).not.toHaveBeenCalled();
  expect(await service.get(key(original))).toMatchObject({ state: 'deleting', reason: 'io' }); await service.close();
});
it('does not launch bytes after an unknown control outcome, then lets the exact caller replay recover', async () => {
  const { metadata, model } = await setup(fixture);
  const store = { ...metadata.inputs, control: vi.fn(async (command: Parameters<typeof metadata.inputs.control>[0]): Promise<InputControlResult> => {
    await metadata.inputs.control(command); throw new Error('lost reply');
  }) };
  const service = createInputService({ store, bytes: model.bytes, digest });
  const command = creation(90, ''); await expect(service.control(command)).rejects.toThrow('lost reply');
  expect(model.files.size).toBe(0);
  store.control = vi.fn(metadata.inputs.control);
  const record = await service.control(command) as InputRecord;
  const seal = transition(record, 'sealInput');
  store.control = vi.fn(async command => { await metadata.inputs.control(command); throw new Error('lost seal reply'); });
  const publish = vi.spyOn(model.bytes, 'publish'); await expect(service.control(seal)).rejects.toThrow('lost seal reply');
  expect(store.control).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled();
  store.control = vi.fn(metadata.inputs.control);
  expect(await service.control(seal)).toMatchObject({ acceptedVersion: 2 }); expect(publish).toHaveBeenCalledOnce();
  expect(await service.get(key(record))).toMatchObject({ state: 'published' }); await service.close();
});
it('does not retry or compensate unknown offset/publication/deletion metadata outcomes', async () => {
  const { metadata, model } = await setup(fixture);
  const advance = vi.fn(async (command: Parameters<typeof metadata.inputs.advance>[0]) => {
    await metadata.inputs.advance(command); throw new Error('lost advance reply');
  });
  const service = createInputService({ store: { ...metadata.inputs, advance }, bytes: model.bytes, digest });
  const record = await service.control(creation()) as InputRecord;
  await expect(service.append(key(record), 0, source('abc'))).rejects.toThrow('lost advance reply'); expect(advance).toHaveBeenCalledTimes(1);
  const uploaded = await service.get(key(record)); expect(uploaded.offset).toBe(3);
  expect(await service.control(transition(uploaded, 'sealInput'))).toMatchObject({ acceptedVersion: 3 });
  expect(advance).toHaveBeenCalledTimes(2); const published = await service.get(key(record)); expect(published.state).toBe('published');
  expect(await service.control(transition(published, 'deleteInput'))).toMatchObject({ acceptedVersion: 5 });
  expect(advance).toHaveBeenCalledTimes(3); expect(await service.get(key(record))).toMatchObject({ state: 'deleted' });
  await service.close();
});
it('isolates scopes and rejects a foreign folder before any lazy byte work', async () => {
  const { service, metadata } = await setup(fixture); await seed(metadata, 11, 12, 13);
  const wrong = creation(); wrong.request.folderId = uuid(13);
  await expect(service.control(wrong)).rejects.toMatchObject({ code: 'not_found' });
  const record = await service.control(creation()) as InputRecord; const read = vi.fn(source('abc'));
  await expect(service.append({ id: record.id, scope: { ...scope, organizationId: uuid(11), workspaceId: uuid(12) } }, 0, read)).rejects.toMatchObject({ code: 'not_found' });
  expect(read).not.toHaveBeenCalled(); await service.close();
});
it('rejects corrupt rows before bytes and detects mutations to committed published custody', async () => {
  const { metadata, model } = await setup(fixture);
  const service = createInputService({ store: { ...metadata.inputs, get: async key => ({ ...await metadata.inputs.get(key), offset: 100 }) }, bytes: model.bytes, digest });
  const record = await service.control(creation()) as InputRecord; const read = vi.fn(source('abc'));
  await expect(service.append(key(record), 0, read)).rejects.toMatchObject({ code: 'invalid_value' }); expect(read).not.toHaveBeenCalled();
  await service.close();
  const valid = createInputService({ store: metadata.inputs, bytes: model.bytes, digest });
  const uploaded = await valid.append(key(record), 0, source('abc')); await valid.control(transition(uploaded, 'sealInput'));
  model.files.set(model.identity(record), Buffer.from('bad'));
  const sink = vi.fn(async () => undefined);
  await expect(valid.read(key(record), undefined, { write: sink })).rejects.toMatchObject({ code: 'integrity' });
  expect(sink).not.toHaveBeenCalled(); expect(await valid.get(key(record))).toMatchObject({ state: 'failed', reason: 'integrity' }); await valid.close();
});
it('captures canonical create intent before awaiting and rejects invalid context before the metadata original', async () => {
  const { service, store } = await setup(fixture);
  const originalControl = store.control; const entered = deferred<void>(); const release = deferred<void>();
  const control = vi.spyOn(store, 'control').mockImplementation(async command => {
    entered.resolve(); await release.promise; return originalControl(command);
  });
  const command = creation(); const reply = service.control(command); await entered.promise;
  command.id = uuid(91); command.request.name = 'Changed'; command.request.bytes = 0; command.request.sha256 = 'b'.repeat(64);
  release.resolve(); const record = await reply as InputRecord;
  expect(record).toMatchObject({ id: uuid(90), name: 'Input 90', bytes: 3, sha256: digest('abc') });
  const stopped = new AbortController(); stopped.abort();
  await expect(service.control(creation(92), { signal: stopped.signal })).rejects.toMatchObject({ code: 'cancelled' });
  await expect(service.control(creation(93), { signal: {} as AbortSignal })).rejects.toMatchObject({ code: 'invalid_value' });
  expect(control).toHaveBeenCalledTimes(1); await service.close();
});
it('keeps callback failures transient even if a caller throws an error named as native integrity evidence', async () => {
  const { service } = await setup(fixture); const record = await service.control(creation()) as InputRecord;
  await expect(service.append(key(record), 0, async () => { throw new InputByteError('custody_missing'); })).rejects.toMatchObject({ code: 'io' });
  expect(await service.get(key(record))).toMatchObject({ state: 'staging', version: 1 });
  const uploaded = await service.append(key(record), 0, source('abc')); await service.control(transition(uploaded, 'sealInput'));
  await expect(service.read(key(record), undefined, { write: async () => { throw new InputByteError('integrity'); } })).rejects.toMatchObject({ code: 'io' });
  expect(await service.get(key(record))).toMatchObject({ state: 'published', reason: null }); await service.close();
});
it('drains metadata-only originals and fences create intake synchronously on close', async () => {
  const { service, store } = await setup(fixture);
  const originalControl = store.control; const entered = deferred<void>(); const release = deferred<void>();
  store.control = async command => { entered.resolve(); await release.promise; return originalControl(command); };
  const creating = service.control(creation()); await entered.promise; let done = false;
  const closing = service.close().then(() => { done = true; });
  await expect(service.control(creation(91))).rejects.toMatchObject({ code: 'closed' });
  await Promise.resolve(); expect(done).toBe(false);
  release.resolve(); expect(await creating).toMatchObject({ state: 'staging' }); await closing;
});
it('does not reissue unknown failure metadata outcomes or mistake them for byte failure', async () => {
  const { service, model, store, metadata } = await setup(fixture); const record = await service.control(creation()) as InputRecord;
  model.bytes.append = () => ({ result: Promise.reject(new InputByteError('custody_missing')), settled: Promise.resolve() });
  const advance = vi.spyOn(store, 'advance').mockImplementation(async command => {
    await metadata.inputs.advance(command); throw new Error('unknown fail reply');
  });
  await expect(service.append(key(record), 0, source('abc'))).rejects.toThrow('unknown fail reply');
  expect(advance).toHaveBeenCalledOnce(); expect(await service.get(key(record))).toMatchObject({ state: 'failed', reason: 'custody_missing' }); await service.close();
});
it('validates ranges and rejects dishonest byte-port output lengths before metadata can change', async () => {
  const { service, model } = await setup(fixture); const record = await service.control(creation()) as InputRecord;
  const uploaded = await service.append(key(record), 0, source('abc')); await service.control(transition(uploaded, 'sealInput'));
  const port = vi.spyOn(model.bytes, 'read'); const sink = vi.fn(async () => undefined);
  for (const range of [{ start: -1, endExclusive: 1 }, { start: 1, endExclusive: 4 }, { start: 2, endExclusive: 1 }]) {
    await expect(service.read(key(record), range, { write: sink })).rejects.toMatchObject({ code: 'invalid_value' });
  }
  expect(port).not.toHaveBeenCalled(); expect(sink).not.toHaveBeenCalled();
  port.mockImplementation(() => ({ result: Promise.resolve(), settled: Promise.resolve() }));
  await expect(service.read(key(record), undefined, { write: sink })).rejects.toMatchObject({ code: 'invalid_value' });
  expect(await service.get(key(record))).toMatchObject({ state: 'published' }); await service.close();
});
