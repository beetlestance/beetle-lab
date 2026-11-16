import { expect, it, vi } from 'vitest';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { creation, scope, setup, uuid } from './fixture.js';

const fixture = storageFixture();
it.each([100, 101])('lists and recovers %i maximum-length Unicode names without truncating a page', async count => {
  const { service, metadata, model, store } = await setup(fixture);
  const name = '\u{1f600}'.repeat(128);
  expect([...name]).toHaveLength(128);
  expect(Buffer.byteLength(name, 'utf8')).toBe(512);
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const command = creation(90 + index, ''); command.request.name = name;
    const row = await service.control(command) as InputRecord;
    expect(row.name).toBe(name); ids.push(row.id);
  }
  const query = { scope, limit: 100 };
  const storedList = await metadata.inputs.list(query);
  const storedRecovery = await metadata.inputs.recovery({ limit: 100 });
  // Independent JSON/UTF8 measurement: no implementation budget is imported.
  expect(Buffer.byteLength(JSON.stringify(storedList), 'utf8')).toBeGreaterThan(65536);
  expect(Buffer.byteLength(JSON.stringify(storedRecovery), 'utf8')).toBeGreaterThan(65536);
  expect(storedList.items).toHaveLength(100); expect(storedRecovery.items).toHaveLength(100);
  const listed = await service.list(query);
  expect(listed).toEqual(storedList);
  expect(listed.items.map(row => row.id)).toEqual(ids.slice(0, 100));
  expect(Object.isFrozen(listed)).toBe(true); expect(Object.isFrozen(listed.items[0])).toBe(true);
  const prepare = vi.spyOn(model.bytes, 'prepare'); const fresh = vi.spyOn(store, 'get');
  expect(await service.recover({ limit: 100 })).toEqual({ examined: 100, reconciled: 100,
    busy: 0, pending: 0, nextCursor: storedRecovery.nextCursor });
  expect(prepare).toHaveBeenCalledTimes(100); expect(fresh).toHaveBeenCalledTimes(100);
  expect(model.files.size).toBe(100); // Modeled byte custody; metadata is real SQLite.
  if (count === 101) {
    expect(listed.nextCursor).toBeTypeOf('string'); expect(storedRecovery.nextCursor).toBeTypeOf('string');
    const tail = await service.list({ ...query, cursor: listed.nextCursor! });
    expect(tail.items.map(row => row.id)).toEqual([uuid(190)]); expect(tail.nextCursor).toBeNull();
    expect(await service.recover({ limit: 100, cursor: storedRecovery.nextCursor! })).toEqual({ examined: 1,
      reconciled: 1, busy: 0, pending: 0, nextCursor: null });
    expect(prepare).toHaveBeenCalledTimes(101); expect(fresh).toHaveBeenCalledTimes(101);
  } else {
    expect(listed.nextCursor).toBeNull(); expect(storedRecovery.nextCursor).toBeNull();
  }
  expect(model.files.size).toBe(count); await service.close();
});
