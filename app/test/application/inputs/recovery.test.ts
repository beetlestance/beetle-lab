import { expect, it, vi } from 'vitest';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { createInputService } from '../../../src/application/inputs/index.js';
import { storageFixture } from '../../storage/fixture.js';
import { inputOptions } from '../../storage/inputs-fixture.js';
import { creation, transition, setup, key, source, deferred, turn, digest } from './fixture.js';

const fixture = storageFixture();
it('reconciles one fresh bounded page across states without treating failed inputs as repairable', async () => {
  const { service, metadata, model, store } = await setup(fixture);
  const staging = await service.control(creation(90)) as InputRecord;
  const publishing = await service.control(creation(91, '')) as InputRecord;
  const published = await service.control(creation(92, '')) as InputRecord;
  const deleting = await service.control(creation(93)) as InputRecord;
  const failed = await service.control(creation(94)) as InputRecord;
  await service.control(transition(published, 'sealInput'));
  const publish = model.bytes.publish; model.bytes.publish = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  await service.control(transition(publishing, 'sealInput')); model.bytes.publish = publish;
  const remove = model.bytes.remove; model.bytes.remove = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  await service.control(transition(deleting, 'deleteInput')); model.bytes.remove = remove;
  await metadata.inputs.advance({ kind: 'failInput', key: key(failed), expectedVersion: 1, reason: 'integrity' });
  const scan = vi.spyOn(store, 'recovery'); const fresh = vi.spyOn(store, 'get'); const prepare = vi.spyOn(model.bytes, 'prepare');
  const read = vi.spyOn(model.bytes, 'read'); const removal = vi.spyOn(model.bytes, 'remove');
  expect(await service.recover({ limit: 100 })).toEqual({ examined: 5, reconciled: 4, busy: 0, pending: 1, nextCursor: null });
  expect(scan).toHaveBeenCalledOnce(); expect(fresh).toHaveBeenCalledTimes(5); expect(prepare).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ id: published.id }), { start: 0, endExclusive: 0 }, expect.anything(), expect.anything());
  expect(removal).toHaveBeenCalledOnce(); expect(await service.get(key(publishing))).toMatchObject({ state: 'published' });
  expect(await service.get(key(deleting))).toMatchObject({ state: 'deleted' });
  expect(await service.get(key(failed))).toMatchObject({ state: 'failed' }); expect(await service.get(key(staging))).toMatchObject({ offset: 0, state: 'staging' });
  await service.control(transition(await service.get(key(failed)), 'deleteInput')); expect(await service.get(key(failed))).toMatchObject({ state: 'deleted' });
  await service.close();
});
it('re-gets rows after admission and never acts on a stale page projection', async () => {
  const { service, store, model } = await setup(fixture);
  const record = await service.control(creation(90, '')) as InputRecord;
  await service.control(transition(record, 'sealInput'));
  const fresh = await service.get(key(record)); const scan = store.recovery;
  store.recovery = async query => ({ ...await scan(query), items: [record] });
  const prepare = vi.spyOn(model.bytes, 'prepare'); const read = vi.spyOn(model.bytes, 'read');
  expect(await service.recover({ limit: 1 })).toMatchObject({ examined: 1, reconciled: 1 });
  expect(prepare).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledWith(fresh, { start: 0, endExclusive: 0 }, expect.anything(), expect.anything()); await service.close();
});
it('skips both keyed and globally busy rows without a waiter queue', async () => {
  const { service, model } = await setup(fixture);
  const rows: InputRecord[] = [];
  for (const id of [90, 91, 92]) rows.push(await service.control(creation(id)) as InputRecord);
  const a = deferred<void>(); const b = deferred<void>(); let sequence = 0;
  model.bytes.append = () => ({ result: Promise.reject(new InputByteError('io')), settled: [a, b][sequence++]!.promise });
  await expect(service.append(key(rows[0]!), 0, source('abc'))).rejects.toMatchObject({ code: 'io' });
  const prepare = vi.spyOn(model.bytes, 'prepare');
  expect(await service.recover({ limit: 100 })).toMatchObject({ examined: 3, busy: 1, reconciled: 2, pending: 0 });
  await expect(service.append(key(rows[1]!), 0, source('abc'))).rejects.toMatchObject({ code: 'io' });
  prepare.mockClear();
  expect(await service.recover({ limit: 100 })).toMatchObject({ examined: 3, busy: 3, reconciled: 0, pending: 0 });
  expect(prepare).not.toHaveBeenCalled(); a.resolve(); b.resolve(); await service.close();
});
it('recovers after metadata restart, preserving original control identities and pending lifecycle work', async () => {
  const { service, model, metadata, dbPath } = await setup(fixture);
  const record = await service.control(creation(90, '')) as InputRecord;
  const publish = model.bytes.publish;
  model.bytes.publish = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  const seal = transition(record, 'sealInput'); const receipt = await service.control(seal);
  await service.close();
  await fixture.close(metadata);
  const reopened = await fixture.open(dbPath, { ...inputOptions(), runtime: null });
  model.bytes.publish = publish;
  const restarted = createInputService({ store: reopened.inputs, bytes: model.bytes, digest });
  expect(await restarted.recover({ limit: 100 })).toMatchObject({ reconciled: 1, pending: 0 });
  expect(await restarted.control(seal)).toEqual(receipt); expect(await restarted.get(key(record))).toMatchObject({ state: 'published' });
  await restarted.close();
});
it('reports pending for unknown metadata outcome without retrying or compensating native work', async () => {
  const { service, model, store, metadata } = await setup(fixture);
  const record = await service.control(creation(90, '')) as InputRecord;
  const publish = model.bytes.publish; model.bytes.publish = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() });
  await service.control(transition(record, 'sealInput')); model.bytes.publish = publish;
  const advance = vi.spyOn(store, 'advance').mockImplementation(async command => {
    await metadata.inputs.advance(command); throw new Error('unknown reply');
  });
  const removal = vi.spyOn(model.bytes, 'remove');
  expect(await service.recover({ limit: 100 })).toMatchObject({ reconciled: 0, pending: 1 });
  expect(advance).toHaveBeenCalledOnce(); expect(removal).not.toHaveBeenCalled();
  expect(await metadata.inputs.get(key(record))).toMatchObject({ state: 'published' }); await service.close();
});
it('bounds recovery pages/cursors and rejects scope injection before querying', async () => {
  const { service, store } = await setup(fixture);
  for (const id of [90, 91, 92]) await service.control(creation(id));
  const scan = vi.spyOn(store, 'recovery');
  for (const query of [{ limit: 0 }, { limit: 101 }, { limit: 1, cursor: 'x'.repeat(1025) }, { limit: 1, scope: { kind: 'installation' } }]) {
    await expect(service.recover(query)).rejects.toMatchObject({ code: 'invalid_value' });
  }
  expect(scan).not.toHaveBeenCalled();
  const first = await service.recover({ limit: 2 }); expect(first).toMatchObject({ examined: 2, reconciled: 2 }); expect(first.nextCursor).toBeTypeOf('string');
  expect(await service.recover({ limit: 2, cursor: first.nextCursor! })).toMatchObject({ examined: 1, reconciled: 1, nextCursor: null });
  await service.close();
});

