import { expect, it, vi } from 'vitest';
import * as shapes from '../../../src/application/inputs/shape.js';
import { discoverInputColumns } from '../../../src/application/inputs/columns.js';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { creation, deferred, job, key, setup, source, transition, turn } from './fixture.js';
const fixture = storageFixture();
async function published() {
  const value = await setup(fixture);
  const content = 'id\n1\n';
  const records: InputRecord[] = [];
  for (const id of [90, 91, 92]) {
    const record = (await value.service.control(creation(id, content))) as InputRecord;
    const uploaded = await value.service.append(key(record), 0, source(content));
    await value.service.control(transition(uploaded, 'sealInput'));
    records.push(await value.service.get(key(record)));
  }
  return { ...value, content, records };
}
it('propagates a late native hash failure and fences custody instead of returning an already parsed header', async () => {
  const app = await published();
  const record = app.records[0]!;
  app.model.bytes.read = (_record, _range, sink) =>
    job(async () => {
      await sink.write(Buffer.from(app.content));
      throw new InputByteError('integrity');
    });
  try {
    await expect(discoverInputColumns(app.service, key(record), 'csv')).rejects.toMatchObject({ code: 'integrity' });
    expect(await app.service.get(key(record))).toMatchObject({ state: 'failed', reason: 'integrity' });
  } finally {
    await app.service.close();
  }
});
it('retains global and canonical per-input ownership through cancellation until original native custody settles', async () => {
  const app = await published();
  const held = [deferred<void>(), deferred<void>()];
  const entered = [deferred<void>(), deferred<void>()];
  let issued = 0;
  app.model.bytes.read = (_record, _range, sink) => {
    const index = issued++;
    return {
      result: sink.write(Buffer.from(app.content)).then(() => {
        entered[index]!.resolve();
      }),
      settled: held[index]!.promise,
    };
  };
  const allocations = vi.spyOn(shapes, 'shapeCounter');
  const controller = new AbortController();
  const first = discoverInputColumns(app.service, key(app.records[0]!), 'csv', controller.signal).catch(
    (error) => error,
  );
  let second: Promise<unknown> | undefined;
  try {
    await entered[0]!.promise;
    expect(allocations).toHaveBeenCalledTimes(1);
    const same = key(app.records[0]!);
    same.id = same.id.toUpperCase();
    await expect(discoverInputColumns(app.service, same, 'json')).rejects.toMatchObject({ code: 'busy' });
    expect(allocations).toHaveBeenCalledTimes(1);
    second = discoverInputColumns(app.service, key(app.records[1]!), 'csv').catch((error) => error);
    await entered[1]!.promise;
    expect(allocations).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(discoverInputColumns(app.service, key(app.records[2]!), 'json')).rejects.toMatchObject({
      code: 'busy',
    });
    expect(allocations).toHaveBeenCalledTimes(2);
    let closed = false;
    const closing = app.service.close().then(() => {
      closed = true;
    });
    await turn();
    expect(closed).toBe(false);
    held.forEach((value) => value.resolve());
    expect(await first).toMatchObject({ code: 'cancelled' });
    await second;
    await closing;
  } finally {
    held.forEach((value) => value.resolve());
    await first;
    await second;
    await app.service.close();
    allocations.mockRestore();
  }
});