it('forwards private pending selection without processing ordinary staging custody', async () => {
  const { service, store, model } = await setup(fixture);
  await service.control(creation(90));
  const scan = vi.spyOn(store, 'recovery'); const prepare = vi.spyOn(model.bytes, 'prepare');
  expect(await service.recover({ limit: 16, mode: 'pending' }))
    .toEqual({ examined: 0, reconciled: 0, busy: 0, pending: 0, nextCursor: null });
  expect(scan).toHaveBeenCalledExactlyOnceWith({ limit: 16, mode: 'pending' }); expect(prepare).not.toHaveBeenCalled();
  await expect(service.recover({ limit: 16, mode: 'all' } as never)).rejects.toMatchObject({ code: 'invalid_value' });
  expect(scan).toHaveBeenCalledTimes(1); await service.close();
});
it('does not let page completion imply drained originals or retry cancelled work', async () => {
  const { service, model } = await setup(fixture); const record = await service.control(creation()) as InputRecord;
  const settled = deferred<void>(); const entered = deferred<void>();
  model.bytes.prepare = () => { entered.resolve(); return { result: Promise.reject(new InputByteError('cancelled')), settled: settled.promise }; };
  const recovering = service.recover({ limit: 100 }); await entered.promise;
  expect(await recovering).toMatchObject({ examined: 1, pending: 1, nextCursor: null });
  await expect(service.append(key(record), 0, source('abc'))).rejects.toMatchObject({ code: 'busy' });
  let done = false; const closing = service.close().then(() => { done = true; }); await turn(); expect(done).toBe(false);
  settled.resolve(); await closing;
});
